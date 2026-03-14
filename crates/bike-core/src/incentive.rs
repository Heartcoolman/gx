use serde::{Deserialize, Serialize};

use crate::domain::StationId;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IncentiveType {
    DepartureDiscount,
    ArrivalReward,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IncentiveReason {
    Surplus,
    PredictedShortage,
    Rebalancing,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceIncentive {
    pub station_id: StationId,
    pub incentive_type: IncentiveType,
    pub discount_percent: f64,
    pub reward_credits: f64,
    pub valid_from: chrono::DateTime<chrono::Utc>,
    pub valid_until: chrono::DateTime<chrono::Utc>,
    pub reason: IncentiveReason,
}
