// API request/response types mirroring Rust handlers

import type { Station, StationStatus } from './station';
import type { TimeSlot, DayKind } from './time';
import type { DemandRecord, PredictedDemand, TargetInventory } from './demand';
import type { DispatchPlan, DispatchVehicle, VehicleRoute } from './dispatch';
import type { PriceIncentive } from './incentive';

// POST /api/v1/predict/demand
export interface PredictDemandReq {
  station_id: number;
  time_slot: TimeSlot;
}
export interface PredictDemandResp {
  station_id: number;
  pickups: number;
  returns: number;
  net_flow: number;
  confidence_low: number;
  confidence_high: number;
}

// POST /api/v1/predict/demand/batch
export interface BatchPredictReq {
  queries: PredictDemandReq[];
}
export interface BatchPredictResp {
  predictions: PredictDemandResp[];
}

// POST /api/v1/predict/observe
export interface ObserveReq {
  records: DemandRecord[];
  day_kind: DayKind;
}
export interface ObserveResp {
  accepted: number;
}

// POST /api/v1/predict/target
export interface TargetReq {
  station_ids: number[];
  capacities: number[];
  current_slot: TimeSlot;
}
export interface TargetResp {
  targets: TargetInventory[];
}

// POST /api/v1/rebalance/solve
export interface SolveReq {
  stations: Station[];
  current_status: StationStatus[];
  targets: TargetEntry[];
  distance_matrix: number[][];
  vehicles: DispatchVehicle[];
}
export interface TargetEntry {
  station_id: number;
  target_bikes: number;
}
export interface SolveResp {
  dispatch_plan: DispatchPlan;
  incentives: PriceIncentive[];
}

// POST /api/v1/rebalance/cycle
export interface CycleReq {
  stations: Station[];
  current_status: StationStatus[];
  distance_matrix: number[][];
  vehicles: DispatchVehicle[];
  current_slot: TimeSlot;
  /** Current block rate (0.0–1.0) for adaptive congestion response */
  block_rate: number;
  /** Current weather condition (e.g. "rain", "storm", "cold_front") */
  weather?: string;
}
export interface CycleResp {
  targets: TargetInventory[];
  dispatch_plan: DispatchPlan;
  incentives: PriceIncentive[];
}

// GET/PUT /api/v1/config
export interface SystemConfig {
  time_slot_minutes: number;
  prediction_horizon_slots: number;
  ewma_alpha: number;
  safety_buffer_ratio: number;
  peak_multiplier: number;
  peak_percentile: number;
  dispatch_vehicle_count: number;
  dispatch_vehicle_capacity: number;
  max_incentive_discount: number;
  incentive_budget_per_hour: number;
  rebalance_interval_minutes: number;
}

export type {
  Station, StationStatus,
  TimeSlot, DayKind,
  DemandRecord, PredictedDemand, TargetInventory,
  DispatchPlan, DispatchVehicle, VehicleRoute,
  PriceIncentive,
};
