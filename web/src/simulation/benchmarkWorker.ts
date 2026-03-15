/**
 * Web Worker for benchmark computation.
 * Runs the entire simulation loop off the main thread so the browser never freezes.
 *
 * v2: uses AgentSimulator + StationStateManagerV2 as the simulation core so that
 *   - rider behaviour responds to price incentives (departure discounts, arrival rewards)
 *   - bike health / maintenance / overflow are tracked realistically
 *   - demand is generated from scenario profiles rather than a flat lookup table
 *
 * Public API (WorkerRequest / WorkerResponse) is unchanged.
 */
import { StationStateManagerV2 } from './stateManagerV2';
import { AgentSimulator } from './agentSimulator';
import { compileScenarioBundle } from './scenarioCompiler';
import { getDefaultScenarioForDayKind } from '../data/scenarioLibrary';
import { distanceMatrix } from './distanceMatrix';
import { observeRides, rebalanceCycle, resetPredictor, getConfig, updateConfig } from '../api/client';
import { STATIONS } from '../data/stations';
import { seedRandom, clearSeed } from './rng';
import { useSimEnvStore } from '../store/simEnvStore';
import { SLOTS_PER_DAY } from '../types/time';
import { SLOT_DURATION_MS } from '../data/constants';
import type { DispatchPlan, DispatchVehicle } from '../types/dispatch';
import type { DayKind } from '../types/time';
import type { SimEnvConfig } from '../store/simEnvStore';
import type { PriceIncentive } from '../types/incentive';
import type { BenchmarkResult, TuningParams } from '../types/benchmark';
import { planVehicleExecution, type VehicleDispatchExecution } from './dispatchExecution';

// ── Messages ──

export type WorkerRequest =
  | { type: 'runBenchmark'; dayKind: DayKind; days: number; params: TuningParams; seed: number; simEnv: SimEnvConfig }
  | { type: 'runTuning'; dayKind: DayKind; days: number; targetBlockRate: number; targetSatisfaction: number; seed: number; simEnv: SimEnvConfig };

export type WorkerResponse =
  | { type: 'progress'; phase: string; currentSlot: number; totalSlots: number; iteration?: number; totalIterations?: number }
  | { type: 'benchmarkDone'; baseline: BenchmarkResult; optimized: BenchmarkResult }
  | { type: 'tuningProgress'; iteration: number; totalIterations: number; currentSlot: number; totalSlots: number; bestSoFar: { params: TuningParams; result: BenchmarkResult } | null; history: Array<{ params: TuningParams; result: BenchmarkResult }> }
  | { type: 'tuningDone'; history: Array<{ params: TuningParams; result: BenchmarkResult }> }
  | { type: 'error'; message: string };

// ── Fleet helpers ──

interface BenchmarkFleetVehicle extends DispatchVehicle {
  currentLoad: number;
  execution: VehicleDispatchExecution | null;
  wasBusy: boolean;
}

function buildFleetState(vehicleCount: number, vehicleCapacity: number): BenchmarkFleetVehicle[] {
  return Array.from({ length: vehicleCount }, (_, i) => ({
    id: i,
    capacity: vehicleCapacity,
    current_position: 0,
    currentLoad: 0,
    execution: null,
    wasBusy: false,
  }));
}

/**
 * Advance all vehicle executions to `nowMs`, applying pickups/dropoffs to the
 * state manager as vehicles reach each stop.  Returns total bikes physically moved.
 *
 * Works with both StationStateManagerV2 (and legacy V1) because the
 * applyDispatchPickup / applyDispatchDropoff signatures are identical.
 */
function processDispatchExecutions(
  fleet: BenchmarkFleetVehicle[],
  sm: StationStateManagerV2,
  nowMs: number,
): number {
  let movedThisTick = 0;

  for (const vehicle of fleet) {
    const execution = vehicle.execution;
    if (!execution) continue;

    while (
      execution.nextStopIndex < execution.stops.length
      && execution.stops[execution.nextStopIndex].executeAtMs <= nowMs
    ) {
      const nextStop = execution.stops[execution.nextStopIndex];
      execution.nextStopIndex++;

      if (nextStop.stop.action === 'pickup') {
        const requested = Math.min(
          nextStop.stop.bike_count,
          Math.max(0, vehicle.capacity - vehicle.currentLoad),
        );
        const actual = sm.applyDispatchPickup(nextStop.stop.station_id, requested);
        vehicle.currentLoad += actual;
        vehicle.current_position = nextStop.stop.station_id;
        movedThisTick += actual;
        continue;
      }

      const requested = Math.min(nextStop.stop.bike_count, vehicle.currentLoad);
      const result = sm.applyDispatchDropoff(nextStop.stop.station_id, requested);
      vehicle.currentLoad -= result.dropped;
      vehicle.current_position = result.stationId;
    }

    if (execution.nextStopIndex >= execution.stops.length && nowMs >= execution.busyUntilMs) {
      vehicle.execution = null;
      vehicle.wasBusy = true;
    }
  }

  return movedThisTick;
}

function availableFleet(fleet: BenchmarkFleetVehicle[]): DispatchVehicle[] {
  return fleet
    .filter((v) => v.execution === null)
    .map((v) => ({ id: v.id, capacity: v.capacity, current_position: v.current_position }));
}

function scheduleDispatchPlan(
  fleet: BenchmarkFleetVehicle[],
  plan: DispatchPlan,
  routeStartMs: number,
): number {
  let scheduled = 0;
  for (const route of plan.vehicle_routes) {
    if (route.stops.length === 0) continue;
    const vehicle = fleet.find((v) => v.id === route.vehicle_id);
    if (!vehicle || vehicle.execution) continue;
    const execution = planVehicleExecution(vehicle, route, routeStartMs, distanceMatrix);
    if (!execution) continue;
    vehicle.execution = execution;
    scheduled++;
  }
  return scheduled;
}

// ── Core simulation phase ──

async function runPhase(
  dayKind: DayKind,
  totalSlots: number,
  dispatchEnabled: boolean,
  params: TuningParams,
  onProgress: (slot: number) => void,
  seed: number,
): Promise<BenchmarkResult> {
  seedRandom(seed);

  // Build scenario for this day kind and compile it with the given seed.
  const baseScenario = getDefaultScenarioForDayKind(dayKind);
  const scenario = compileScenarioBundle(baseScenario.id, { seed }).scenario;

  const sm       = new StationStateManagerV2(scenario);
  sm.collectSnapshots = false; // Skip snapshot storage in benchmark mode
  const agentSim = new AgentSimulator(scenario);
  const fleet    = buildFleetState(params.vehicleCount, params.vehicleCapacity);

  let dispatchCount        = 0;
  let totalBikesMoved      = 0;
  let minutesSinceRebalance = 0;
  let incentives: PriceIncentive[] = [];

  // ── Backend config update (dispatch phase only) ──
  if (dispatchEnabled) {
    try {
      const cfg = await getConfig();
      await updateConfig({
        ...cfg,
        safety_buffer_ratio:        params.safetyBufferRatio,
        peak_multiplier:            params.peakMultiplier,
        prediction_horizon_slots:   params.predictionHorizonSlots,
        peak_percentile:            params.peakPercentile,
        dispatch_vehicle_count:     params.vehicleCount,
        dispatch_vehicle_capacity:  params.vehicleCapacity,
        rebalance_interval_minutes: params.rebalanceIntervalMinutes,
      });
    } catch { /* keep current backend config */ }

    // ── Predictor warmup: run 4 synthetic days through AgentSimulator ──
    // More warmup days give the predictor a stable baseline under high-noise scenarios.
    for (let pass = 0; pass < 4; pass++) {
      seedRandom(seed + 1000 + pass);
      const warmupSim = new AgentSimulator(scenario);
      const warmupSm  = new StationStateManagerV2(scenario);
      const baseDateMs = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
      const batch: Parameters<typeof observeRides>[0]['records'] = [];

      for (let si = 0; si < SLOTS_PER_DAY; si++) {
        const slotMs = baseDateMs + si * SLOT_DURATION_MS;
        warmupSm.beginSlot(si);
        warmupSm.processMaintenance(si);
        const { observations } = warmupSim.step(si, slotMs, warmupSm);
        warmupSm.processArrivals(slotMs + SLOT_DURATION_MS, si);
        batch.push(...observations);

        if (batch.length >= 160) {
          try { await observeRides({ records: batch.splice(0), day_kind: dayKind }); } catch { /* noop */ }
        }
      }
      if (batch.length > 0) {
        try { await observeRides({ records: batch, day_kind: dayKind }); } catch { /* noop */ }
      }
    }
    seedRandom(seed);
  }

  // ── Main simulation loop ──
  const baseDateMs = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();

  for (let i = 0; i < totalSlots; i++) {
    const slotIndex = i % SLOTS_PER_DAY;
    const slotMs    = baseDateMs + slotIndex * SLOT_DURATION_MS;
    const slotEndMs = slotMs + SLOT_DURATION_MS;

    // Advance vehicle routes that have reached this tick.
    totalBikesMoved += processDispatchExecutions(fleet, sm, slotMs);

    // Run agent-based rider simulation.
    // setIncentives feeds the latest price signals back to the agent model so
    // riders respond to departure discounts and arrival rewards.
    // NOTE: agentSim.step() internally calls sm.beginSlot() and sm.processMaintenance(),
    // so we must NOT call them here to avoid double-processing.
    agentSim.setIncentives(incentives);
    const { observations } = agentSim.step(slotIndex, slotMs, sm);

    // Process ride completions and advance vehicle routes to end of slot.
    sm.processArrivals(slotEndMs, slotIndex);
    totalBikesMoved += processDispatchExecutions(fleet, sm, slotEndMs);

    // Feed observations to the demand predictor.
    if (dispatchEnabled && observations.length > 0) {
      try { await observeRides({ records: observations, day_kind: dayKind }); } catch { /* noop */ }
    }

    minutesSinceRebalance++;

    // ── Dispatch cycle ──
    if (dispatchEnabled) {
      const total     = sm.totalServedDemand + sm.totalUnmetDemand;
      const blockRate = total > 0 ? sm.totalUnmetDemand / total : 0;

      // Adaptive dispatch interval: more frequent when block rate is high
      const effectiveInterval = blockRate >= 0.20 ? 8
        : blockRate >= 0.10 ? 12
        : params.rebalanceIntervalMinutes;

      // Immediate re-dispatch: vehicles that just finished a route get dispatched right away
      const justFinished = fleet.filter((v) => v.execution === null && v.wasBusy);
      if (justFinished.length > 0) {
        // Reset wasBusy flags
        for (const v of justFinished) v.wasBusy = false;
        const reDispatchVehicles = justFinished.map((v) => ({
          id: v.id, capacity: v.capacity, current_position: v.current_position,
        }));
        try {
          const resp = await rebalanceCycle({
            stations:        STATIONS,
            current_status:  sm.buildStatus(),
            distance_matrix: distanceMatrix,
            vehicles:        reDispatchVehicles,
            current_slot:    { day_kind: dayKind, slot_index: slotIndex },
            block_rate:      blockRate,
          });
          incentives = resp.incentives;
          if (scheduleDispatchPlan(fleet, resp.dispatch_plan, slotEndMs) > 0) {
            dispatchCount++;
          }
        } catch { /* noop */ }
      }

      // Scheduled interval dispatch: fallback for all idle vehicles
      if (minutesSinceRebalance >= effectiveInterval) {
        minutesSinceRebalance = 0;
        // Reset any remaining wasBusy flags
        for (const v of fleet) v.wasBusy = false;
        const vehicles = availableFleet(fleet);
        if (vehicles.length > 0) {
          try {
            const resp = await rebalanceCycle({
              stations:        STATIONS,
              current_status:  sm.buildStatus(),
              distance_matrix: distanceMatrix,
              vehicles,
              current_slot:    { day_kind: dayKind, slot_index: slotIndex },
              block_rate:      blockRate,
            });
            incentives = resp.incentives;
            if (scheduleDispatchPlan(fleet, resp.dispatch_plan, slotEndMs) > 0) {
              dispatchCount++;
            }
          } catch { /* noop */ }
        } else {
          // No vehicles available, but still fetch incentives for demand shaping
          try {
            const resp = await rebalanceCycle({
              stations:        STATIONS,
              current_status:  sm.buildStatus(),
              distance_matrix: distanceMatrix,
              vehicles:        [],
              current_slot:    { day_kind: dayKind, slot_index: slotIndex },
              block_rate:      blockRate,
            });
            incentives = resp.incentives;
          } catch { /* noop */ }
        }
      }
    }

    onProgress(i + 1);
  }

  clearSeed();

  // ── Summarise results ──
  const counts   = sm.availableBikeCounts;
  const ratios   = STATIONS.map((st) => counts[st.id] / st.capacity);
  const mean     = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const variance = ratios.reduce((s, r) => s + (r - mean) ** 2, 0) / ratios.length;
  const total    = sm.totalServedDemand + sm.totalUnmetDemand;

  return {
    totalRides:       sm.totalServedDemand,
    blockedCount:     sm.totalUnmetDemand,
    blockRate:        total > 0 ? sm.totalUnmetDemand / total : 0,
    dispatchCount,
    totalBikesMoved,
    bikeStdDev:       Math.sqrt(variance),
    satisfactionRate: total > 0 ? sm.totalServedDemand / total : 1,
    finalBikes:       counts,
  };
}

// ── Backend health check ──

async function checkBackendAvailable(): Promise<boolean> {
  try {
    await getConfig();
    return true;
  } catch {
    return false;
  }
}

// ── Default params ──

const DEFAULT_PARAMS: TuningParams = {
  vehicleCount:             5,
  vehicleCapacity:          20,
  rebalanceIntervalMinutes: 15,
  safetyBufferRatio:        0.5,
  peakMultiplier:           2.5,
  predictionHorizonSlots:   8,
  peakPercentile:           0.8,
};

// ── Message handler ──

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;

  // Apply simEnv config inside the worker's store instance before any simulation runs.
  if ('simEnv' in msg) {
    useSimEnvStore.getState().applyPreset(msg.simEnv);
  }

  if (msg.type === 'runBenchmark') {
    const { dayKind, days, params, seed } = msg;
    const p          = params ?? DEFAULT_PARAMS;
    const totalSlots = days * SLOTS_PER_DAY;
    const post       = (r: WorkerResponse) => self.postMessage(r);

    // Verify backend is reachable before running dispatch phase.
    const backendOk = await checkBackendAvailable();
    if (!backendOk) {
      post({ type: 'error', message: '后端服务未启动，无法执行调度对比。请先启动后端 (cargo run) 后重试。' });
      return;
    }

    try { await resetPredictor(); } catch { /* noop */ }

    // Phase 1: baseline — no dispatch, no incentives.
    post({ type: 'progress', phase: 'no-dispatch', currentSlot: 0, totalSlots });
    const baseline = await runPhase(dayKind, totalSlots, false, p, (slot) => {
      post({ type: 'progress', phase: 'no-dispatch', currentSlot: slot, totalSlots });
    }, seed);

    // Phase 2: optimised — dispatch + incentive feedback loop.
    post({ type: 'progress', phase: 'warmup', currentSlot: 0, totalSlots });
    const optimized = await runPhase(dayKind, totalSlots, true, p, (slot) => {
      post({ type: 'progress', phase: 'with-dispatch', currentSlot: slot, totalSlots });
    }, seed);

    post({ type: 'benchmarkDone', baseline, optimized });
  }

  if (msg.type === 'runTuning') {
    const { dayKind, days, targetBlockRate, targetSatisfaction, seed } = msg;
    const totalSlots = days * SLOTS_PER_DAY;
    const post       = (r: WorkerResponse) => self.postMessage(r);

    const backendOk = await checkBackendAvailable();
    if (!backendOk) {
      post({ type: 'error', message: '后端服务未启动，无法执行调参。请先启动后端 (cargo run) 后重试。' });
      return;
    }

    const history: Array<{ params: TuningParams; result: BenchmarkResult }> = [];
    let best: { params: TuningParams; result: BenchmarkResult } | null = null;
    let expansionRounds = 0;

    const candidates: TuningParams[] = [
      { vehicleCount: 5,  vehicleCapacity: 20, rebalanceIntervalMinutes: 15, safetyBufferRatio: 0.35, peakMultiplier: 2.0, predictionHorizonSlots: 6,  peakPercentile: 0.8 },
      { vehicleCount: 5,  vehicleCapacity: 25, rebalanceIntervalMinutes: 15, safetyBufferRatio: 0.45, peakMultiplier: 2.5, predictionHorizonSlots: 8,  peakPercentile: 0.6 },
      { vehicleCount: 8,  vehicleCapacity: 25, rebalanceIntervalMinutes: 15, safetyBufferRatio: 0.50, peakMultiplier: 2.5, predictionHorizonSlots: 8,  peakPercentile: 0.5 },
      { vehicleCount: 8,  vehicleCapacity: 30, rebalanceIntervalMinutes: 15, safetyBufferRatio: 0.55, peakMultiplier: 3.0, predictionHorizonSlots: 10, peakPercentile: 0.5 },
      { vehicleCount: 10, vehicleCapacity: 30, rebalanceIntervalMinutes: 15, safetyBufferRatio: 0.60, peakMultiplier: 3.0, predictionHorizonSlots: 10, peakPercentile: 0.4 },
      { vehicleCount: 12, vehicleCapacity: 35, rebalanceIntervalMinutes: 15, safetyBufferRatio: 0.65, peakMultiplier: 3.0, predictionHorizonSlots: 12, peakPercentile: 0.3 },
      { vehicleCount: 12, vehicleCapacity: 35, rebalanceIntervalMinutes: 30, safetyBufferRatio: 0.65, peakMultiplier: 3.0, predictionHorizonSlots: 12, peakPercentile: 0.3 },
      { vehicleCount: 15, vehicleCapacity: 40, rebalanceIntervalMinutes: 15, safetyBufferRatio: 0.65, peakMultiplier: 3.5, predictionHorizonSlots: 12, peakPercentile: 0.3 },
    ];

    for (let i = 0; i < candidates.length; i++) {
      const params = candidates[i];
      const post   = (r: WorkerResponse) => self.postMessage(r);

      post({ type: 'tuningProgress', iteration: i + 1, totalIterations: candidates.length, currentSlot: 0, totalSlots, bestSoFar: best, history: [...history] });

      try { await resetPredictor(); } catch { /* noop */ }

      const result = await runPhase(dayKind, totalSlots, true, params, (slot) => {
        post({ type: 'tuningProgress', iteration: i + 1, totalIterations: candidates.length, currentSlot: slot, totalSlots, bestSoFar: best, history: [...history] });
      }, seed);

      const iter = { params, result };
      history.push(iter);
      if (!best || result.blockRate < best.result.blockRate) best = iter;

      if (result.blockRate <= targetBlockRate && result.satisfactionRate >= targetSatisfaction) {
        self.postMessage({ type: 'tuningDone', history } as WorkerResponse);
        return;
      }

      if (i === candidates.length - 1 && best && best.result.blockRate > targetBlockRate && expansionRounds < 1) {
        expansionRounds++;
        const b = best.params;
        candidates.push(
          { ...b, vehicleCount: b.vehicleCount + 2, vehicleCapacity: b.vehicleCapacity + 5 },
          { ...b, vehicleCount: b.vehicleCount + 4, safetyBufferRatio: Math.min(b.safetyBufferRatio + 0.1, 0.8) },
          { ...b, vehicleCount: b.vehicleCount + 4, vehicleCapacity: b.vehicleCapacity + 10, peakMultiplier: b.peakMultiplier + 0.5 },
        );
      }
    }

    self.postMessage({ type: 'tuningDone', history } as WorkerResponse);
  }
};
