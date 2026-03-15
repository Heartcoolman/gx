import { useCallback, useEffect, useRef } from 'react';
import AppLayout from './components/layout/AppLayout';
import { SimulationBridge } from './simulation/simulationBridge';
import { useSimulationStore } from './store/simulationStore';
import { useSimEnvStore } from './store/simEnvStore';
import { useUIStore } from './store/uiStore';
import type { DayKind } from './types/time';
import './App.css';

export default function App() {
  const bridgeRef = useRef<SimulationBridge | null>(null);

  const getBridge = useCallback(() => {
    if (!bridgeRef.current) {
      bridgeRef.current = new SimulationBridge();
    }
    return bridgeRef.current;
  }, []);

  useEffect(() => {
    getBridge();
    return () => {
      bridgeRef.current?.dispose();
      bridgeRef.current = null;
    };
  }, [getBridge]);

  // Sync simEnvStore changes to Worker so totalBikes, demandMultiplier, etc.
  // are available when the engine resets inside the Worker thread.
  useEffect(() => {
    const unsubscribe = useSimEnvStore.subscribe((state) => {
      const bridge = bridgeRef.current;
      if (bridge) {
        bridge.setSimEnv({
          totalBikes: state.totalBikes,
          demandMultiplier: state.demandMultiplier,
          peakIntensity: state.peakIntensity,
          noiseFactor: state.noiseFactor,
        });
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const globalObject = window as unknown as Record<string, unknown>;
    globalObject.__simBridge = getBridge;
  }, [getBridge]);

  return <AppLayout />;
}

export function useEngineControls() {
  const setEngineState = useSimulationStore((state) => state.setEngineState);
  const setSpeed = useSimulationStore((state) => state.setSpeed);
  const setDayKind = useSimulationStore((state) => state.setDayKind);
  const setDispatchEnabled = useSimulationStore((state) => state.setDispatchEnabled);
  const { setIsWarming } = useUIStore();

  const getBridge = (): SimulationBridge | null => {
    return ((window as unknown as Record<string, unknown>).__simBridge as (() => SimulationBridge) | undefined)?.() ?? null;
  };

  const play = async () => {
    const bridge = getBridge();
    if (!bridge) return;

    const engineState = useSimulationStore.getState().engineState;
    if (engineState === 'idle') {
      setIsWarming(true);
      try {
        await bridge.warmup();
      } catch {
        // The local compiler warmup should not block the UI.
      }
      setIsWarming(false);
      bridge.start();
    } else if (engineState === 'paused') {
      bridge.resume();
    }
    setEngineState('running');
  };

  const pause = () => {
    getBridge()?.pause();
    setEngineState('paused');
  };

  const step = () => {
    getBridge()?.step();
  };

  const reset = (dayKind?: DayKind) => {
    const bridge = getBridge();
    if (!bridge) return;
    bridge.reset(dayKind);
    setEngineState('idle');
  };

  const changeSpeed = (speed: number) => {
    getBridge()?.setSpeed(speed);
    setSpeed(speed);
  };

  const changeDayKind = (dayKind: DayKind) => {
    getBridge()?.setDayKind(dayKind);
    setDayKind(dayKind);
  };

  const toggleDispatch = (enabled: boolean) => {
    getBridge()?.setDispatchEnabled(enabled);
    setDispatchEnabled(enabled);
  };

  const changeScenario = (scenarioId: string) => {
    const bridge = getBridge();
    if (!bridge) return;
    bridge.setScenario(scenarioId);
  };

  return { play, pause, step, reset, changeSpeed, changeDayKind, toggleDispatch, changeScenario };
}
