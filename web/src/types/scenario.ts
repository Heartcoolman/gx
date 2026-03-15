import type { Station, StationCategory } from './station';
import type { DayKind } from './time';

export type SemesterPhase =
  | 'spring_term'
  | 'regular_week'
  | 'exam_week'
  | 'festival_day'
  | 'weekend_mode';

export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'storm' | 'cold_front';

export type EventImpactType =
  | 'lecture_peak'
  | 'cafeteria_surge'
  | 'library_closure'
  | 'sports_event'
  | 'campus_festival'
  | 'exam_pressure';

export type RidePurpose =
  | 'class'
  | 'meal'
  | 'study'
  | 'exercise'
  | 'commute'
  | 'errand'
  | 'social';

export type FailureReason =
  | 'weather_cancelled'
  | 'no_bike'
  | 'bike_fault'
  | 'walk_transfer_exceeded'
  | 'gave_up_after_retry'
  | 'gave_up_after_wait';

export type BikeCondition =
  | 'healthy'
  | 'light_fault'
  | 'unavailable'
  | 'maintenance'
  | 'recovery'
  | 'in_transit';

/** Continuous weather state for realistic interpolation */
export interface WeatherState {
  temperature: number;      // Celsius
  windSpeed: number;        // m/s
  windDirection: number;    // degrees 0-360
  humidity: number;         // 0-1
}

export interface WeatherWindow {
  startSlot: number;
  endSlot: number;
  weather: WeatherKind;
  label: string;
  demandMultiplier: number;
  travelTimeMultiplier: number;
  healthWearMultiplier: number;
  shortTripBoost: number;
  weatherState?: WeatherState;
  transitionDurationSlots?: number;
}

export interface EnvironmentEvent {
  id: string;
  label: string;
  type: EventImpactType;
  startSlot: number;
  endSlot: number;
  demandMultiplier: number;
  travelTimeMultiplier: number;
  affectedCategories?: StationCategory[];
  destinationBoost?: Partial<Record<StationCategory, number>>;
  pressureBoost?: Partial<Record<StationCategory, number>>;
}

export interface RiderActivityWindow {
  id: string;
  label: string;
  startSlot: number;
  endSlot: number;
  purpose: RidePurpose;
  baseIntensity: number;
  originCategories: StationCategory[];
  destinationCategories: StationCategory[];
  retryProbability: number;
  walkToleranceMeters: number;
  /** Probability rider will wait in queue if no bikes available (default 0.3). */
  waitProbability?: number;
  /** Maximum slots (minutes) a rider will wait before giving up (default 5). */
  maxWaitSlots?: number;
}

export interface RiderAgentProfile {
  id: string;
  label: string;
  share: number;
  baseDailyTrips: number;
  homeCategories: StationCategory[];
  weatherSensitivity: number;
  bikeFaultSensitivity: number;
  distancePreferenceExponent: number;
  activityWindows: RiderActivityWindow[];
}

/** Component-level health tracking for individual bike parts */
export interface BikeComponentHealth {
  chain: number;    // 0-1, chain condition
  brake: number;    // 0-1, brake condition
  tire: number;     // 0-1, tire condition
}

/** Preventive maintenance schedule entry */
export interface PreventiveMaintenanceSchedule {
  /** Slot index when next preventive check is due */
  nextCheckSlot: number;
  /** Interval in slots between preventive checks */
  checkIntervalSlots: number;
}

export interface BikeHealthProfile {
  failureThreshold: number;
  outageThreshold: number;
  wearPerKm: number;
  rainWearMultiplier: number;
  repairProbabilityPerSlot: number;
  recoverySlots: number;
  chainWearRate?: number;      // per-km chain wear (default 0.04)
  brakeWearRate?: number;      // per-km brake wear (default 0.03)
  tireWearRate?: number;       // per-km tire wear (default 0.025)
  preventiveCheckInterval?: number;  // slots between preventive checks (default 480 = 8 hours)
  minRepairSlots?: number;     // minimum repair duration (default 15)
  maxRepairSlots?: number;     // maximum repair duration (default 60)
}

export interface ScenarioSyntheticCorpus {
  dailyTripTarget: number;
  previewDays: number;
  calibrationNote: string;
  tripCorpusSeed: number;
}

export interface ScenarioPackage {
  version: string;
  id: string;
  label: string;
  description: string;
  dayKind: DayKind;
  seed: number;
  semesterPhase: SemesterPhase;
  stations: Station[];
  totalBikes: number;
  baseDemandMultiplier: number;
  initialDistributionBias: Partial<Record<StationCategory, number>>;
  stationHotness: number[];
  weatherTimeline: WeatherWindow[];
  environmentEvents: EnvironmentEvent[];
  riderProfiles: RiderAgentProfile[];
  categoryAffinity: Record<StationCategory, Partial<Record<StationCategory, number>>>;
  bikeHealth: BikeHealthProfile;
  syntheticCorpus: ScenarioSyntheticCorpus;
}

export interface BikeAsset {
  id: string;
  stationId: number | null;
  condition: BikeCondition;
  health: number;
  recoveryReadySlot: number | null;
  /** Total trips this bike has completed (drives non-linear degradation). */
  tripCount: number;
  componentHealth?: BikeComponentHealth;
  maintenanceSchedule?: PreventiveMaintenanceSchedule;
  /** Age in total slots since creation, drives accelerated wear */
  ageSlots?: number;
  /** Variable repair duration (slots remaining) */
  repairSlotsRemaining?: number | null;
}

export interface ActiveRideV2 {
  rideId: string;
  bikeId: string;
  origin: number;
  destination: number;
  plannedDestination: number;
  fallbackStations: number[];
  departureTime: number;
  arrivalTime: number;
  progress: number;
  purpose: RidePurpose;
  riderProfileId: string;
  weather: WeatherKind;
  distanceMeters: number;
  overflowMeters: number;
  /** When true, this is a short overflow re-route — force-dock on second overflow. */
  isOverflow?: boolean;
}

/** Individual dock fault state */
export interface DockFaultEntry {
  dockIndex: number;
  faultSlot: number;       // when the fault occurred
  repairReadySlot: number; // when it will be repaired
}

/** Per-station dock health tracking */
export interface StationDockState {
  totalDocks: number;
  faultedDocks: DockFaultEntry[];
  /** Effective capacity = totalDocks - faultedDocks.length */
  effectiveCapacity: number;
  /** Last maintenance window slot */
  lastMaintenanceSlot: number;
}

export interface StationStateV2 {
  stationId: number;
  availableBikes: number;
  brokenBikes: number;
  maintenanceBikes: number;
  emptyDockCount: number;
  queuedReturns: number;
  overflowReturns: number;
  recentUnmetDemand: number;
  temporaryHeat: number;
  pressureIndex: number;
  faultedDockCount?: number;
  effectiveCapacity?: number;
}

export type FailureReasonCounts = Record<FailureReason, number>;

export interface SlotEnvironmentContext {
  slotIndex: number;
  weather: WeatherKind;
  weatherLabel: string;
  activeEvents: EnvironmentEvent[];
  demandMultiplier: number;
  travelTimeMultiplier: number;
  shortTripBoost: number;
  categoryDemandBoost: Partial<Record<StationCategory, number>>;
  weatherState?: WeatherState;
  temperature?: number;
  windSpeed?: number;
  humidity?: number;
}

export interface SimulationSnapshotV2 {
  slotIndex: number;
  bikes: number[];
  brokenBikes: number[];
  maintenanceBikes: number[];
  pressure: number[];
  servedDemand: number;
  unmetDemand: number;
  cumulativeServed: number;
  cumulativeUnmet: number;
  walkTransfers: number;
  overflowEvents: number;
  activeWeather: WeatherKind;
  activeWeatherLabel: string;
  activeEvents: string[];
  failureReasons: FailureReasonCounts;
  odByCategory: number[][];
  stationStates: StationStateV2[];
}

export interface ScenarioBundle {
  scenario: ScenarioPackage;
  syntheticTripCorpus: Array<{
    dayIndex: number;
    expectedTrips: number;
    dominantWeather: WeatherKind;
    highlightedEvents: string[];
  }>;
}

export const FAILURE_REASON_LABELS: Record<FailureReason, string> = {
  weather_cancelled: '天气抑制',
  no_bike: '无车可借',
  bike_fault: '取到故障车',
  walk_transfer_exceeded: '换站距离过长',
  gave_up_after_retry: '重试后放弃',
  gave_up_after_wait: '等待后放弃',
};

export const WEATHER_LABELS: Record<WeatherKind, string> = {
  clear: '晴朗',
  cloudy: '多云',
  rain: '降雨',
  storm: '暴雨',
  cold_front: '寒潮',
};
