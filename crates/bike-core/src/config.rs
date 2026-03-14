use serde::{Deserialize, Serialize};

use crate::{DispatchPlan, DispatchVehicle, PriceIncentive, Station, StationId, StationStatus};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemConfig {
    pub time_slot_minutes: u32,
    pub prediction_horizon_slots: u32,
    pub ewma_alpha: f64,
    pub safety_buffer_ratio: f64,
    pub peak_multiplier: f64,
    pub peak_percentile: f64,
    pub dispatch_vehicle_count: u32,
    pub dispatch_vehicle_capacity: u32,
    pub max_incentive_discount: f64,
    pub incentive_budget_per_hour: f64,
    pub rebalance_interval_minutes: u32,
}

impl Default for SystemConfig {
    fn default() -> Self {
        Self {
            time_slot_minutes: 15,
            prediction_horizon_slots: 6,
            ewma_alpha: 0.3,
            safety_buffer_ratio: 0.35,
            peak_multiplier: 2.0,
            peak_percentile: 0.80,
            dispatch_vehicle_count: 3,
            dispatch_vehicle_capacity: 15,
            max_incentive_discount: 50.0,
            incentive_budget_per_hour: 500.0,
            rebalance_interval_minutes: 30,
        }
    }
}

// ── Optimizer I/O ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RebalanceInput {
    pub stations: Vec<Station>,
    pub current_status: Vec<StationStatus>,
    pub targets: Vec<(StationId, u32)>,
    pub distance_matrix: Vec<Vec<f64>>,
    pub vehicles: Vec<DispatchVehicle>,
    pub config: SystemConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RebalanceOutput {
    pub dispatch_plan: DispatchPlan,
    pub incentives: Vec<PriceIncentive>,
}
