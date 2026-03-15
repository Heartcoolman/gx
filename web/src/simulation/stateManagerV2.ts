import type { DispatchPlan } from '../types/dispatch';
import type { StationStatus } from '../types/station';
import type {
  ActiveRideV2,
  BikeAsset,
  BikeCondition,
  FailureReason,
  FailureReasonCounts,
  ScenarioPackage,
  SimulationSnapshotV2,
  SlotEnvironmentContext,
  StationStateV2,
} from '../types/scenario';
import { STATIONS } from '../data/stations';
import { useSimEnvStore } from '../store/simEnvStore';
import { random } from './rng';
import { distanceMatrix } from './distanceMatrix';

function createEmptyReasons(): FailureReasonCounts {
  return {
    weather_cancelled: 0,
    no_bike: 0,
    bike_fault: 0,
    walk_transfer_exceeded: 0,
    gave_up_after_retry: 0,
    gave_up_after_wait: 0,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// ── Indexed counters per station ──
// Instead of O(n) .filter() over the entire bikes array, we maintain
// integer counters that are updated in O(1) whenever a bike changes state.

interface StationCounters {
  available: number;   // healthy + recovery
  broken: number;      // light_fault + unavailable
  maintenance: number; // maintenance
  docked: number;      // everything except in_transit
}

function emptyCounters(): StationCounters {
  return { available: 0, broken: 0, maintenance: 0, docked: 0 };
}

function isAvailableCondition(c: BikeCondition): boolean {
  return c === 'healthy' || c === 'recovery';
}

function isBrokenCondition(c: BikeCondition): boolean {
  return c === 'light_fault' || c === 'unavailable';
}

function isDockedCondition(c: BikeCondition): boolean {
  return c !== 'in_transit';
}

export class StationStateManagerV2 {
  readonly scenario: ScenarioPackage;
  bikes: BikeAsset[] = [];
  activeRides: ActiveRideV2[] = [];
  totalServedDemand = 0;
  totalUnmetDemand = 0;
  totalWalkTransfers = 0;
  totalOverflowEvents = 0;
  totalRepairsCompleted = 0;
  failureReasonCounts: FailureReasonCounts = createEmptyReasons();
  snapshots: SimulationSnapshotV2[] = [];
  odByCategory: number[][] = Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => 0));

  /** When false, skip snapshot collection (benchmark mode). */
  collectSnapshots = true;
  /** Dirty flag for odByCategory — only deep-copy when changed. */
  private odDirty = false;

  // ── O(1) indexed counters ──
  private counters: StationCounters[] = [];
  // Per-station list of bike indices for fast checkout sampling
  private stationAvailableIndices: number[][] = [];

  // ── Queue waiting model ──
  /** Per-station waiting queue: riders who arrived but found no bikes. */
  private waitingQueues: Array<Array<{ enqueuedSlot: number; maxWaitSlots: number; stationId: number }>> = [];
  totalGaveUpAfterWait = 0;

  /** Authoritative current slot index, set by beginSlot(). */
  private currentSlotIndex = 0;

  // ── O(1) bike ID lookup ──
  private bikeIdToIndex: Map<string, number> = new Map();

  private slotServedDemand = 0;
  private slotUnmetDemand = 0;
  private slotWalkTransfers = 0;
  private slotOverflowEvents = 0;
  private slotFailureReasons: FailureReasonCounts = createEmptyReasons();
  private recentUnmetByStation = new Array(STATIONS.length).fill(0);
  private recentOverflowByStation = new Array(STATIONS.length).fill(0);
  private temporaryHeatByStation = new Array(STATIONS.length).fill(0);

  constructor(scenario: ScenarioPackage) {
    this.scenario = scenario;
    this.reset();
  }

  // ── O(1) counter-based getters (replaces O(n) .filter()) ──

  get availableBikeCounts(): number[] {
    return this.counters.map((c) => c.available);
  }

  get brokenBikeCounts(): number[] {
    return this.counters.map((c) => c.broken);
  }

  get maintenanceBikeCounts(): number[] {
    return this.counters.map((c) => c.maintenance);
  }

  get occupiedBikeCounts(): number[] {
    return this.counters.map((c) => c.docked);
  }

  get totalInTransit(): number {
    const totalDocked = this.counters.reduce((sum, c) => sum + c.docked, 0);
    return this.bikes.length - totalDocked;
  }

  // ── Index maintenance helpers ──

  /** Call when a bike's condition or stationId changes. */
  private removeBikeFromCounters(bike: BikeAsset): void {
    if (bike.stationId === null) return;
    const c = this.counters[bike.stationId];
    if (!c) return;
    if (isAvailableCondition(bike.condition)) {
      c.available--;
      // Remove from available-indices list
      const arr = this.stationAvailableIndices[bike.stationId];
      const bikeIdx = this.bikes.indexOf(bike);
      const pos = arr.indexOf(bikeIdx);
      if (pos !== -1) {
        // swap-remove for O(1)
        arr[pos] = arr[arr.length - 1];
        arr.pop();
      }
    }
    if (isBrokenCondition(bike.condition)) c.broken--;
    if (bike.condition === 'maintenance') c.maintenance--;
    if (isDockedCondition(bike.condition)) c.docked--;
  }

  private addBikeToCounters(bike: BikeAsset): void {
    if (bike.stationId === null) return;
    const c = this.counters[bike.stationId];
    if (!c) return;
    if (isAvailableCondition(bike.condition)) {
      c.available++;
      this.stationAvailableIndices[bike.stationId].push(this.bikes.indexOf(bike));
    }
    if (isBrokenCondition(bike.condition)) c.broken++;
    if (bike.condition === 'maintenance') c.maintenance++;
    if (isDockedCondition(bike.condition)) c.docked++;
  }

  /** Transition a bike's condition, updating counters. */
  private setBikeCondition(bike: BikeAsset, newCondition: BikeCondition): void {
    if (bike.condition === newCondition) return;
    this.removeBikeFromCounters(bike);
    bike.condition = newCondition;
    this.addBikeToCounters(bike);
  }

  /** Change both station and condition atomically. */
  private transitionBike(bike: BikeAsset, newStationId: number | null, newCondition: BikeCondition): void {
    this.removeBikeFromCounters(bike);
    bike.stationId = newStationId;
    bike.condition = newCondition;
    this.addBikeToCounters(bike);
  }

  beginSlot(slotIndex: number): void {
    this.currentSlotIndex = slotIndex;
    this.slotServedDemand = 0;
    this.slotUnmetDemand = 0;
    this.slotWalkTransfers = 0;
    this.slotOverflowEvents = 0;
    this.slotFailureReasons = createEmptyReasons();
    this.recentUnmetByStation.fill(0);
    this.recentOverflowByStation.fill(0);
    this.temporaryHeatByStation = this.temporaryHeatByStation.map((value) => value * 0.72);

    // Process waiting queues: serve or expire
    this.processWaitingQueues();
  }

  /** Enqueue a rider who couldn't find a bike at the station. */
  enqueueWaiter(stationId: number, maxWaitSlots: number, currentSlot: number): void {
    if (!this.waitingQueues[stationId]) {
      this.waitingQueues[stationId] = [];
    }
    this.waitingQueues[stationId].push({
      enqueuedSlot: currentSlot,
      maxWaitSlots,
      stationId,
    });
  }

  /** Process all waiting queues: serve riders if bikes available, expire those who waited too long. */
  private processWaitingQueues(): void {
    const currentSlot = this.currentSlotIndex;

    for (let stationId = 0; stationId < this.waitingQueues.length; stationId++) {
      const queue = this.waitingQueues[stationId];
      if (!queue || queue.length === 0) continue;

      const remaining: typeof queue = [];
      for (const waiter of queue) {
        const waitedSlots = currentSlot - waiter.enqueuedSlot;
        if (waitedSlots >= waiter.maxWaitSlots) {
          // Rider gives up
          this.recordFailure(stationId, 'gave_up_after_wait');
          this.totalGaveUpAfterWait++;
          continue;
        }

        // Try to serve from queue
        const result = this.tryCheckoutBike(stationId, currentSlot);
        if (result.ok) {
          this.totalServedDemand++;
          this.slotServedDemand++;
          // Note: the ride details for queued riders are simplified
          // (they just complete the checkout, the ride was already planned)
        } else {
          remaining.push(waiter);
        }
      }
      this.waitingQueues[stationId] = remaining;
    }
  }

  buildStationStates(): StationStateV2[] {
    return STATIONS.map((station) => {
      const c = this.counters[station.id];
      const cap = station.capacity;
      const stockRatio = cap > 0 ? c.available / cap : 0;
      const brokenRatio = cap > 0 ? (c.broken + c.maintenance) / cap : 0;
      const unmetPressure = cap > 0 ? this.recentUnmetByStation[station.id] / cap : 0;
      const overflowPressure = cap > 0 ? this.recentOverflowByStation[station.id] / cap : 0;
      const pressureIndex = clamp(
        (1 - stockRatio) * 0.55
          + brokenRatio * 0.2
          + unmetPressure * 0.18
          + overflowPressure * 0.14
          + this.temporaryHeatByStation[station.id] * 0.12,
        0,
        1,
      );

      return {
        stationId: station.id,
        availableBikes: c.available,
        brokenBikes: c.broken,
        maintenanceBikes: c.maintenance,
        emptyDockCount: Math.max(0, station.capacity - c.docked),
        queuedReturns: 0,
        overflowReturns: this.recentOverflowByStation[station.id],
        recentUnmetDemand: this.recentUnmetByStation[station.id],
        temporaryHeat: this.temporaryHeatByStation[station.id],
        pressureIndex,
      };
    });
  }

  markWalkTransfer(): void {
    this.totalWalkTransfers++;
    this.slotWalkTransfers++;
  }

  recordFailure(stationId: number, reason: FailureReason): void {
    this.totalUnmetDemand++;
    this.slotUnmetDemand++;
    this.failureReasonCounts[reason]++;
    this.slotFailureReasons[reason]++;
    this.recentUnmetByStation[stationId]++;
    this.temporaryHeatByStation[stationId] += 0.1;
  }

  tryCheckoutBike(stationId: number, slotIndex: number): { ok: true; bike: BikeAsset } | { ok: false; reason: FailureReason } {
    const availableList = this.stationAvailableIndices[stationId];
    if (!availableList || availableList.length === 0) {
      return { ok: false, reason: 'no_bike' };
    }

    // Pick a random available bike from the indexed list
    const pickIdx = Math.floor(random() * availableList.length);
    const bikeArrayIdx = availableList[pickIdx];
    const bike = this.bikes[bikeArrayIdx];

    if (
      bike.health <= this.scenario.bikeHealth.failureThreshold
      && random() < 0.28 + (1 - bike.health) * 0.35
    ) {
      this.transitionBike(bike, bike.stationId, 'maintenance');
      bike.recoveryReadySlot = slotIndex + this.scenario.bikeHealth.recoverySlots;
      return { ok: false, reason: 'bike_fault' };
    }

    this.transitionBike(bike, null, 'in_transit');
    return { ok: true, bike };
  }

  createRide(ride: ActiveRideV2): void {
    this.activeRides.push(ride);
    this.totalServedDemand++;
    this.slotServedDemand++;
    this.temporaryHeatByStation[ride.origin] += 0.06;
  }

  processArrivals(nowMs: number, slotIndex: number): void {
    const remaining: ActiveRideV2[] = [];
    for (const ride of this.activeRides) {
      if (nowMs < ride.arrivalTime) {
        ride.progress = (nowMs - ride.departureTime) / (ride.arrivalTime - ride.departureTime);
        remaining.push(ride);
        continue;
      }

      this.completeRide(
        ride.bikeId,
        ride.plannedDestination,
        ride.fallbackStations,
        slotIndex,
        ride.overflowMeters,
      );
    }
    this.activeRides = remaining;
  }

  completeRide(
    bikeId: string,
    preferredStationId: number,
    candidateStations: number[],
    slotIndex: number,
    overflowMeters: number,
  ): { dockedStationId: number | null; overflowed: boolean } {
    const bikeIdx = this.bikeIdToIndex.get(bikeId);
    const bike = bikeIdx !== undefined ? this.bikes[bikeIdx] : undefined;
    if (!bike) {
      return { dockedStationId: null, overflowed: false };
    }

    for (const stationId of candidateStations) {
      const occupied = this.counters[stationId]?.docked ?? 0;
      if (occupied < STATIONS[stationId].capacity) {
        const overflowed = stationId !== preferredStationId || overflowMeters > 0;
        if (overflowed) {
          this.totalOverflowEvents++;
          this.slotOverflowEvents++;
          this.recentOverflowByStation[preferredStationId]++;
          this.temporaryHeatByStation[preferredStationId] += 0.08;
        }
        this.finalizeBikeAfterRide(bike, stationId, slotIndex, overflowed);
        return { dockedStationId: stationId, overflowed };
      }
    }

    const fallback = candidateStations[0] ?? preferredStationId;
    this.totalOverflowEvents++;
    this.slotOverflowEvents++;
    this.recentOverflowByStation[preferredStationId]++;
    this.finalizeBikeAfterRide(bike, fallback, slotIndex, true);
    return { dockedStationId: fallback, overflowed: true };
  }

  ageBike(bikeId: string, distanceMeters: number, healthWearMultiplier: number): void {
    const bikeIdx = this.bikeIdToIndex.get(bikeId);
    const bike = bikeIdx !== undefined ? this.bikes[bikeIdx] : undefined;
    if (!bike) return;

    // Increment trip count
    bike.tripCount++;

    // Non-linear degradation: low health accelerates wear
    let healthFactor = 1.0;
    if (bike.health < 0.4) {
      healthFactor = 1.5;  // Accelerated degradation when health is low
    } else if (bike.health < 0.6) {
      healthFactor = 1.2;  // Moderate acceleration
    }

    // Trip-count fatigue: more trips = slightly more wear
    const fatigueFactor = 1 + Math.min(bike.tripCount / 200, 0.3);

    const wear = (distanceMeters / 1000)
      * this.scenario.bikeHealth.wearPerKm
      * healthWearMultiplier
      * healthFactor
      * fatigueFactor
      * (0.9 + random() * 0.2);
    bike.health = clamp(bike.health - wear, 0.04, 1);
  }

  processMaintenance(slotIndex: number): void {
    for (const bike of this.bikes) {
      if (bike.condition === 'recovery' && bike.recoveryReadySlot !== null && slotIndex >= bike.recoveryReadySlot) {
        this.setBikeCondition(bike, 'healthy');
        bike.recoveryReadySlot = null;
        continue;
      }

      if (
        bike.stationId !== null
        && (bike.condition === 'light_fault' || bike.condition === 'unavailable' || bike.condition === 'maintenance')
        && random() < this.scenario.bikeHealth.repairProbabilityPerSlot
      ) {
        this.setBikeCondition(bike, 'recovery');
        bike.recoveryReadySlot = slotIndex + this.scenario.bikeHealth.recoverySlots;
        bike.health = clamp(bike.health + 0.28, 0.52, 0.9);
        this.totalRepairsCompleted++;
      }
    }
  }

  recordCategoryFlow(originCategoryIndex: number, destinationCategoryIndex: number): void {
    this.odByCategory[originCategoryIndex][destinationCategoryIndex] += 1;
    this.odDirty = true;
  }

  buildStatus(): StationStatus[] {
    return STATIONS.map((station) => ({
      station_id: station.id,
      available_bikes: this.counters[station.id]?.available ?? 0,
      available_docks: Math.max(0, station.capacity - (this.counters[station.id]?.docked ?? 0)),
      timestamp: Math.floor(Date.now() / 1000),
    }));
  }

  applyDispatchPlan(plan: DispatchPlan): void {
    for (const route of plan.vehicle_routes) {
      for (const stop of route.stops) {
        if (stop.action === 'pickup') {
          this.applyDispatchPickup(stop.station_id, stop.bike_count);
        } else {
          this.applyDispatchDropoff(stop.station_id, stop.bike_count);
        }
      }
    }
  }

  applyDispatchPickup(stationId: number, bikeCount: number): number {
    const availableList = this.stationAvailableIndices[stationId];
    const toMove = Math.min(bikeCount, availableList?.length ?? 0);
    for (let i = 0; i < toMove; i++) {
      const bikeIdx = availableList[availableList.length - 1];
      const bike = this.bikes[bikeIdx];
      this.transitionBike(bike, null, 'unavailable');
      bike.recoveryReadySlot = null;
    }
    return toMove;
  }

  applyDispatchDropoff(stationId: number, bikeCount: number): { dropped: number; stationId: number } {
    let remaining = bikeCount;
    let lastStationId = stationId;
    const candidateStations = STATIONS
      .map((station) => station.id)
      .sort((left, right) => {
        const leftDistance = distanceMatrix[stationId]?.[left] ?? Number.MAX_SAFE_INTEGER;
        const rightDistance = distanceMatrix[stationId]?.[right] ?? Number.MAX_SAFE_INTEGER;
        return leftDistance - rightDistance;
      });

    for (const candidateId of candidateStations) {
      if (remaining <= 0) {
        break;
      }

      const occupied = this.counters[candidateId]?.docked ?? 0;
      const space = Math.max(0, STATIONS[candidateId].capacity - occupied);
      if (space <= 0) {
        continue;
      }

      const loadedBikes = this.bikes.filter((bike) => bike.stationId === null && bike.condition === 'unavailable');
      const toPlace = Math.min(remaining, space, loadedBikes.length);
      for (let index = 0; index < toPlace; index++) {
        const bike = loadedBikes[index];
        this.transitionBike(bike, candidateId, 'healthy');
        bike.recoveryReadySlot = null;
      }

      remaining -= toPlace;
      if (toPlace > 0) {
        lastStationId = candidateId;
      }
    }

    return {
      dropped: bikeCount - remaining,
      stationId: lastStationId,
    };
  }

  takeSnapshot(slotIndex: number, context: SlotEnvironmentContext): SimulationSnapshotV2 {
    const stationStates = this.buildStationStates();
    // Only deep-copy odByCategory when it has changed
    const odSnapshot = this.odDirty
      ? this.odByCategory.map((row) => [...row])
      : this.odByCategory;
    this.odDirty = false;

    const snapshot: SimulationSnapshotV2 = {
      slotIndex,
      bikes: stationStates.map((state) => state.availableBikes),
      brokenBikes: stationStates.map((state) => state.brokenBikes),
      maintenanceBikes: stationStates.map((state) => state.maintenanceBikes),
      pressure: stationStates.map((state) => state.pressureIndex),
      servedDemand: this.slotServedDemand,
      unmetDemand: this.slotUnmetDemand,
      cumulativeServed: this.totalServedDemand,
      cumulativeUnmet: this.totalUnmetDemand,
      walkTransfers: this.slotWalkTransfers,
      overflowEvents: this.slotOverflowEvents,
      activeWeather: context.weather,
      activeWeatherLabel: context.weatherLabel,
      activeEvents: context.activeEvents.map((event) => event.label),
      failureReasons: { ...this.slotFailureReasons },
      odByCategory: odSnapshot,
      stationStates,
    };
    if (this.collectSnapshots) {
      this.snapshots.push(snapshot);
    }
    return snapshot;
  }

  reset(): void {
    const totalBikes = useSimEnvStore.getState().totalBikes || this.scenario.totalBikes;
    this.bikes = [];
    this.activeRides = [];
    this.totalServedDemand = 0;
    this.totalUnmetDemand = 0;
    this.totalWalkTransfers = 0;
    this.totalOverflowEvents = 0;
    this.totalRepairsCompleted = 0;
    this.failureReasonCounts = createEmptyReasons();
    this.snapshots = [];
    this.odByCategory = Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => 0));
    this.recentUnmetByStation = new Array(STATIONS.length).fill(0);
    this.recentOverflowByStation = new Array(STATIONS.length).fill(0);
    this.temporaryHeatByStation = new Array(STATIONS.length).fill(0);
    this.waitingQueues = STATIONS.map(() => []);
    this.totalGaveUpAfterWait = 0;
    this.bikeIdToIndex = new Map();

    // Initialize indexed counters
    this.counters = STATIONS.map(() => emptyCounters());
    this.stationAvailableIndices = STATIONS.map(() => []);

    const categoryBudget = { ...this.scenario.initialDistributionBias };
    const categoryAssignments = STATIONS.map((station) => categoryBudget[station.category] ?? 0.1);
    const stationWeights = categoryAssignments.map((value, index) => value * this.scenario.stationHotness[index]);
    const stationWeightTotal = stationWeights.reduce((sum, value) => sum + value, 0);

    for (let i = 0; i < totalBikes; i++) {
      const ticket = random() * stationWeightTotal;
      let cumulative = 0;
      let stationId = 0;
      for (let idx = 0; idx < stationWeights.length; idx++) {
        cumulative += stationWeights[idx];
        if (ticket <= cumulative) {
          stationId = idx;
          break;
        }
      }

      const station = STATIONS[stationId];
      const occupied = this.counters[station.id].docked;
      if (occupied >= station.capacity) {
        const fallback = STATIONS.find((candidate) => {
          return this.counters[candidate.id].docked < candidate.capacity;
        });
        stationId = fallback?.id ?? station.id;
      }

      const health = clamp(0.62 + random() * 0.38, 0.08, 1);
      const condition: BikeCondition =
        health < this.scenario.bikeHealth.failureThreshold && random() < 0.1
          ? 'light_fault'
          : 'healthy';

      const bike: BikeAsset = {
        id: `bike-${i}`,
        stationId,
        condition,
        health,
        recoveryReadySlot: null,
        tripCount: 0,
      };
      this.bikes.push(bike);
      // Update counters directly (bike is already set up)
      this.addBikeToCounters(bike);
    }

    if (stationWeightTotal <= 0) {
      // Clear counters and re-assign
      this.counters = STATIONS.map(() => emptyCounters());
      this.stationAvailableIndices = STATIONS.map(() => []);
      this.bikes.forEach((bike, index) => {
        bike.stationId = index % STATIONS.length;
        this.addBikeToCounters(bike);
      });
    }
    // Build bike ID → index map for O(1) lookups
    this.bikeIdToIndex.clear();
    for (let idx = 0; idx < this.bikes.length; idx++) {
      this.bikeIdToIndex.set(this.bikes[idx].id, idx);
    }
    this.beginSlot(0);
  }

  private finalizeBikeAfterRide(
    bike: BikeAsset,
    stationId: number,
    slotIndex: number,
    overflowed: boolean,
  ): void {
    if (overflowed) {
      this.temporaryHeatByStation[stationId] += 0.04;
    }
    if (bike.health <= this.scenario.bikeHealth.outageThreshold) {
      this.transitionBike(bike, stationId, 'maintenance');
      bike.recoveryReadySlot = slotIndex + this.scenario.bikeHealth.recoverySlots;
      return;
    }
    if (bike.health <= this.scenario.bikeHealth.failureThreshold) {
      const newCondition: BikeCondition = random() < 0.55 ? 'light_fault' : 'maintenance';
      this.transitionBike(bike, stationId, newCondition);
      bike.recoveryReadySlot = newCondition === 'maintenance'
        ? slotIndex + this.scenario.bikeHealth.recoverySlots
        : null;
      return;
    }
    this.transitionBike(bike, stationId, 'healthy');
    bike.recoveryReadySlot = null;
  }
}
