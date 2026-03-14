import { create } from 'zustand';
import type { DayKind } from '../types/time';
import type { DispatchPlan } from '../types/dispatch';
import type { TargetInventory } from '../types/demand';
import type { PriceIncentive } from '../types/incentive';
import type { Snapshot } from '../simulation/stateManager';
import type { VehicleAnimation, EngineState } from '../simulation/engine';
import type { ActiveRide } from '../simulation/stateManager';

export interface SimulationState {
  // Engine state
  engineState: EngineState;
  speed: number;
  dayKind: DayKind;
  slotIndex: number;
  dispatchEnabled: boolean;

  // Station bikes
  bikes: number[];

  // Active rides
  activeRides: ActiveRide[];

  // Metrics
  totalRides: number;
  blockedCount: number;
  dispatchCount: number;
  totalBikesMoved: number;

  // Latest backend results
  latestTargets: TargetInventory[];
  latestPlan: DispatchPlan | null;
  latestIncentives: PriceIncentive[];

  // Vehicle animations
  vehicleAnimations: VehicleAnimation[];

  // Chart data
  snapshots: Snapshot[];

  // Actions
  setEngineState: (state: EngineState) => void;
  setSpeed: (speed: number) => void;
  setDayKind: (dayKind: DayKind) => void;
  setSlotIndex: (slot: number) => void;
  setDispatchEnabled: (v: boolean) => void;
  setBikes: (bikes: number[]) => void;
  setActiveRides: (rides: ActiveRide[]) => void;
  setMetrics: (m: { totalRides: number; blockedCount: number; dispatchCount: number; totalBikesMoved: number }) => void;
  setBackendResults: (targets: TargetInventory[], plan: DispatchPlan | null, incentives: PriceIncentive[]) => void;
  setVehicleAnimations: (anims: VehicleAnimation[]) => void;
  addSnapshot: (snap: Snapshot) => void;
  resetSnapshots: () => void;
}

export const useSimulationStore = create<SimulationState>((set) => ({
  engineState: 'idle',
  speed: 1,
  dayKind: 'weekday',
  slotIndex: 0,
  dispatchEnabled: false,
  bikes: [],
  activeRides: [],
  totalRides: 0,
  blockedCount: 0,
  dispatchCount: 0,
  totalBikesMoved: 0,
  latestTargets: [],
  latestPlan: null,
  latestIncentives: [],
  vehicleAnimations: [],
  snapshots: [],

  setEngineState: (engineState) => set({ engineState }),
  setSpeed: (speed) => set({ speed }),
  setDayKind: (dayKind) => set({ dayKind }),
  setSlotIndex: (slotIndex) => set({ slotIndex }),
  setDispatchEnabled: (dispatchEnabled) => set({ dispatchEnabled }),
  setBikes: (bikes) => set({ bikes }),
  setActiveRides: (activeRides) => set({ activeRides }),
  setMetrics: (m) => set(m),
  setBackendResults: (latestTargets, latestPlan, latestIncentives) =>
    set({ latestTargets, latestPlan, latestIncentives }),
  setVehicleAnimations: (vehicleAnimations) => set({ vehicleAnimations }),
  addSnapshot: (snap) => set((s) => ({ snapshots: [...s.snapshots.slice(-95), snap] })),
  resetSnapshots: () => set({ snapshots: [] }),
}));
