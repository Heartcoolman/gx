use serde::{Deserialize, Serialize};

use crate::error::CoreError;
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
    /// Maximum route duration in minutes for dispatch vehicles
    #[serde(default = "default_max_route_duration_minutes")]
    pub max_route_duration_minutes: f64,
    /// Distance cost reference for transfer scoring (meters)
    #[serde(default = "default_distance_cost_reference")]
    pub distance_cost_reference: f64,
    /// Current weather condition (e.g. "rain", "storm", "cold_front")
    #[serde(default)]
    pub weather: Option<String>,
}

fn default_max_route_duration_minutes() -> f64 {
    45.0
}

fn default_distance_cost_reference() -> f64 {
    500.0
}

impl Default for SystemConfig {
    fn default() -> Self {
        Self {
            time_slot_minutes: 1,
            prediction_horizon_slots: 10,
            ewma_alpha: 0.35,
            safety_buffer_ratio: 0.55,
            peak_multiplier: 2.5,
            peak_percentile: 0.80,
            dispatch_vehicle_count: 5,
            dispatch_vehicle_capacity: 20,
            max_incentive_discount: 60.0,
            incentive_budget_per_hour: 800.0,
            rebalance_interval_minutes: 15,
            max_route_duration_minutes: 45.0,
            distance_cost_reference: 500.0,
            weather: None,
        }
    }
}

impl SystemConfig {
    pub fn validate(&self) -> Result<(), CoreError> {
        if self.ewma_alpha <= 0.0 || self.ewma_alpha >= 1.0 {
            return Err(CoreError::InvalidConfig(format!("ewma_alpha must be in (0,1), got {}", self.ewma_alpha)));
        }
        if self.safety_buffer_ratio < 0.0 {
            return Err(CoreError::InvalidConfig(format!("safety_buffer_ratio must be >= 0, got {}", self.safety_buffer_ratio)));
        }
        if self.max_incentive_discount < 0.0 || self.max_incentive_discount > 100.0 {
            return Err(CoreError::InvalidConfig(format!("max_incentive_discount must be in [0,100], got {}", self.max_incentive_discount)));
        }
        if self.dispatch_vehicle_capacity == 0 {
            return Err(CoreError::InvalidConfig("dispatch_vehicle_capacity must be > 0".into()));
        }
        Ok(())
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
