use serde::{Deserialize, Serialize};
use std::fmt;

// ── Station ──

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct StationId(pub u32);

impl fmt::Display for StationId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "S{}", self.0)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StationCategory {
    AcademicBuilding,
    Dormitory,
    Cafeteria,
    Library,
    SportsField,
    MainGate,
}

impl StationCategory {
    /// Default capacity for this category.
    pub fn default_capacity(self) -> u32 {
        match self {
            Self::Dormitory => 30,
            Self::AcademicBuilding => 25,
            Self::Cafeteria => 20,
            Self::Library => 20,
            Self::SportsField => 15,
            Self::MainGate => 15,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Station {
    pub id: StationId,
    pub name: String,
    pub category: StationCategory,
    pub capacity: u32,
    pub latitude: f64,
    pub longitude: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StationStatus {
    pub station_id: StationId,
    pub available_bikes: u32,
    pub available_docks: u32,
    #[serde(with = "chrono::serde::ts_seconds")]
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

// ── Time ──

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DayKind {
    Weekday,
    Saturday,
    Sunday,
    Holiday,
    ExamPeriod,
}

/// A 1-minute slot within a day-kind.  `slot_index` is 0..1440.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct TimeSlot {
    pub day_kind: DayKind,
    pub slot_index: u32,
}

impl TimeSlot {
    pub const SLOTS_PER_DAY: u32 = 1440;

    pub fn advance(self, offset: u32) -> Self {
        Self {
            day_kind: self.day_kind,
            slot_index: (self.slot_index + offset) % Self::SLOTS_PER_DAY,
        }
    }

    /// Convert a chrono DateTime into a TimeSlot (uses hour/minute only; day_kind must
    /// be supplied separately).
    pub fn from_time(day_kind: DayKind, hour: u32, minute: u32) -> Self {
        Self {
            day_kind,
            slot_index: hour * 60 + minute,
        }
    }
}

// ── Demand ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DemandRecord {
    pub origin: StationId,
    pub destination: StationId,
    pub departure_time: chrono::DateTime<chrono::Utc>,
    pub arrival_time: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct PredictedDemand {
    pub pickups: f64,
    pub returns: f64,
    pub net_flow: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TargetInventory {
    pub station_id: StationId,
    pub target_bikes: u32,
    pub is_peak: bool,
    pub reason: String,
}
