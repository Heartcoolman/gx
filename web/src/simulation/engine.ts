import { VirtualClock } from './clock';
import { StationStateManager } from './stateManager';
import { generateDemand, generateFullDayHistory } from './demandGenerator';
import { distanceMatrix } from './distanceMatrix';
import { observeRides, rebalanceCycle } from '../api/client';
import { STATIONS } from '../data/stations';
import { VIRTUAL_MS_PER_FRAME_1X, REBALANCE_INTERVAL_SLOTS, DISPATCH_VEHICLE_COUNT, DISPATCH_VEHICLE_CAPACITY } from '../data/constants';
import type { DayKind } from '../types/time';
import type { DispatchPlan } from '../types/dispatch';
import type { TargetInventory } from '../types/demand';
import type { PriceIncentive } from '../types/incentive';
import type { DispatchVehicle } from '../types/dispatch';
import type { CycleResp } from '../types/api';
import type { Snapshot } from './stateManager';

export type EngineState = 'idle' | 'running' | 'paused';

export interface EngineCallbacks {
  onTick: (engine: SimulationEngine) => void;
  onSlotChange: (slotIndex: number) => void;
  onRebalance: (resp: CycleResp) => void;
  onSnapshot: (snap: Snapshot) => void;
}

export class SimulationEngine {
  clock: VirtualClock;
  stateManager: StationStateManager;
  state: EngineState = 'idle';
  speed = 1;
  dispatchEnabled = false;
  private rafId: number | null = null;
  private lastFrameTime: number | null = null;
  private lastSlotIndex = -1;
  private slotsSinceRebalance = 0;
  private isRebalancing = false;
  private callbacks: EngineCallbacks;

  // Latest results from backend
  latestTargets: TargetInventory[] = [];
  latestPlan: DispatchPlan | null = null;
  latestIncentives: PriceIncentive[] = [];
  dispatchCount = 0;
  totalBikesMoved = 0;

  // Active dispatch vehicle animations
  activeVehicleAnimations: VehicleAnimation[] = [];

  constructor(callbacks: EngineCallbacks) {
    this.clock = new VirtualClock('weekday');
    this.stateManager = new StationStateManager();
    this.callbacks = callbacks;
  }

  async warmup(): Promise<void> {
    const dayHistory = generateFullDayHistory(new Date().toISOString());
    for (let slot = 0; slot < 96; slot++) {
      const records = dayHistory[slot];
      if (records.length > 0) {
        try {
          await observeRides({
            records,
            day_kind: this.clock.dayKind,
          });
        } catch {
          // Backend may not be running; continue
        }
      }
    }
  }

  start(): void {
    if (this.state === 'running') return;
    this.state = 'running';
    this.lastFrameTime = performance.now();
    this.loop();
  }

  pause(): void {
    if (this.state !== 'running') return;
    this.state = 'paused';
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'running';
    this.lastFrameTime = performance.now();
    this.loop();
  }

  step(): void {
    // Advance exactly one slot
    const targetSlot = (this.clock.slotIndex + 1) % 96;
    const msNeeded = (15 * 60 * 1000) - (this.clock.totalElapsedMs % (15 * 60 * 1000));
    this.clock.tick(msNeeded + 1);
    this.processSlotChange(targetSlot);
    this.callbacks.onTick(this);
  }

  reset(dayKind?: DayKind): void {
    this.pause();
    this.clock.reset(dayKind);
    this.stateManager.reset();
    this.lastSlotIndex = -1;
    this.slotsSinceRebalance = 0;
    this.isRebalancing = false;
    this.latestTargets = [];
    this.latestPlan = null;
    this.latestIncentives = [];
    this.dispatchCount = 0;
    this.totalBikesMoved = 0;
    this.activeVehicleAnimations = [];
    this.state = 'idle';
    this.callbacks.onTick(this);
  }

  setSpeed(speed: number): void {
    this.speed = speed;
  }

  setDispatchEnabled(v: boolean): void {
    this.dispatchEnabled = v;
  }

  setDayKind(dayKind: DayKind): void {
    this.clock.dayKind = dayKind;
  }

  private loop = (): void => {
    if (this.state !== 'running') return;

    const now = performance.now();
    const realDeltaMs = this.lastFrameTime ? now - this.lastFrameTime : 16;
    this.lastFrameTime = now;

    // Advance virtual clock
    const virtualDelta = realDeltaMs * this.speed * (VIRTUAL_MS_PER_FRAME_1X / (1000 / 60));
    this.clock.tick(virtualDelta);

    const currentSlot = this.clock.slotIndex;

    // Check for slot change
    if (currentSlot !== this.lastSlotIndex) {
      this.processSlotChange(currentSlot);
    }

    // Update active rides
    const virtualNow = this.clock.totalElapsedMs;
    // Use a reference point for arrival processing
    const refTime = new Date();
    refTime.setHours(0, 0, 0, 0);
    const nowMs = refTime.getTime() + virtualNow;
    this.stateManager.processArrivals(nowMs);

    // Update vehicle animations
    this.updateVehicleAnimations(virtualNow);

    this.callbacks.onTick(this);
    this.rafId = requestAnimationFrame(this.loop);
  };

  private processSlotChange(slotIndex: number): void {
    this.lastSlotIndex = slotIndex;
    this.slotsSinceRebalance++;

    // Generate demand for this slot
    const refTime = new Date();
    refTime.setHours(0, 0, 0, 0);
    const slotTimeMs = refTime.getTime() + slotIndex * 15 * 60 * 1000;
    const baseTimeISO = new Date(slotTimeMs).toISOString();

    const rawRecords = generateDemand(slotIndex, baseTimeISO);
    const accepted = this.stateManager.processDepartures(rawRecords);

    // Feed to backend (fire-and-forget)
    if (accepted.length > 0) {
      observeRides({
        records: accepted,
        day_kind: this.clock.dayKind,
      }).catch(() => {});
    }

    // Take snapshot
    const snap = this.stateManager.takeSnapshot(slotIndex);
    this.callbacks.onSnapshot(snap);
    this.callbacks.onSlotChange(slotIndex);

    // Trigger rebalance every REBALANCE_INTERVAL_SLOTS (only when dispatch is enabled)
    if (this.dispatchEnabled && this.slotsSinceRebalance >= REBALANCE_INTERVAL_SLOTS && !this.isRebalancing) {
      this.slotsSinceRebalance = 0;
      this.triggerRebalance(slotIndex);
    }
  }

  private async triggerRebalance(slotIndex: number): Promise<void> {
    this.isRebalancing = true;
    try {
      const vehicles: DispatchVehicle[] = Array.from({ length: DISPATCH_VEHICLE_COUNT }, (_, i) => ({
        id: i,
        capacity: DISPATCH_VEHICLE_CAPACITY,
        current_position: 0, // depot at station 0
      }));

      const resp = await rebalanceCycle({
        stations: STATIONS,
        current_status: this.stateManager.buildStatus(),
        distance_matrix: distanceMatrix,
        vehicles,
        current_slot: {
          day_kind: this.clock.dayKind,
          slot_index: slotIndex,
        },
      });

      this.latestTargets = resp.targets;
      this.latestPlan = resp.dispatch_plan;
      this.latestIncentives = resp.incentives;
      this.dispatchCount++;
      this.totalBikesMoved += resp.dispatch_plan.total_bikes_moved;

      // Apply dispatch plan
      this.stateManager.applyDispatchPlan(resp.dispatch_plan);

      // Start vehicle route animations
      this.startVehicleAnimations(resp.dispatch_plan);

      this.callbacks.onRebalance(resp);
    } catch {
      // Backend unavailable, skip
    } finally {
      this.isRebalancing = false;
    }
  }

  private startVehicleAnimations(plan: DispatchPlan): void {
    this.activeVehicleAnimations = plan.vehicle_routes
      .filter(r => r.stops.length > 0)
      .map(route => ({
        vehicleId: route.vehicle_id,
        stops: route.stops.map(s => s.station_id),
        currentStopIndex: 0,
        progress: 0,
        totalDurationMs: route.estimated_duration_minutes * 60 * 1000,
        startTime: this.clock.totalElapsedMs,
      }));
  }

  private updateVehicleAnimations(virtualNow: number): void {
    this.activeVehicleAnimations = this.activeVehicleAnimations.filter(anim => {
      const elapsed = virtualNow - anim.startTime;
      const totalProgress = elapsed / anim.totalDurationMs;
      if (totalProgress >= 1) return false;

      const stopCount = anim.stops.length;
      const segmentProgress = totalProgress * stopCount;
      anim.currentStopIndex = Math.min(Math.floor(segmentProgress), stopCount - 1);
      anim.progress = segmentProgress - anim.currentStopIndex;
      return true;
    });
  }
}

export interface VehicleAnimation {
  vehicleId: number;
  stops: number[];
  currentStopIndex: number;
  progress: number;
  totalDurationMs: number;
  startTime: number;
}
