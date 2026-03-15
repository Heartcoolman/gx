/**
 * Communication protocol between the main thread and the simulation Web Worker.
 *
 * Commands flow main→worker; events flow worker→main.
 */
import type { DayKind } from '../types/time';
import type { SimEnvConfig } from '../store/simEnvStore';
import type {
  ActiveRideV2,
  FailureReasonCounts,
  SimulationSnapshotV2,
  WeatherKind,
} from '../types/scenario';
import type { TargetInventory } from '../types/demand';
import type { DispatchPlan } from '../types/dispatch';
import type { PriceIncentive } from '../types/incentive';
import type { EngineState, VehicleAnimation } from './engine';

// ── Main thread → Worker commands ──

export type WorkerCommand =
  | { type: 'init'; scenarioId?: string }
  | { type: 'warmup' }
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'step' }
  | { type: 'reset'; dayKind?: DayKind }
  | { type: 'setSpeed'; speed: number }
  | { type: 'setDispatchEnabled'; enabled: boolean }
  | { type: 'setDayKind'; dayKind: DayKind }
  | { type: 'setScenario'; scenarioId: string }
  | { type: 'setSimEnv'; config: SimEnvConfig };

// ── Worker → Main thread events ──

/** Full state snapshot sent once per slot change. */
export interface SimStateSnapshot {
  slotIndex: number;
  dayKind: DayKind;
  engineState: EngineState;

  // Scenario metadata
  scenarioId: string;
  scenarioLabel: string;
  scenarioDescription: string;
  syntheticPreview: Array<{
    dayIndex: number;
    expectedTrips: number;
    dominantWeather: WeatherKind;
    highlightedEvents: string[];
  }>;

  // Station data
  bikes: number[];
  brokenBikes: number[];
  maintenanceBikes: number[];
  stationPressure: number[];
  activeRides: ActiveRideV2[];

  // Metrics
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

  // Dispatch data
  latestTargets: TargetInventory[];
  latestPlan: DispatchPlan | null;
  latestIncentives: PriceIncentive[];

  // Vehicle animations
  vehicleAnimations: VehicleAnimation[];
}

/** Lightweight animation-only update at ~30fps. */
export interface AnimationFrameUpdate {
  slotIndex: number;
  slotProgress: number;
  vehicleAnimations: VehicleAnimation[];
  activeRides: ActiveRideV2[];
}

export type WorkerEvent =
  | { type: 'stateSnapshot'; snapshot: SimStateSnapshot }
  | { type: 'animationFrame'; frame: AnimationFrameUpdate }
  | { type: 'slotSnapshot'; snapshot: SimulationSnapshotV2 }
  | { type: 'rebalanceResult'; targets: TargetInventory[]; plan: DispatchPlan | null; incentives: PriceIncentive[] }
  | { type: 'engineStateChange'; state: EngineState }
  | { type: 'warmupComplete' }
  | { type: 'error'; message: string };
