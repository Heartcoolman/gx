/**
 * Simulation Web Worker.
 *
 * Runs the SimulationEngine in a dedicated thread so the main thread
 * only handles rendering and UI interaction.
 */
import { SimulationEngine } from './engine';
import { useSimEnvStore } from '../store/simEnvStore';
import type { WorkerCommand, WorkerEvent, AnimationFrameUpdate } from './workerProtocol';

let engine: SimulationEngine | null = null;
let lastSnapshotSlot = -1;
let frameCounter = 0;

function post(event: WorkerEvent): void {
  self.postMessage(event);
}

function createEngine(): SimulationEngine {
  const eng = new SimulationEngine(
    {
      onTick: (e) => {
        // Send full snapshot on slot change, animation frame otherwise (~30fps throttle)
        const currentSlot = e.clock.slotIndex;
        if (currentSlot !== lastSnapshotSlot) {
          lastSnapshotSlot = currentSlot;
          post({ type: 'stateSnapshot', snapshot: e.buildStateSnapshot() });
          frameCounter = 0;
        } else {
          // Throttle animation updates: send every other frame (~30fps from 60fps interval)
          frameCounter++;
          if (frameCounter % 2 === 0) {
            const frame: AnimationFrameUpdate = {
              slotIndex: currentSlot,
              slotProgress: e.clock.slotProgress,
              vehicleAnimations: [...e.activeVehicleAnimations],
              activeRides: [...e.stateManager.activeRides],
            };
            post({ type: 'animationFrame', frame });
          }
        }
      },
      onSlotChange: () => {},
      onRebalance: (resp) => {
        post({
          type: 'rebalanceResult',
          targets: resp.targets,
          plan: resp.dispatch_plan,
          incentives: resp.incentives,
        });
      },
      onSnapshot: (snap) => {
        post({ type: 'slotSnapshot', snapshot: snap });
      },
    },
    'interval', // Worker uses setInterval instead of requestAnimationFrame
  );

  return eng;
}

self.onmessage = async (e: MessageEvent<WorkerCommand>) => {
  const cmd = e.data;

  try {
    switch (cmd.type) {
      case 'init': {
        engine = createEngine();
        if (cmd.scenarioId) {
          engine.setScenario(cmd.scenarioId);
        }
        // Send initial state
        post({ type: 'stateSnapshot', snapshot: engine.buildStateSnapshot() });
        post({ type: 'engineStateChange', state: engine.state });
        break;
      }

      case 'warmup': {
        if (!engine) engine = createEngine();
        await engine.warmup();
        post({ type: 'warmupComplete' });
        post({ type: 'stateSnapshot', snapshot: engine.buildStateSnapshot() });
        break;
      }

      case 'start': {
        if (!engine) engine = createEngine();
        engine.start();
        post({ type: 'engineStateChange', state: engine.state });
        break;
      }

      case 'pause': {
        engine?.pause();
        post({ type: 'engineStateChange', state: engine?.state ?? 'idle' });
        break;
      }

      case 'resume': {
        engine?.resume();
        post({ type: 'engineStateChange', state: engine?.state ?? 'idle' });
        break;
      }

      case 'step': {
        engine?.step();
        if (engine) {
          post({ type: 'stateSnapshot', snapshot: engine.buildStateSnapshot() });
        }
        break;
      }

      case 'reset': {
        if (engine) {
          engine.reset(cmd.dayKind);
          lastSnapshotSlot = -1;
          post({ type: 'stateSnapshot', snapshot: engine.buildStateSnapshot() });
          post({ type: 'engineStateChange', state: engine.state });
        }
        break;
      }

      case 'setSpeed': {
        engine?.setSpeed(cmd.speed);
        break;
      }

      case 'setDispatchEnabled': {
        engine?.setDispatchEnabled(cmd.enabled);
        break;
      }

      case 'setDayKind': {
        engine?.setDayKind(cmd.dayKind);
        if (engine) {
          post({ type: 'stateSnapshot', snapshot: engine.buildStateSnapshot() });
        }
        break;
      }

      case 'setScenario': {
        if (engine) {
          engine.setScenario(cmd.scenarioId);
          lastSnapshotSlot = -1;
          post({ type: 'stateSnapshot', snapshot: engine.buildStateSnapshot() });
          post({ type: 'engineStateChange', state: engine.state });
        }
        break;
      }

      case 'setSimEnv': {
        useSimEnvStore.getState().applyPreset(cmd.config);
        break;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    post({ type: 'error', message });
  }
};
