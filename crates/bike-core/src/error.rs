use thiserror::Error;

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("station {0} not found")]
    StationNotFound(u32),
    #[error("invalid time slot index {0} (must be 0..1440)")]
    InvalidSlotIndex(u32),
    #[error("no vehicles available for dispatch")]
    NoVehicles,
    #[error("configuration error: {0}")]
    Config(String),
    #[error("invalid distance matrix: {0}")]
    InvalidDistanceMatrix(String),
    #[error("invalid vehicle capacity: {0}")]
    InvalidVehicleCapacity(String),
    #[error("invalid config: {0}")]
    InvalidConfig(String),
}
