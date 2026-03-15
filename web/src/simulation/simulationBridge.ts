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

/** Snapshot of configuration state so we can replay after worker crash. */
interface BridgeState {
  scenarioId?: string;
  speed?: number;
  dispatchEnabled?: boolean;
  dayKind?: DayKind;
  simEnv?: SimEnvConfig;
}

export class SimulationBridge {
  private worker: Worker;
  private warmupResolve: (() => void) | null = null;
  private savedState: BridgeState = {};

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
    this.savedState.speed = speed;
    this.send({ type: 'setSpeed', speed });
  }

  setDispatchEnabled(enabled: boolean): void {
    this.savedState.dispatchEnabled = enabled;
    this.send({ type: 'setDispatchEnabled', enabled });
  }

  setDayKind(dayKind: DayKind): void {
    this.savedState.dayKind = dayKind;
    this.send({ type: 'setDayKind', dayKind });
  }

  setScenario(scenarioId: string): void {
    this.savedState.scenarioId = scenarioId;
    this.send({ type: 'setScenario', scenarioId });
    useSimulationStore.getState().resetSnapshots();
    useSimulationStore.getState().setBackendResults([], null, []);
  }

  setSimEnv(config: SimEnvConfig): void {
    this.savedState.simEnv = config;
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
        useSimulationStore.setState({
          slotIndex: snap.slotIndex,
          dayKind: snap.dayKind,
          scenarioId: snap.scenarioId,
          scenarioLabel: snap.scenarioLabel,
          scenarioDescription: snap.scenarioDescription,
          syntheticPreview: snap.syntheticPreview,
          bikes: snap.bikes,
          brokenBikes: snap.brokenBikes,
          maintenanceBikes: snap.maintenanceBikes,
          stationPressure: snap.stationPressure,
          activeRides: snap.activeRides,
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
          vehicleAnimations: snap.vehicleAnimations,
        });
        break;
      }

      case 'animationFrame': {
        const frame = event.frame;
        useSimulationStore.setState({
          slotIndex: frame.slotIndex,
          vehicleAnimations: frame.vehicleAnimations,
          activeRides: frame.activeRides,
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

    // Notify UI that the engine has reset to idle due to crash
    useSimulationStore.getState().setEngineState('idle');

    // Recreate worker
    this.worker.terminate();
    this.worker = new Worker(
      new URL('./simulationWorker.ts', import.meta.url),
      { type: 'module' },
    );
    this.worker.onmessage = this.handleMessage;
    this.worker.onerror = this.handleError;
    this.send({ type: 'init' });

    // Replay saved configuration state so the new worker matches UI
    const s = this.savedState;
    if (s.scenarioId) this.send({ type: 'setScenario', scenarioId: s.scenarioId });
    if (s.speed !== undefined) this.send({ type: 'setSpeed', speed: s.speed });
    if (s.dispatchEnabled !== undefined) this.send({ type: 'setDispatchEnabled', enabled: s.dispatchEnabled });
    if (s.dayKind) this.send({ type: 'setDayKind', dayKind: s.dayKind });
    if (s.simEnv) this.send({ type: 'setSimEnv', config: s.simEnv });
  };
}
