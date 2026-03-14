import { StationStateManager } from './stateManager';
import { generateDemand, generateFullDayHistory } from './demandGenerator';
import { distanceMatrix } from './distanceMatrix';
import { observeRides, rebalanceCycle, resetPredictor } from '../api/client';
import { updateConfig, getConfig } from '../api/client';
import { STATIONS } from '../data/stations';
import { seedRandom, clearSeed } from './rng';
import type { DayKind } from '../types/time';
import type { Snapshot } from './stateManager';

export interface BenchmarkResult {
  totalRides: number;
  blockedCount: number;
  blockRate: number;
  dispatchCount: number;
  totalBikesMoved: number;
  bikeStdDev: number;
  satisfactionRate: number;
  snapshots: Snapshot[];
  finalBikes: number[];
}

export type BenchmarkPhase = 'idle' | 'warmup' | 'no-dispatch' | 'with-dispatch' | 'done';

export interface BenchmarkProgress {
  phase: BenchmarkPhase;
  currentSlot: number;
  totalSlots: number;
}

/** Tunable dispatch parameters */
export interface TuningParams {
  vehicleCount: number;
  vehicleCapacity: number;
  rebalanceIntervalSlots: number;
  safetyBufferRatio: number;
  peakMultiplier: number;
  predictionHorizonSlots: number;
}

export const DEFAULT_PARAMS: TuningParams = {
  vehicleCount: 3,
  vehicleCapacity: 15,
  rebalanceIntervalSlots: 1,
  safetyBufferRatio: 0.35,
  peakMultiplier: 2.0,
  predictionHorizonSlots: 6,
};

/**
 * Run one benchmark phase with given parameters.
 */
async function runPhase(
  dayKind: DayKind,
  totalSlots: number,
  dispatchEnabled: boolean,
  params: TuningParams,
  onProgress: (slot: number) => void,
  seed: number = 42,
): Promise<BenchmarkResult> {
  // Seed the PRNG so every phase generates the same demand sequence
  seedRandom(seed);
  const sm = new StationStateManager();
  let dispatchCount = 0;
  let totalBikesMoved = 0;
  let slotsSinceRebalance = 0;

  // Apply backend config
  if (dispatchEnabled) {
    try {
      const cfg = await getConfig();
      await updateConfig({
        ...cfg,
        safety_buffer_ratio: params.safetyBufferRatio,
        peak_multiplier: params.peakMultiplier,
        prediction_horizon_slots: params.predictionHorizonSlots,
        dispatch_vehicle_count: params.vehicleCount,
        dispatch_vehicle_capacity: params.vehicleCapacity,
        rebalance_interval_minutes: params.rebalanceIntervalSlots * 15,
      });
    } catch { /* noop */ }

    // Warmup predictor with multiple passes to let EWMA converge
    for (let pass = 0; pass < 5; pass++) {
      seedRandom(seed + 1000 + pass);
      const history = generateFullDayHistory(new Date().toISOString());
      for (let s = 0; s < 96; s++) {
        if (history[s].length > 0) {
          try { await observeRides({ records: history[s], day_kind: dayKind }); } catch { /* noop */ }
        }
      }
    }
    // Reset to the main seed for the actual simulation
    seedRandom(seed);
  }

  for (let i = 0; i < totalSlots; i++) {
    const slotIndex = i % 96;

    const baseTime = new Date();
    baseTime.setHours(0, 0, 0, 0);
    const slotTimeMs = baseTime.getTime() + slotIndex * 15 * 60 * 1000;
    const records = generateDemand(slotIndex, new Date(slotTimeMs).toISOString());

    sm.processDepartures(records);
    sm.processArrivals(slotTimeMs + 15 * 60 * 1000);

    if (dispatchEnabled && records.length > 0) {
      try { await observeRides({ records, day_kind: dayKind }); } catch { /* noop */ }
    }

    slotsSinceRebalance++;

    if (dispatchEnabled && slotsSinceRebalance >= params.rebalanceIntervalSlots) {
      slotsSinceRebalance = 0;
      try {
        const vehicles = Array.from({ length: params.vehicleCount }, (_, vi) => ({
          id: vi,
          capacity: params.vehicleCapacity,
          current_position: 0,
        }));
        const resp = await rebalanceCycle({
          stations: STATIONS,
          current_status: sm.buildStatus(),
          distance_matrix: distanceMatrix,
          vehicles,
          current_slot: { day_kind: dayKind, slot_index: slotIndex },
        });
        sm.applyDispatchPlan(resp.dispatch_plan);
        dispatchCount++;
        totalBikesMoved += resp.dispatch_plan.total_bikes_moved;
      } catch { /* noop */ }
    }

    sm.takeSnapshot(slotIndex);
    onProgress(i + 1);

    if (i % 4 === 0) {
      await new Promise(r => setTimeout(r, 0));
    }
  }

  // Restore non-deterministic random after benchmark phase
  clearSeed();

  const ratios = STATIONS.map((st) => sm.bikes[st.id] / st.capacity);
  const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const variance = ratios.reduce((s, r) => s + (r - mean) ** 2, 0) / ratios.length;
  const totalAttempts = sm.totalRides + sm.blockedCount;

  return {
    totalRides: sm.totalRides,
    blockedCount: sm.blockedCount,
    blockRate: totalAttempts > 0 ? sm.blockedCount / totalAttempts : 0,
    dispatchCount,
    totalBikesMoved,
    bikeStdDev: Math.sqrt(variance),
    satisfactionRate: totalAttempts > 0 ? sm.totalRides / totalAttempts : 1,
    snapshots: [...sm.snapshots],
    finalBikes: [...sm.bikes],
  };
}

/**
 * Run the full A/B benchmark with given params.
 * Both phases use the same `seed` so they face identical demand sequences.
 */
export async function runBenchmark(
  dayKind: DayKind,
  days: number,
  onProgress: (p: BenchmarkProgress) => void,
  params?: TuningParams,
  seed: number = 42,
): Promise<{ baseline: BenchmarkResult; optimized: BenchmarkResult }> {
  const p = params ?? DEFAULT_PARAMS;
  const totalSlots = days * 96;

  // Reset predictor to clear any stale state from previous runs
  try { await resetPredictor(); } catch { /* noop */ }

  onProgress({ phase: 'no-dispatch', currentSlot: 0, totalSlots });
  const baseline = await runPhase(dayKind, totalSlots, false, p, (slot) => {
    onProgress({ phase: 'no-dispatch', currentSlot: slot, totalSlots });
  }, seed);

  onProgress({ phase: 'warmup', currentSlot: 0, totalSlots });
  const optimized = await runPhase(dayKind, totalSlots, true, p, (slot) => {
    onProgress({ phase: 'with-dispatch', currentSlot: slot, totalSlots });
  }, seed);

  onProgress({ phase: 'done', currentSlot: totalSlots, totalSlots });
  return { baseline, optimized };
}

// ─── Auto-Tuning ────────────────────────────────────────────────

export interface TuningIteration {
  params: TuningParams;
  result: BenchmarkResult;
}

export type TunerPhase = 'idle' | 'running' | 'done';

export interface TunerProgress {
  phase: TunerPhase;
  iteration: number;
  totalIterations: number;
  currentSlot: number;
  totalSlots: number;
  bestSoFar: TuningIteration | null;
  history: TuningIteration[];
}

/**
 * Auto-tune: iteratively search for parameters that achieve
 * blockRate <= targetBlockRate and satisfactionRate >= targetSatisfaction.
 */
export async function autoTune(
  dayKind: DayKind,
  days: number,
  targetBlockRate: number,
  targetSatisfaction: number,
  onProgress: (p: TunerProgress) => void,
  seed: number = 42,
): Promise<TuningIteration[]> {
  const totalSlots = days * 96;
  const history: TuningIteration[] = [];
  let best: TuningIteration | null = null;
  let expansionRounds = 0;
  const MAX_EXPANSION_ROUNDS = 1;

  // Parameter search space — systematic escalation
  const candidates: TuningParams[] = [
    // Round 1: moderate improvements
    { vehicleCount: 3, vehicleCapacity: 15, rebalanceIntervalSlots: 1, safetyBufferRatio: 0.30, peakMultiplier: 2.0, predictionHorizonSlots: 4 },
    { vehicleCount: 5, vehicleCapacity: 20, rebalanceIntervalSlots: 1, safetyBufferRatio: 0.30, peakMultiplier: 2.0, predictionHorizonSlots: 4 },
    // Round 2: aggressive
    { vehicleCount: 5, vehicleCapacity: 25, rebalanceIntervalSlots: 1, safetyBufferRatio: 0.35, peakMultiplier: 2.5, predictionHorizonSlots: 6 },
    { vehicleCount: 6, vehicleCapacity: 25, rebalanceIntervalSlots: 1, safetyBufferRatio: 0.40, peakMultiplier: 2.5, predictionHorizonSlots: 6 },
    // Round 3: very aggressive
    { vehicleCount: 8, vehicleCapacity: 30, rebalanceIntervalSlots: 1, safetyBufferRatio: 0.45, peakMultiplier: 3.0, predictionHorizonSlots: 8 },
    { vehicleCount: 8, vehicleCapacity: 35, rebalanceIntervalSlots: 1, safetyBufferRatio: 0.50, peakMultiplier: 3.0, predictionHorizonSlots: 8 },
    // Round 4: maximum
    { vehicleCount: 10, vehicleCapacity: 40, rebalanceIntervalSlots: 1, safetyBufferRatio: 0.50, peakMultiplier: 3.5, predictionHorizonSlots: 8 },
    { vehicleCount: 10, vehicleCapacity: 40, rebalanceIntervalSlots: 1, safetyBufferRatio: 0.60, peakMultiplier: 4.0, predictionHorizonSlots: 10 },
  ];

  for (let i = 0; i < candidates.length; i++) {
    const params = candidates[i];

    onProgress({
      phase: 'running',
      iteration: i + 1,
      totalIterations: candidates.length,
      currentSlot: 0,
      totalSlots,
      bestSoFar: best,
      history: [...history],
    });

    // Reset predictor before each iteration to avoid state pollution
    try { await resetPredictor(); } catch { /* noop */ }

    const result = await runPhase(dayKind, totalSlots, true, params, (slot) => {
      onProgress({
        phase: 'running',
        iteration: i + 1,
        totalIterations: candidates.length,
        currentSlot: slot,
        totalSlots,
        bestSoFar: best,
        history: [...history],
      });
    }, seed);

    const iter: TuningIteration = { params, result };
    history.push(iter);

    if (!best || result.blockRate < best.result.blockRate) {
      best = iter;
    }

    // Early exit if target reached
    if (result.blockRate <= targetBlockRate && result.satisfactionRate >= targetSatisfaction) {
      onProgress({
        phase: 'done',
        iteration: i + 1,
        totalIterations: candidates.length,
        currentSlot: totalSlots,
        totalSlots,
        bestSoFar: best,
        history,
      });
      return history;
    }

    // If we're in the later rounds and the best so far is close,
    // try fine-tuning around the best parameters
    if (i === candidates.length - 1 && best && best.result.blockRate > targetBlockRate && expansionRounds < MAX_EXPANSION_ROUNDS) {
      expansionRounds++;
      // Generate more candidates around the best
      const b = best.params;
      const extras: TuningParams[] = [
        { ...b, vehicleCount: b.vehicleCount + 2, vehicleCapacity: b.vehicleCapacity + 5 },
        { ...b, vehicleCount: b.vehicleCount + 4, safetyBufferRatio: Math.min(b.safetyBufferRatio + 0.1, 0.8) },
        { ...b, vehicleCount: b.vehicleCount + 4, vehicleCapacity: b.vehicleCapacity + 10, peakMultiplier: b.peakMultiplier + 1 },
      ];
      candidates.push(...extras);
    }
  }

  onProgress({
    phase: 'done',
    iteration: history.length,
    totalIterations: history.length,
    currentSlot: totalSlots,
    totalSlots,
    bestSoFar: best,
    history,
  });
  return history;
}
