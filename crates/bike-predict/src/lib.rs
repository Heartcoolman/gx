mod predictor;

pub use predictor::CompositePredictor;

use bike_core::{
    DemandRecord, PredictedDemand, StationId, SystemConfig, TargetInventory, TimeSlot,
};

/// Trait for demand prediction engines.
pub trait DemandPredictor: Send + Sync {
    /// Predict demand for a station at a given time slot.
    fn predict(&self, station_id: StationId, slot: TimeSlot) -> PredictedDemand;

    /// Feed an observed ride record to update the model.
    fn observe(&mut self, record: &DemandRecord, day_kind: bike_core::DayKind);

    /// Calculate target inventory for a station at the current time slot.
    fn target_inventory(
        &self,
        station_id: StationId,
        current_slot: TimeSlot,
        capacity: u32,
        config: &SystemConfig,
    ) -> TargetInventory;
}
