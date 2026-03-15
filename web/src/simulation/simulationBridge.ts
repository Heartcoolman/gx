/**
 * SimulationBridge — main-thread controller that communicates with the
 * simulation Web Worker via the workerProtocol.
 *
 * Exposes the same public API surface as SimulationEngine so that UI
 * components can treat it as a drop-in replacement.
 */
import { useSimulationStore } from '../store/simulationStore';
import type { WorkerCommand, WorkerEvent } from './workerProtocol';
import type { DayKind } from '../types/time';
import type { SimEnvConfig } from '../store/simEnvStore';

export class SimulationBridge {
  private worker: Worker;
  private warmupResolve: (() => void) | null = null;

  constructor() {
    this.worker = new Worker(
      new URL('./simulationWorker.ts', import.meta.url),
      { type: 'module' },
    );
    this.worker.onmessage = this.handleMessage;
    this.worker.onerror = this.handleError;

    // Initialize engine in worker
    this.send({ type: 'init' });
  }

  // ── Public API (mirrors SimulationEngine) ──

  async warmup(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.warmupResolve = resolve;
      this.send({ type: 'warmup' });
    });
  }

  start(): void {
    this.send({ type: 'start' });
  }

  pause(): void {
    this.send({ type: 'pause' });
  }

  resume(): void {
    this.send({ type: 'resume' });
  }

  step(): void {
    this.send({ type: 'step' });
  }

  reset(dayKind?: DayKind): void {
    this.send({ type: 'reset', dayKind });
    useSimulationStore.getState().resetSnapshots();
    useSimulationStore.getState().setBackendResults([], null, []);
  }

  setSpeed(speed: number): void {
    this.send({ type: 'setSpeed', speed });
  }

  setDispatchEnabled(enabled: boolean): void {
    this.send({ type: 'setDispatchEnabled', enabled });
  }

  setDayKind(dayKind: DayKind): void {
    this.send({ type: 'setDayKind', dayKind });
  }

  setScenario(scenarioId: string): void {
    this.send({ type: 'setScenario', scenarioId });
    useSimulationStore.getState().resetSnapshots();
    useSimulationStore.getState().setBackendResults([], null, []);
  }

  setSimEnv(config: SimEnvConfig): void {
    this.send({ type: 'setSimEnv', config });
  }

  dispose(): void {
    this.worker.terminate();
  }

  // ── Private ──

  private send(cmd: WorkerCommand): void {
    this.worker.postMessage(cmd);
  }

  private handleMessage = (e: MessageEvent<WorkerEvent>): void => {
    const event = e.data;
    const store = useSimulationStore.getState();

    switch (event.type) {
      case 'stateSnapshot': {
        const snap = event.snapshot;
        store.setSlotIndex(snap.slotIndex);
        store.setDayKind(snap.dayKind);
        store.setScenarioMeta({
          scenarioId: snap.scenarioId,
          scenarioLabel: snap.scenarioLabel,
          scenarioDescription: snap.scenarioDescription,
          syntheticPreview: snap.syntheticPreview,
        });
        store.setSimulationFrame({
          bikes: snap.bikes,
          brokenBikes: snap.brokenBikes,
          maintenanceBikes: snap.maintenanceBikes,
          stationPressure: snap.stationPressure,
          activeRides: snap.activeRides,
        });
        store.setMetrics({
          totalRides: snap.totalRides,
          blockedCount: snap.blockedCount,
          dispatchCount: snap.dispatchCount,
          totalBikesMoved: snap.totalBikesMoved,
          totalWalkTransfers: snap.totalWalkTransfers,
          totalOverflowEvents: snap.totalOverflowEvents,
          totalRepairsCompleted: snap.totalRepairsCompleted,
          totalInTransit: snap.totalInTransit,
          failureReasonCounts: snap.failureReasonCounts,
          activeWeather: snap.activeWeather,
          activeWeatherLabel: snap.activeWeatherLabel,
          activeEvents: snap.activeEvents,
          odMatrix: snap.odMatrix,
        });
        store.setVehicleAnimations(snap.vehicleAnimations);
        break;
      }

      case 'animationFrame': {
        const frame = event.frame;
        store.setSlotIndex(frame.slotIndex);
        store.setVehicleAnimations(frame.vehicleAnimations);
        store.setSimulationFrame({
          ...store,
          activeRides: frame.activeRides,
          bikes: store.bikes,
          brokenBikes: store.brokenBikes,
          maintenanceBikes: store.maintenanceBikes,
          stationPressure: store.stationPressure,
        });
        break;
      }

      case 'slotSnapshot': {
        store.addSnapshot(event.snapshot);
        break;
      }

      case 'rebalanceResult': {
        store.setBackendResults(event.targets, event.plan, event.incentives);
        break;
      }

      case 'engineStateChange': {
        store.setEngineState(event.state);
        break;
      }

      case 'warmupComplete': {
        if (this.warmupResolve) {
          this.warmupResolve();
          this.warmupResolve = null;
        }
        break;
      }

      case 'error': {
        console.error('[SimulationBridge] Worker error:', event.message);
        break;
      }
    }
  };

  private handleError = (e: ErrorEvent): void => {
    console.error('[SimulationBridge] Worker crashed:', e.message);
    // Attempt recovery: create a new worker
    this.worker.terminate();
    this.worker = new Worker(
      new URL('./simulationWorker.ts', import.meta.url),
      { type: 'module' },
    );
    this.worker.onmessage = this.handleMessage;
    this.worker.onerror = this.handleError;
    this.send({ type: 'init' });
  };
}
