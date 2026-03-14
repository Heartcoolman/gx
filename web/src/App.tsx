import { useEffect, useRef, useCallback } from 'react';
import AppLayout from './components/layout/AppLayout';
import { SimulationEngine } from './simulation/engine';
import { useSimulationStore } from './store/simulationStore';
import { useUIStore } from './store/uiStore';
import type { DayKind } from './types/time';
import './App.css';

export default function App() {
  const engineRef = useRef<SimulationEngine | null>(null);
  const store = useSimulationStore;

  const getEngine = useCallback(() => {
    if (!engineRef.current) {
      engineRef.current = new SimulationEngine({
        onTick: (engine) => {
          store.getState().setSlotIndex(engine.clock.slotIndex);
          store.getState().setBikes([...engine.stateManager.bikes]);
          store.getState().setActiveRides([...engine.stateManager.activeRides]);
          store.getState().setMetrics({
            totalRides: engine.stateManager.totalRides,
            blockedCount: engine.stateManager.blockedCount,
            dispatchCount: engine.dispatchCount,
            totalBikesMoved: engine.totalBikesMoved,
          });
          store.getState().setVehicleAnimations([...engine.activeVehicleAnimations]);
        },
        onSlotChange: () => {},
        onRebalance: (resp) => {
          store.getState().setBackendResults(
            resp.targets,
            resp.dispatch_plan,
            resp.incentives,
          );
        },
        onSnapshot: (snap) => {
          store.getState().addSnapshot(snap);
        },
      });
      // Set initial bikes
      store.getState().setBikes([...engineRef.current.stateManager.bikes]);
    }
    return engineRef.current;
  }, []);

  // Initialize engine on mount
  useEffect(() => {
    getEngine();
  }, [getEngine]);

  // Wire up control callbacks via a global ref
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__simEngine = getEngine;
  }, [getEngine]);

  return <AppLayout />;
}

// Export helpers for SimulationControls to use
export function useEngineControls() {
  const setEngineState = useSimulationStore(s => s.setEngineState);
  const setSpeed = useSimulationStore(s => s.setSpeed);
  const setDayKind = useSimulationStore(s => s.setDayKind);
  const setDispatchEnabled = useSimulationStore(s => s.setDispatchEnabled);
  const { setIsWarming } = useUIStore();

  const getEngine = (): SimulationEngine | null => {
    return ((window as unknown as Record<string, unknown>).__simEngine as (() => SimulationEngine) | undefined)?.() ?? null;
  };

  const play = async () => {
    const engine = getEngine();
    if (!engine) return;

    if (engine.state === 'idle') {
      setIsWarming(true);
      try {
        await engine.warmup();
      } catch { /* ignore */ }
      setIsWarming(false);
      engine.start();
    } else if (engine.state === 'paused') {
      engine.resume();
    }
    setEngineState('running');
  };

  const pause = () => {
    getEngine()?.pause();
    setEngineState('paused');
  };

  const step = () => {
    getEngine()?.step();
  };

  const reset = (dayKind?: DayKind) => {
    const engine = getEngine();
    if (!engine) return;
    engine.reset(dayKind);
    setEngineState('idle');
    useSimulationStore.getState().resetSnapshots();
    useSimulationStore.getState().setBackendResults([], null, []);
  };

  const changeSpeed = (speed: number) => {
    getEngine()?.setSpeed(speed);
    setSpeed(speed);
  };

  const changeDayKind = (dk: DayKind) => {
    getEngine()?.setDayKind(dk);
    setDayKind(dk);
  };

  const toggleDispatch = (enabled: boolean) => {
    getEngine()?.setDispatchEnabled(enabled);
    setDispatchEnabled(enabled);
  };

  return { play, pause, step, reset, changeSpeed, changeDayKind, toggleDispatch };
}
