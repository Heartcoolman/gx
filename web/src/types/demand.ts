// Mirror of Rust DemandRecord, PredictedDemand, TargetInventory

export interface DemandRecord {
  origin: number;
  destination: number;
  departure_time: string; // ISO 8601
  arrival_time: string;
}

export interface PredictedDemand {
  pickups: number;
  returns: number;
  net_flow: number;
}

export interface TargetInventory {
  station_id: number;
  target_bikes: number;
  is_peak: boolean;
  reason: string;
}
