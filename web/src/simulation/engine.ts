import { VirtualClock } from './clock';
import { AgentSimulator } from './agentSimulator';
import { StationStateManagerV2 } from './stateManagerV2';
import { distanceMatrix } from './distanceMatrix';
import { getConfig, observeRides, rebalanceCycle, resetPredictor } from '../api/client';
import { STATIONS } from '../data/stations';
import {
  DISPATCH_VEHICLE_CAPACITY,
  DISPATCH_VEHICLE_COUNT,
  REBALANCE_INTERVAL_SLOTS,
  SLOT_DURATION_MS,
  VIRTUAL_MS_PER_FRAME_1X,
} from '../data/constants';
import { SLOTS_PER_DAY } from '../types/time';
import { compileScenarioBundle } from './scenarioCompiler';
import { DEFAULT_SCENARIO_ID, getDefaultScenarioForDayKind, getScenarioById } from '../data/scenarioLibrary';
import { clearSeed, seedRandom } from './rng';
import type { DemandRecord } from '../types/demand';
import type { DayKind } from '../types/time';
import type { DispatchPlan, DispatchVehicle } from '../types/dispatch';
import type { TargetInventory } from '../types/demand';
import type { PriceIncentive } from '../types/incentive';
import type { CycleResp, SystemConfig } from '../types/api';
import type { ScenarioBundle, ScenarioPackage, SimulationSnapshotV2, SlotEnvironmentContext } from '../types/scenario';
import {
  deriveVehicleAnimation,
  planVehicleExecution,
  type VehicleAnimationState,
  type VehicleDispatchExecution,
} from './dispatchExecution';
import type { SimStateSnapshot } from './workerProtocol';

export type EngineState = 'idle' | 'running' | 'paused';

export type LoopStrategy = 'raf' | 'interval';

export interface EngineCallbacks {
  onTick: (engine: SimulationEngine) => void;
  onSlotChange: (slotIndex: number) => void;
  onRebalance: (resp: CycleResp) => void;
  onSnapshot: (snap: SimulationSnapshotV2) => void;
}

export interface VehicleAnimation {
  vehicleId: number;
  path: number[];
  currentSegmentIndex: number;
  progress: number;
}

interface FleetVehicleState extends DispatchVehicle {
  currentLoad: number;
  execution: VehicleDispatchExecution | null;
}

export class SimulationEngine {
  clock: VirtualClock;
  stateManager: StationStateManagerV2;
  state: EngineState = 'idle';
  speed = 1;
  dispatchEnabled = false;
  scenarioBundle: ScenarioBundle;
  scenario: ScenarioPackage;
  syntheticPreview: ScenarioBundle['syntheticTripCorpus'];
  latestContext: SlotEnvironmentContext;
  activeScenarioId: string;

  latestTargets: TargetInventory[] = [];
  latestPlan: DispatchPlan | null = null;
  latestIncentives: PriceIncentive[] = [];
  dispatchCount = 0;
  totalBikesMoved = 0;
  activeVehicleAnimations: VehicleAnimation[] = [];

  private callbacks: EngineCallbacks;
  private loopStrategy: LoopStrategy;
  private rafId: number | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private lastFrameTime: number | null = null;
  private lastSlotIndex = -1;
  private slotsSinceRebalance = 0;
  private isRebalancing = false;
  private cachedVehicleCount = DISPATCH_VEHICLE_COUNT;
  private cachedVehicleCapacity = DISPATCH_VEHICLE_CAPACITY;
  private cachedRebalanceSlots = REBALANCE_INTERVAL_SLOTS;
  private agentSimulator: AgentSimulator;
  private fleet: FleetVehicleState[] = [];

  constructor(callbacks: EngineCallbacks, loopStrategy: LoopStrategy = 'raf') {
    this.callbacks = callbacks;
    this.loopStrategy = loopStrategy;
    this.clock = new VirtualClock('weekday');
    this.activeScenarioId = DEFAULT_SCENARIO_ID;
    this.scenarioBundle = compileScenarioBundle(DEFAULT_SCENARIO_ID);
    this.scenario = this.scenarioBundle.scenario;
    this.syntheticPreview = this.scenarioBundle.syntheticTripCorpus;
    this.latestContext = {
      slotIndex: 0,
      weather: this.scenario.weatherTimeline[0].weather,
      weatherLabel: this.scenario.weatherTimeline[0].label,
      activeEvents: [],
      demandMultiplier: this.scenario.baseDemandMultiplier,
      travelTimeMultiplier: 1,
      shortTripBoost: 1,
      categoryDemandBoost: {},
    };
    seedRandom(this.scenario.seed);
    this.stateManager = new StationStateManagerV2(this.scenario);
    this.agentSimulator = new AgentSimulator(this.scenario);
  }

  async warmup(): Promise<void> {
    this.scenarioBundle = compileScenarioBundle(this.activeScenarioId, { seed: this.scenario.seed });
    this.syntheticPreview = this.scenarioBundle.syntheticTripCorpus;
    try {
      await this.refreshDispatchConfig();
      await resetPredictor();
      await this.warmupPredictor(4);
    } catch {
      // The external predictor remains optional and should never block the simulation.
    }
    await new Promise((resolve) => setTimeout(resolve, 60));
  }

  start(): void {
    if (this.state === 'running') return;
    this.state = 'running';
    this.lastFrameTime = performance.now();
    this.startLoop();
  }

  pause(): void {
    if (this.state !== 'running') return;
    this.state = 'paused';
    this.stopLoop();
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'running';
    this.lastFrameTime = performance.now();
    this.startLoop();
  }

  /** Build a serializable state snapshot for Worker communication. */
  buildStateSnapshot(): SimStateSnapshot {
    const stationStates = this.stateManager.buildStationStates();
    return {
      slotIndex: this.clock.slotIndex,
      dayKind: this.clock.dayKind,
      engineState: this.state,
      scenarioId: this.scenario.id,
      scenarioLabel: this.scenario.label,
      scenarioDescription: this.scenario.description,
      syntheticPreview: this.syntheticPreview,
      bikes: stationStates.map((s) => s.availableBikes),
      brokenBikes: stationStates.map((s) => s.brokenBikes),
      maintenanceBikes: stationStates.map((s) => s.maintenanceBikes),
      stationPressure: stationStates.map((s) => s.pressureIndex),
      activeRides: [...this.stateManager.activeRides],
      totalRides: this.stateManager.totalServedDemand,
      blockedCount: this.stateManager.totalUnmetDemand,
      dispatchCount: this.dispatchCount,
      totalBikesMoved: this.totalBikesMoved,
      totalWalkTransfers: this.stateManager.totalWalkTransfers,
      totalOverflowEvents: this.stateManager.totalOverflowEvents,
      totalRepairsCompleted: this.stateManager.totalRepairsCompleted,
      totalInTransit: this.stateManager.totalInTransit,
      failureReasonCounts: { ...this.stateManager.failureReasonCounts },
      activeWeather: this.latestContext.weather,
      activeWeatherLabel: this.latestContext.weatherLabel,
      activeEvents: this.latestContext.activeEvents.map((e) => e.label),
      odMatrix: this.stateManager.odByCategory.map((row) => [...row]),
      latestTargets: this.latestTargets,
      latestPlan: this.latestPlan,
      latestIncentives: this.latestIncentives,
      vehicleAnimations: [...this.activeVehicleAnimations],
    };
  }

  step(): void {
    const msNeeded = SLOT_DURATION_MS - (this.clock.totalElapsedMs % SLOT_DURATION_MS);
    this.clock.tick(msNeeded + 1);
    this.processVehicleExecutions(this.clock.totalElapsedMs);
    const targetSlot = this.clock.slotIndex;
    this.processSlotChange(targetSlot);
    this.stateManager.processArrivals(this.baseDateMs() + this.clock.totalElapsedMs, targetSlot);
    this.updateVehicleAnimations(this.clock.totalElapsedMs);
    this.callbacks.onTick(this);
  }

  reset(dayKind?: DayKind): void {
    this.pause();
    if (dayKind) {
      this.activeScenarioId = getDefaultScenarioForDayKind(dayKind).id;
    }
    this.refreshScenario(this.activeScenarioId);
    this.clock.reset(this.scenario.dayKind);
    this.lastSlotIndex = -1;
    this.slotsSinceRebalance = 0;
    this.isRebalancing = false;
    this.latestTargets = [];
    this.latestPlan = null;
    this.latestIncentives = [];
    this.dispatchCount = 0;
    this.totalBikesMoved = 0;
    this.activeVehicleAnimations = [];
    this.fleet = [];
    this.state = 'idle';
    this.callbacks.onTick(this);
  }

  setSpeed(speed: number): void {
    this.speed = speed;
  }

  setDispatchEnabled(value: boolean): void {
    this.dispatchEnabled = value;
  }

  setDayKind(dayKind: DayKind): void {
    this.clock.dayKind = dayKind;
    const nextScenario = getDefaultScenarioForDayKind(dayKind);
    if (nextScenario.id !== this.activeScenarioId) {
      this.setScenario(nextScenario.id);
    }
  }

  setScenario(scenarioId: string): void {
    const scenario = getScenarioById(scenarioId);
    this.clock.dayKind = scenario.dayKind;
    this.activeScenarioId = scenario.id;
    this.refreshScenario(scenario.id);
    this.state = 'idle';
    this.callbacks.onTick(this);
  }

  private refreshScenario(scenarioId: string): void {
    this.scenarioBundle = compileScenarioBundle(scenarioId, { seed: getScenarioById(scenarioId).seed });
    this.scenario = this.scenarioBundle.scenario;
    this.syntheticPreview = this.scenarioBundle.syntheticTripCorpus;
    this.latestContext = {
      slotIndex: 0,
      weather: this.scenario.weatherTimeline[0].weather,
      weatherLabel: this.scenario.weatherTimeline[0].label,
      activeEvents: [],
      demandMultiplier: this.scenario.baseDemandMultiplier,
      travelTimeMultiplier: 1,
      shortTripBoost: 1,
      categoryDemandBoost: {},
    };
    clearSeed();
    seedRandom(this.scenario.seed);
    this.stateManager = new StationStateManagerV2(this.scenario);
    this.agentSimulator = new AgentSimulator(this.scenario);
    this.fleet = [];
  }

  private startLoop(): void {
    this.stopLoop();
    if (this.loopStrategy === 'interval') {
      this.intervalId = setInterval(this.loop, 16);
    } else {
      this.loop();
    }
  }

  private stopLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private loop = (): void => {
    if (this.state !== 'running') return;

    const now = performance.now();
    const realDeltaMs = this.lastFrameTime ? now - this.lastFrameTime : 16;
    this.lastFrameTime = now;

    const virtualDelta = realDeltaMs * this.speed * (VIRTUAL_MS_PER_FRAME_1X / (1000 / 60));
    this.clock.tick(virtualDelta);
    this.processVehicleExecutions(this.clock.totalElapsedMs);

    const currentSlot = this.clock.slotIndex;
    if (currentSlot !== this.lastSlotIndex) {
      this.processSlotChange(currentSlot);
    }

    this.stateManager.processArrivals(this.baseDateMs() + this.clock.totalElapsedMs, currentSlot);
    this.updateVehicleAnimations(this.clock.totalElapsedMs);
    this.callbacks.onTick(this);
    if (this.loopStrategy === 'raf') {
      this.rafId = requestAnimationFrame(this.loop);
    }
  };

  private processSlotChange(slotIndex: number): void {
    this.lastSlotIndex = slotIndex;
    this.slotsSinceRebalance++;

    const slotStartMs = this.baseDateMs() + slotIndex * SLOT_DURATION_MS;
    // Feed current incentives to the rider model before generating demand.
    this.agentSimulator.setIncentives(this.latestIncentives);
    const { context, observations } = this.agentSimulator.step(slotIndex, slotStartMs, this.stateManager);
    this.latestContext = context;
    this.pushObservations(observations);

    const snapshot = this.stateManager.takeSnapshot(slotIndex, this.latestContext);
    this.callbacks.onSnapshot(snapshot);
    this.callbacks.onSlotChange(slotIndex);

    const blockRate = this.currentBlockRate();
    if (
      this.dispatchEnabled
      && this.slotsSinceRebalance >= this.rebalanceSlotsFor(blockRate)
      && !this.isRebalancing
    ) {
      this.slotsSinceRebalance = 0;
      this.triggerRebalance(slotIndex, blockRate);
    }
  }

  private async triggerRebalance(slotIndex: number, blockRate: number): Promise<void> {
    this.isRebalancing = true;
    try {
      await this.refreshDispatchConfig();
      const vehicles = this.getFleet();
      if (vehicles.length === 0) {
        return;
      }

      const resp = await rebalanceCycle({
        stations: STATIONS,
        current_status: this.stateManager.buildStatus(),
        distance_matrix: distanceMatrix,
        vehicles,
        current_slot: {
          day_kind: this.clock.dayKind,
          slot_index: slotIndex,
        },
        block_rate: blockRate,
      });

      this.latestTargets = resp.targets;
      this.latestPlan = resp.dispatch_plan;
      this.latestIncentives = resp.incentives;
      this.dispatchCount++;
      this.startVehicleAnimations(resp.dispatch_plan, this.clock.totalElapsedMs);
      this.callbacks.onRebalance(resp);
    } catch {
      // The external optimizer remains optional and should never block the simulation.
    } finally {
      this.isRebalancing = false;
    }
  }

  private startVehicleAnimations(plan: DispatchPlan, routeStartMs: number): void {
    if (this.fleet.length === 0) {
      this.syncFleetShape();
    }

    for (const route of plan.vehicle_routes) {
      if (route.stops.length === 0) {
        continue;
      }

      const vehicle = this.fleet.find((candidate) => candidate.id === route.vehicle_id);
      if (!vehicle || vehicle.execution) {
        continue;
      }

      const execution = planVehicleExecution(
        vehicle,
        route,
        routeStartMs,
        distanceMatrix,
      );
      if (!execution) {
        continue;
      }

      vehicle.execution = execution;
    }

    this.updateVehicleAnimations(routeStartMs);
  }

  private updateVehicleAnimations(virtualNow: number): void {
    this.activeVehicleAnimations = this.fleet
      .map((vehicle) => this.toVehicleAnimation(vehicle.execution, virtualNow))
      .filter((animation): animation is VehicleAnimation => animation !== null);
  }

  private baseDateMs(): number {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }

  private currentBlockRate(): number {
    const totalAttempts = this.stateManager.totalServedDemand + this.stateManager.totalUnmetDemand;
    return totalAttempts > 0 ? this.stateManager.totalUnmetDemand / totalAttempts : 0;
  }

  private rebalanceSlotsFor(blockRate: number): number {
    // Minimum 15 slots (= 15 minutes) — dispatching more often is unrealistic.
    if (blockRate >= 0.18) {
      return 15;
    }
    if (blockRate >= 0.08) {
      return Math.max(15, this.cachedRebalanceSlots - 15);
    }
    return this.cachedRebalanceSlots;
  }

  private async refreshDispatchConfig(): Promise<void> {
    try {
      const config = await getConfig();
      this.applyDispatchConfig(config);
    } catch {
      // Keep the last known local dispatch settings when config sync is unavailable.
    }
  }

  private applyDispatchConfig(config: SystemConfig): void {
    this.cachedVehicleCount = Math.max(1, Math.round(config.dispatch_vehicle_count));
    this.cachedVehicleCapacity = Math.max(1, Math.round(config.dispatch_vehicle_capacity));
    this.cachedRebalanceSlots = Math.max(1, Math.round(config.rebalance_interval_minutes));
    this.syncFleetShape();
  }

  private syncFleetShape(): void {
    const nextFleet: FleetVehicleState[] = [];
    for (let index = 0; index < this.cachedVehicleCount; index++) {
      const previous = this.fleet[index];
      nextFleet.push({
        id: index,
        capacity: this.cachedVehicleCapacity,
        current_position: previous?.current_position ?? 0,
        currentLoad: previous?.currentLoad ?? 0,
        execution: previous?.execution ?? null,
      });
    }
    this.fleet = nextFleet;
  }

  private getFleet(): DispatchVehicle[] {
    if (
      this.fleet.length !== this.cachedVehicleCount
        || this.fleet.some((vehicle) => vehicle.capacity !== this.cachedVehicleCapacity)
    ) {
      this.syncFleetShape();
    }
    return this.fleet
      .filter((vehicle) => vehicle.execution === null)
      .map((vehicle) => ({
        id: vehicle.id,
        capacity: vehicle.capacity,
        current_position: vehicle.current_position,
      }));
  }

  private async warmupPredictor(passes: number): Promise<void> {
    const baseDateMs = this.baseDateMs();

    try {
      for (let pass = 0; pass < passes; pass++) {
        seedRandom(this.scenario.seed + 1000 + pass);
        const previewSimulator = new AgentSimulator(this.scenario);
        const previewStateManager = new StationStateManagerV2(this.scenario);
        const batch: DemandRecord[] = [];

        for (let slotIndex = 0; slotIndex < SLOTS_PER_DAY; slotIndex++) {
          const slotStartMs = baseDateMs + slotIndex * SLOT_DURATION_MS;
          const { observations } = previewSimulator.step(slotIndex, slotStartMs, previewStateManager);
          batch.push(...observations);
          previewStateManager.processArrivals(slotStartMs + SLOT_DURATION_MS, slotIndex);

          if (batch.length >= 160) {
            await observeRides({ records: batch.splice(0), day_kind: this.clock.dayKind });
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        }

        if (batch.length > 0) {
          await observeRides({ records: batch, day_kind: this.clock.dayKind });
        }
      }
    } finally {
      seedRandom(this.scenario.seed);
    }
  }

  private pushObservations(records: DemandRecord[]): void {
    if (!this.dispatchEnabled || records.length === 0) {
      return;
    }

    void observeRides({ records, day_kind: this.clock.dayKind }).catch(() => {
      // The external predictor remains optional and should never block the simulation.
    });
  }

  private processVehicleExecutions(virtualNow: number): void {
    for (const vehicle of this.fleet) {
      const execution = vehicle.execution;
      if (!execution) {
        continue;
      }

      while (
        execution.nextStopIndex < execution.stops.length
        && execution.stops[execution.nextStopIndex].executeAtMs <= virtualNow
      ) {
        const nextStop = execution.stops[execution.nextStopIndex];
        execution.nextStopIndex++;

        if (nextStop.stop.action === 'pickup') {
          const requested = Math.min(
            nextStop.stop.bike_count,
            Math.max(0, vehicle.capacity - vehicle.currentLoad),
          );
          const actual = this.stateManager.applyDispatchPickup(nextStop.stop.station_id, requested);
          vehicle.currentLoad += actual;
          this.totalBikesMoved += actual;
          vehicle.current_position = nextStop.stop.station_id;
          continue;
        }

        const requested = Math.min(nextStop.stop.bike_count, vehicle.currentLoad);
        const result = this.stateManager.applyDispatchDropoff(nextStop.stop.station_id, requested);
        vehicle.currentLoad -= result.dropped;
        vehicle.current_position = result.stationId;
      }

      if (execution.nextStopIndex >= execution.stops.length && virtualNow >= execution.busyUntilMs) {
        vehicle.execution = null;
      }
    }
  }

  private toVehicleAnimation(
    execution: VehicleDispatchExecution | null,
    virtualNow: number,
  ): VehicleAnimation | null {
    const animation = deriveVehicleAnimation(execution, virtualNow);
    if (!animation) {
      return null;
    }

    const typedAnimation: VehicleAnimationState = animation;
    return {
      vehicleId: typedAnimation.vehicleId,
      path: typedAnimation.path,
      currentSegmentIndex: typedAnimation.currentSegmentIndex,
      progress: typedAnimation.progress,
    };
  }
}
