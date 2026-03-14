// Mirror of Rust dispatch types

export type DispatchPriority = 'critical' | 'high' | 'normal';

export type StopAction = 'pickup' | 'dropoff';

export interface RouteStop {
  station_id: number;
  action: StopAction;
  bike_count: number;
  load_after: number;
}

export interface VehicleRoute {
  vehicle_id: number;
  capacity: number;
  stops: RouteStop[];
  total_distance_meters: number;
  estimated_duration_minutes: number;
}

export interface DispatchPlan {
  id: string;
  generated_at: string;
  vehicle_routes: VehicleRoute[];
  total_bikes_moved: number;
}

export interface DispatchVehicle {
  id: number;
  capacity: number;
  current_position: number;
}
