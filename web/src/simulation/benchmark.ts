/**
 * Benchmark module — thin wrapper that runs the heavy simulation
 * in a Web Worker to keep the browser UI fully responsive.
 *
 * v2: Auto-tune uses a Worker pool for parallel candidate evaluation.
 */
import type { DayKind } from '../types/time';
import type { Snapshot } from './stateManager';
import { useSimEnvStore } from '../store/simEnvStore';
import type { WorkerRequest, WorkerResponse } from './benchmarkWorker';

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
  rebalanceIntervalMinutes: number;
  safetyBufferRatio: number;
  peakMultiplier: number;
  predictionHorizonSlots: number;
  peakPercentile: number;
}

export const DEFAULT_PARAMS: TuningParams = {
  vehicleCount: 5,
  vehicleCapacity: 20,
  rebalanceIntervalMinutes: 15,
  safetyBufferRatio: 0.5,
  peakMultiplier: 2.5,
  predictionHorizonSlots: 8,
  peakPercentile: 0.8,
};

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

// ── Worker helper ──

function createBenchmarkWorker(): Worker {
  return new Worker(
    new URL('./benchmarkWorker.ts', import.meta.url),
    { type: 'module' },
  );
}

/** Maximum number of parallel workers for tuning. */
function maxParallelWorkers(): number {
  const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency
    ? navigator.hardwareConcurrency
    : 4;
  return Math.max(1, Math.floor(cores / 2));
}

/**
 * Run the full A/B benchmark (no-dispatch vs with-dispatch).
 * Computation runs in a Web Worker — the main thread stays responsive.
 */
export function runBenchmark(
  dayKind: DayKind,
  days: number,
  onProgress: (p: BenchmarkProgress) => void,
  params?: TuningParams,
  seed: number = 42,
): Promise<{ baseline: BenchmarkResult; optimized: BenchmarkResult }> {
  const p = params ?? DEFAULT_PARAMS;
  const simEnv = useSimEnvStore.getState();

  return new Promise((resolve, reject) => {
    const worker = createBenchmarkWorker();

    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        onProgress({
          phase: msg.phase as BenchmarkPhase,
          currentSlot: msg.currentSlot,
          totalSlots: msg.totalSlots,
        });
      } else if (msg.type === 'benchmarkDone') {
        // Add empty snapshots for compatibility (worker doesn't send full snapshot data)
        const baseline: BenchmarkResult = { ...msg.baseline, snapshots: [] };
        const optimized: BenchmarkResult = { ...msg.optimized, snapshots: [] };
        worker.terminate();
        resolve({ baseline, optimized });
      }
    };

    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(`Benchmark worker error: ${e.message}`));
    };

    const request: WorkerRequest = {
      type: 'runBenchmark',
      dayKind,
      days,
      params: p,
      seed,
      simEnv: { totalBikes: simEnv.totalBikes, demandMultiplier: simEnv.demandMultiplier, peakIntensity: simEnv.peakIntensity, noiseFactor: simEnv.noiseFactor },
    };
    worker.postMessage(request);
  });
}

/**
 * Auto-tune: iteratively search for parameters that achieve target metrics.
 * Uses a Worker pool to evaluate candidates in parallel where possible.
 */
export function autoTune(
  dayKind: DayKind,
  days: number,
  targetBlockRate: number,
  targetSatisfaction: number,
  onProgress: (p: TunerProgress) => void,
  seed: number = 42,
): Promise<TuningIteration[]> {
  const simEnv = useSimEnvStore.getState();
  const poolSize = maxParallelWorkers();

  return new Promise((resolve, reject) => {
    // Use pool-based parallel tuning
    const worker = createBenchmarkWorker();
    const history: TuningIteration[] = [];
    let targetReached = false;

    // For parallel evaluation, we run batches of candidates simultaneously
    if (poolSize >= 2) {
      // Parallel mode: run multiple workers evaluating different candidates
      const parallelWorkers: Worker[] = [];
      const candidates = buildTuningCandidates();
      let nextCandidate = 0;
      let best: TuningIteration | null = null;
      let activeWorkers = 0;

      const startNext = () => {
        while (activeWorkers < poolSize && nextCandidate < candidates.length && !targetReached) {
          const candidateIndex = nextCandidate++;
          const params = candidates[candidateIndex];
          activeWorkers++;

          const w = createBenchmarkWorker();
          parallelWorkers.push(w);

          w.onmessage = (e: MessageEvent<WorkerResponse>) => {
            const msg = e.data;
            if (msg.type === 'tuningProgress') {
              onProgress({
                phase: 'running',
                iteration: history.length + 1,
                totalIterations: candidates.length,
                currentSlot: msg.currentSlot,
                totalSlots: msg.totalSlots,
                bestSoFar: best,
                history: [...history],
              });
            } else if (msg.type === 'benchmarkDone') {
              const result: BenchmarkResult = { ...msg.optimized, snapshots: [] };
              const iter: TuningIteration = { params, result };
              history.push(iter);
              if (!best || result.blockRate < best.result.blockRate) {
                best = iter;
              }
              activeWorkers--;
              w.terminate();

              if (result.blockRate <= targetBlockRate && result.satisfactionRate >= targetSatisfaction) {
                targetReached = true;
                // Terminate remaining workers
                for (const pw of parallelWorkers) {
                  try { pw.terminate(); } catch { /* noop */ }
                }
                resolve(history);
                return;
              }

              onProgress({
                phase: 'running',
                iteration: history.length,
                totalIterations: candidates.length,
                currentSlot: 0,
                totalSlots: 1,
                bestSoFar: best,
                history: [...history],
              });

              if (nextCandidate >= candidates.length && activeWorkers === 0) {
                resolve(history);
                return;
              }

              startNext();
            }
          };

          w.onerror = () => {
            activeWorkers--;
            w.terminate();
            if (nextCandidate >= candidates.length && activeWorkers === 0 && !targetReached) {
              resolve(history);
            }
            startNext();
          };

          const simEnvConfig = { totalBikes: simEnv.totalBikes, demandMultiplier: simEnv.demandMultiplier, peakIntensity: simEnv.peakIntensity, noiseFactor: simEnv.noiseFactor };
          const request: WorkerRequest = {
            type: 'runBenchmark',
            dayKind,
            days,
            params,
            seed: seed + candidateIndex,
            simEnv: simEnvConfig,
          };
          w.postMessage(request);
        }
      };

      startNext();
    } else {
      // Fallback: single-worker sequential tuning (original behavior)
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const msg = e.data;
        if (msg.type === 'tuningProgress') {
          const patchResult = (r: { params: TuningParams; result: Omit<BenchmarkResult, 'snapshots'> }) => ({
            params: r.params,
            result: { ...r.result, snapshots: [] as Snapshot[] },
          });
          onProgress({
            phase: 'running',
            iteration: msg.iteration,
            totalIterations: msg.totalIterations,
            currentSlot: msg.currentSlot,
            totalSlots: msg.totalSlots,
            bestSoFar: msg.bestSoFar ? patchResult(msg.bestSoFar) : null,
            history: msg.history.map(patchResult),
          });
        } else if (msg.type === 'tuningDone') {
          worker.terminate();
          resolve(msg.history.map((h) => ({
            params: h.params,
            result: { ...h.result, snapshots: [] as Snapshot[] },
          })));
        }
      };

      worker.onerror = (e) => {
        worker.terminate();
        reject(new Error(`Tuning worker error: ${e.message}`));
      };

      const request: WorkerRequest = {
        type: 'runTuning',
        dayKind,
        days,
        targetBlockRate,
        targetSatisfaction,
        seed,
        simEnv: { totalBikes: simEnv.totalBikes, demandMultiplier: simEnv.demandMultiplier, peakIntensity: simEnv.peakIntensity, noiseFactor: simEnv.noiseFactor },
      };
      worker.postMessage(request);
    }
  });
}

/** Build the default tuning candidate set. */
function buildTuningCandidates(): TuningParams[] {
  return [
    { vehicleCount: 5,  vehicleCapacity: 20, rebalanceIntervalMinutes: 15, safetyBufferRatio: 0.35, peakMultiplier: 2.0, predictionHorizonSlots: 6,  peakPercentile: 0.8 },
    { vehicleCount: 5,  vehicleCapacity: 25, rebalanceIntervalMinutes: 15, safetyBufferRatio: 0.45, peakMultiplier: 2.5, predictionHorizonSlots: 8,  peakPercentile: 0.6 },
    { vehicleCount: 8,  vehicleCapacity: 25, rebalanceIntervalMinutes: 15, safetyBufferRatio: 0.50, peakMultiplier: 2.5, predictionHorizonSlots: 8,  peakPercentile: 0.5 },
    { vehicleCount: 8,  vehicleCapacity: 30, rebalanceIntervalMinutes: 15, safetyBufferRatio: 0.55, peakMultiplier: 3.0, predictionHorizonSlots: 10, peakPercentile: 0.5 },
    { vehicleCount: 10, vehicleCapacity: 30, rebalanceIntervalMinutes: 15, safetyBufferRatio: 0.60, peakMultiplier: 3.0, predictionHorizonSlots: 10, peakPercentile: 0.4 },
    { vehicleCount: 12, vehicleCapacity: 35, rebalanceIntervalMinutes: 15, safetyBufferRatio: 0.65, peakMultiplier: 3.0, predictionHorizonSlots: 12, peakPercentile: 0.3 },
    { vehicleCount: 12, vehicleCapacity: 35, rebalanceIntervalMinutes: 30, safetyBufferRatio: 0.65, peakMultiplier: 3.0, predictionHorizonSlots: 12, peakPercentile: 0.3 },
    { vehicleCount: 15, vehicleCapacity: 40, rebalanceIntervalMinutes: 15, safetyBufferRatio: 0.65, peakMultiplier: 3.5, predictionHorizonSlots: 12, peakPercentile: 0.3 },
  ];
}
