import { create } from 'zustand';
import type { DayKind } from '../types/time';
import type { DispatchPlan } from '../types/dispatch';
import type { TargetInventory } from '../types/demand';
import type { PriceIncentive } from '../types/incentive';
import type { VehicleAnimation, EngineState } from '../simulation/engine';
// Re-export for bridge compatibility — these types are also defined in workerProtocol.ts
import type {
  ActiveRideV2,
  FailureReasonCounts,
  ScenarioBundle,
  SimulationSnapshotV2,
  WeatherKind,
} from '../types/scenario';
import { SCENARIO_LIBRARY } from '../data/scenarioLibrary';

function emptyReasons(): FailureReasonCounts {
  return {
    weather_cancelled: 0,
    no_bike: 0,
    bike_fault: 0,
    walk_transfer_exceeded: 0,
    gave_up_after_retry: 0,
    gave_up_after_wait: 0,
  };
}

export interface SimulationState {
  engineState: EngineState;
  speed: number;
  dayKind: DayKind;
  slotIndex: number;
  dispatchEnabled: boolean;

  scenarioId: string;
  scenarioLabel: string;
  scenarioDescription: string;
  availableScenarios: Array<{
    id: string;
    label: string;
    description: string;
    dayKind: DayKind;
  }>;
  syntheticPreview: ScenarioBundle['syntheticTripCorpus'];

  bikes: number[];
  brokenBikes: number[];
  maintenanceBikes: number[];
  stationPressure: number[];
  activeRides: ActiveRideV2[];

  totalRides: number;
  blockedCount: number;
  dispatchCount: number;
  totalBikesMoved: number;
  totalWalkTransfers: number;
  totalOverflowEvents: number;
  totalRepairsCompleted: number;
  totalInTransit: number;

  failureReasonCounts: FailureReasonCounts;
  activeWeather: WeatherKind;
  activeWeatherLabel: string;
  activeEvents: string[];
  odMatrix: number[][];

  latestTargets: TargetInventory[];
  latestPlan: DispatchPlan | null;
  latestIncentives: PriceIncentive[];
  vehicleAnimations: VehicleAnimation[];
  snapshots: SimulationSnapshotV2[];

  setEngineState: (state: EngineState) => void;
  setSpeed: (speed: number) => void;
  setDayKind: (dayKind: DayKind) => void;
  setSlotIndex: (slot: number) => void;
  setDispatchEnabled: (value: boolean) => void;
  setScenarioMeta: (meta: {
    scenarioId: string;
    scenarioLabel: string;
    scenarioDescription: string;
    syntheticPreview: ScenarioBundle['syntheticTripCorpus'];
  }) => void;
  setSimulationFrame: (frame: {
    bikes: number[];
    brokenBikes: number[];
    maintenanceBikes: number[];
    stationPressure: number[];
    activeRides: ActiveRideV2[];
  }) => void;
  setMetrics: (metrics: {
    totalRides: number;
    blockedCount: number;
    dispatchCount: number;
    totalBikesMoved: number;
    totalWalkTransfers: number;
    totalOverflowEvents: number;
    totalRepairsCompleted: number;
    totalInTransit: number;
    failureReasonCounts: FailureReasonCounts;
    activeWeather: WeatherKind;
    activeWeatherLabel: string;
    activeEvents: string[];
    odMatrix: number[][];
  }) => void;
  setBackendResults: (targets: TargetInventory[], plan: DispatchPlan | null, incentives: PriceIncentive[]) => void;
  setVehicleAnimations: (anims: VehicleAnimation[]) => void;
  addSnapshot: (snap: SimulationSnapshotV2) => void;
  resetSnapshots: () => void;
}

export const useSimulationStore = create<SimulationState>((set) => ({
  engineState: 'idle',
  speed: 1,
  dayKind: 'weekday',
  slotIndex: 0,
  dispatchEnabled: false,

  scenarioId: SCENARIO_LIBRARY[0].id,
  scenarioLabel: SCENARIO_LIBRARY[0].label,
  scenarioDescription: SCENARIO_LIBRARY[0].description,
  availableScenarios: SCENARIO_LIBRARY.map((scenario) => ({
    id: scenario.id,
    label: scenario.label,
    description: scenario.description,
    dayKind: scenario.dayKind,
  })),
  syntheticPreview: [],

  bikes: [],
  brokenBikes: [],
  maintenanceBikes: [],
  stationPressure: [],
  activeRides: [],

  totalRides: 0,
  blockedCount: 0,
  dispatchCount: 0,
  totalBikesMoved: 0,
  totalWalkTransfers: 0,
  totalOverflowEvents: 0,
  totalRepairsCompleted: 0,
  totalInTransit: 0,
  failureReasonCounts: emptyReasons(),
  activeWeather: 'clear',
  activeWeatherLabel: '晴朗',
  activeEvents: [],
  odMatrix: Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => 0)),

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
  setScenarioMeta: ({ scenarioId, scenarioLabel, scenarioDescription, syntheticPreview }) =>
    set({ scenarioId, scenarioLabel, scenarioDescription, syntheticPreview }),
  setSimulationFrame: ({ bikes, brokenBikes, maintenanceBikes, stationPressure, activeRides }) =>
    set({ bikes, brokenBikes, maintenanceBikes, stationPressure, activeRides }),
  setMetrics: (metrics) => set(metrics),
  setBackendResults: (latestTargets, latestPlan, latestIncentives) =>
    set({ latestTargets, latestPlan, latestIncentives }),
  setVehicleAnimations: (vehicleAnimations) => set({ vehicleAnimations }),
  addSnapshot: (snap) => set((state) => ({ snapshots: [...state.snapshots.slice(-47), snap] })),
  resetSnapshots: () => set({ snapshots: [] }),
}));
