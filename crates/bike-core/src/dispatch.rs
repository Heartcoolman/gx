use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::StationId;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DispatchPriority {
    Critical,
    High,
    Normal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StopAction {
    Pickup,
    Dropoff,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouteStop {
    pub station_id: StationId,
    pub action: StopAction,
    pub bike_count: u32,
    pub load_after: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VehicleRoute {
    pub vehicle_id: u32,
    pub capacity: u32,
    pub stops: Vec<RouteStop>,
    pub total_distance_meters: f64,
    pub estimated_duration_minutes: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DispatchPlan {
    pub id: Uuid,
    pub generated_at: chrono::DateTime<chrono::Utc>,
    pub vehicle_routes: Vec<VehicleRoute>,
    pub total_bikes_moved: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DispatchVehicle {
    pub id: u32,
    pub capacity: u32,
    pub current_position: StationId,
}
