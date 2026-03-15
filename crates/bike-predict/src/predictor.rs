use std::collections::HashMap;

use bike_core::{
    DayKind, DemandRecord, PredictedDemand, StationId, SystemConfig, TargetInventory, TimeSlot,
};
use chrono::Timelike;

use crate::DemandPredictor;

/// Key for the seasonal baseline and EWMA tables.
type SlotKey = (StationId, DayKind, u32); // (station, day_kind, slot_index)

/// Running statistics for a (station, day_kind, slot) combination.
#[derive(Debug, Clone)]
struct BaselineEntry {
    total_pickups: f64,
    total_returns: f64,
    count: u64,
    sum_sq_pickups: f64,
    sum_sq_returns: f64,
}

impl BaselineEntry {
    fn avg_pickups(&self) -> f64 {
        if self.count == 0 {
            0.0
        } else {
            self.total_pickups / self.count as f64
        }
    }
    fn avg_returns(&self) -> f64 {
        if self.count == 0 {
            0.0
        } else {
            self.total_returns / self.count as f64
        }
    }

    fn pickup_variance(&self) -> f64 {
        if self.count < 2 {
            return 0.0;
        }
        let mean = self.avg_pickups();
        ((self.sum_sq_pickups / self.count as f64) - mean * mean).max(0.0)
    }

    fn return_variance(&self) -> f64 {
        if self.count < 2 {
            return 0.0;
        }
        let mean = self.avg_returns();
        ((self.sum_sq_returns / self.count as f64) - mean * mean).max(0.0)
    }
}

/// EWMA deviation tracker.
#[derive(Debug, Clone, Default)]
struct EwmaEntry {
    pickup_deviation: f64,
    return_deviation: f64,
    initialized: bool,
}

/// Two-layer demand predictor: seasonal baseline + EWMA adaptive.
///
/// Usage pattern:
/// 1. Call `observe()` for each ride record (accumulates in pending buffers).
/// 2. Call `flush()` once per time-slot epoch to commit the batch as a single observation.
/// 3. Call `predict()` / `target_inventory()` any time to get current predictions.
#[derive(Debug, Clone)]
pub struct CompositePredictor {
    alpha: f64,
    baseline: HashMap<SlotKey, BaselineEntry>,
    ewma: HashMap<SlotKey, EwmaEntry>,
    pending_pickups: HashMap<SlotKey, f64>,
    pending_returns: HashMap<SlotKey, f64>,
    weather_baseline: HashMap<(StationId, u8, u32), BaselineEntry>,
}

impl CompositePredictor {
    pub fn new(alpha: f64) -> Self {
        Self {
            alpha,
            baseline: HashMap::new(),
            ewma: HashMap::new(),
            pending_pickups: HashMap::new(),
            pending_returns: HashMap::new(),
            weather_baseline: HashMap::new(),
        }
    }

    /// Clear all learned state so the predictor starts fresh.
    pub fn reset(&mut self) {
        self.baseline.clear();
        self.ewma.clear();
        self.pending_pickups.clear();
        self.pending_returns.clear();
        self.weather_baseline.clear();
    }

    /// Commit all pending observations as a single epoch and clear the buffers.
    ///
    /// Call this once per time-slot boundary (e.g. every 15 minutes).
    pub fn flush(&mut self) {
        // Collect all keys that have pending data.
        let mut all_keys: std::collections::HashSet<SlotKey> = std::collections::HashSet::new();
        all_keys.extend(self.pending_pickups.keys());
        all_keys.extend(self.pending_returns.keys());

        for key in all_keys {
            let pickups = self.pending_pickups.remove(&key).unwrap_or(0.0);
            let returns = self.pending_returns.remove(&key).unwrap_or(0.0);
            self.update_baseline_and_ewma(key, pickups, returns);
        }
    }

    fn update_baseline_and_ewma(&mut self, key: SlotKey, pickups: f64, returns: f64) {
        let baseline = self.baseline.entry(key).or_insert(BaselineEntry {
            total_pickups: 0.0,
            total_returns: 0.0,
            count: 0,
            sum_sq_pickups: 0.0,
            sum_sq_returns: 0.0,
        });

        let base_p = baseline.avg_pickups();
        let base_r = baseline.avg_returns();

        baseline.total_pickups += pickups;
        baseline.total_returns += returns;
        baseline.sum_sq_pickups += pickups * pickups;
        baseline.sum_sq_returns += returns * returns;
        baseline.count += 1;

        let pickup_dev = pickups - base_p;
        let return_dev = returns - base_r;

        // Adaptive alpha: when observations diverge sharply from baseline,
        // boost alpha temporarily to track the change faster.
        let reference = base_p.max(base_r).max(1.0);
        let deviation_ratio = (pickup_dev.abs() + return_dev.abs()) / reference;
        let effective_alpha = (self.alpha + deviation_ratio * 0.12).min(0.75);

        let ewma = self.ewma.entry(key).or_default();
        if ewma.initialized {
            ewma.pickup_deviation =
                effective_alpha * pickup_dev + (1.0 - effective_alpha) * ewma.pickup_deviation;
            ewma.return_deviation =
                effective_alpha * return_dev + (1.0 - effective_alpha) * ewma.return_deviation;
        } else {
            ewma.pickup_deviation = pickup_dev;
            ewma.return_deviation = return_dev;
            ewma.initialized = true;
        }
    }

    /// Check if a time slot is a "peak" for a station (pickup rate >= p-th percentile).
    fn is_peak(&self, station_id: StationId, slot: TimeSlot, percentile: f64) -> bool {
        let mut rates: Vec<f64> = Vec::new();
        for slot_idx in 0..TimeSlot::SLOTS_PER_DAY {
            let key = (station_id, slot.day_kind, slot_idx);
            if let Some(b) = self.baseline.get(&key) {
                rates.push(b.avg_pickups());
            }
        }
        if rates.is_empty() {
            return false;
        }
        rates.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let idx = ((rates.len() as f64 * percentile) as usize).min(rates.len() - 1);
        let threshold = rates[idx];

        let key = (station_id, slot.day_kind, slot.slot_index);
        let current_rate = self
            .baseline
            .get(&key)
            .map(|b| b.avg_pickups())
            .unwrap_or(0.0);
        current_rate >= threshold && threshold > 0.0
    }

    fn predict_raw(&self, station_id: StationId, slot: TimeSlot) -> (f64, f64) {
        let key = (station_id, slot.day_kind, slot.slot_index);
        let (base_p, base_r) = self
            .baseline
            .get(&key)
            .map(|b| (b.avg_pickups(), b.avg_returns()))
            .unwrap_or((0.0, 0.0));
        let (dev_p, dev_r) = self
            .ewma
            .get(&key)
            .map(|e| (e.pickup_deviation, e.return_deviation))
            .unwrap_or((0.0, 0.0));
        let pickups = (base_p + dev_p).max(0.0);
        let returns = (base_r + dev_r).max(0.0);
        (pickups, returns)
    }

    /// Observe a demand record with an associated weather bucket.
    /// Weather buckets: 0=clear, 1=cloudy, 2=rain, 3=storm, 4=cold.
    pub fn observe_with_weather(&mut self, record: &DemandRecord, day_kind: DayKind, weather_bucket: u8) {
        self.observe(record, day_kind);

        let departure_slot = {
            let dt = record.departure_time;
            dt.hour() * 60 + dt.minute()
        };
        let arrival_slot = {
            let dt = record.arrival_time;
            dt.hour() * 60 + dt.minute()
        };

        // Update weather-specific baseline for pickup
        let pickup_key = (record.origin, weather_bucket, departure_slot);
        let entry = self.weather_baseline.entry(pickup_key).or_insert(BaselineEntry {
            total_pickups: 0.0,
            total_returns: 0.0,
            count: 0,
            sum_sq_pickups: 0.0,
            sum_sq_returns: 0.0,
        });
        entry.total_pickups += 1.0;
        entry.sum_sq_pickups += 1.0;
        entry.count += 1;

        // Update weather-specific baseline for return
        let return_key = (record.destination, weather_bucket, arrival_slot);
        let entry = self.weather_baseline.entry(return_key).or_insert(BaselineEntry {
            total_pickups: 0.0,
            total_returns: 0.0,
            count: 0,
            sum_sq_pickups: 0.0,
            sum_sq_returns: 0.0,
        });
        entry.total_returns += 1.0;
        entry.sum_sq_returns += 1.0;
        entry.count += 1;
    }

    /// Apply spatial smoothing: stations within 500m share 15% of their signal.
    pub fn spatial_smooth(&self, predictions: &mut [(StationId, PredictedDemand)], distance_matrix: &[Vec<f64>]) {
        let smoothing_radius = 500.0; // meters
        let smoothing_weight = 0.15;

        let original: Vec<(StationId, PredictedDemand)> = predictions.to_vec();
        for (i, (_, pred)) in predictions.iter_mut().enumerate() {
            let mut neighbor_pickups = 0.0;
            let mut neighbor_returns = 0.0;
            let mut neighbor_count = 0.0;

            for (j, (_, orig)) in original.iter().enumerate() {
                if i == j { continue; }
                let dist = distance_matrix.get(i).and_then(|r| r.get(j)).copied().unwrap_or(f64::MAX);
                if dist <= smoothing_radius {
                    let weight = 1.0 - (dist / smoothing_radius);
                    neighbor_pickups += orig.pickups * weight;
                    neighbor_returns += orig.returns * weight;
                    neighbor_count += weight;
                }
            }

            if neighbor_count > 0.0 {
                pred.pickups = pred.pickups * (1.0 - smoothing_weight) + (neighbor_pickups / neighbor_count) * smoothing_weight;
                pred.returns = pred.returns * (1.0 - smoothing_weight) + (neighbor_returns / neighbor_count) * smoothing_weight;
                pred.net_flow = pred.returns - pred.pickups;
            }
        }
    }

    /// Returns true if the observed demand is anomalous (>2 std devs from baseline).
    pub fn is_anomalous(&self, station_id: StationId, slot: TimeSlot, observed_pickups: f64) -> bool {
        let key = (station_id, slot.day_kind, slot.slot_index);
        if let Some(baseline) = self.baseline.get(&key) {
            let mean = baseline.avg_pickups();
            let variance = baseline.pickup_variance();
            if variance > 0.0 {
                let z_score = (observed_pickups - mean) / variance.sqrt();
                return z_score.abs() > 2.0;
            }
        }
        false
    }
}

impl DemandPredictor for CompositePredictor {
    fn predict(&self, station_id: StationId, slot: TimeSlot) -> PredictedDemand {
        let (pickups, returns) = self.predict_raw(station_id, slot);
        let key = (station_id, slot.day_kind, slot.slot_index);
        let pickup_var = self.baseline.get(&key).map(|b| b.pickup_variance()).unwrap_or(0.0);
        let return_var = self.baseline.get(&key).map(|b| b.return_variance()).unwrap_or(0.0);
        let total_var = pickup_var + return_var;
        let std_dev = total_var.sqrt();
        let net = returns - pickups;
        PredictedDemand {
            pickups,
            returns,
            net_flow: net,
            confidence_low: (net - 1.96 * std_dev).max(-(pickups + returns)),
            confidence_high: net + 1.96 * std_dev,
        }
    }

    fn observe(&mut self, record: &DemandRecord, day_kind: DayKind) {
        let departure_slot = {
            let dt = record.departure_time;
            dt.hour() * 60 + dt.minute()
        };
        let arrival_slot = {
            let dt = record.arrival_time;
            dt.hour() * 60 + dt.minute()
        };

        let pickup_key = (record.origin, day_kind, departure_slot);
        *self.pending_pickups.entry(pickup_key).or_insert(0.0) += 1.0;

        let return_key = (record.destination, day_kind, arrival_slot);
        *self.pending_returns.entry(return_key).or_insert(0.0) += 1.0;
    }

    fn target_inventory(
        &self,
        station_id: StationId,
        current_slot: TimeSlot,
        capacity: u32,
        config: &SystemConfig,
    ) -> TargetInventory {
        let mut cumulative_net: f64 = 0.0;
        let mut max_net_outflow: f64 = 0.0;
        let mut positive_outflow_sum: f64 = 0.0;

        for offset in 0..config.prediction_horizon_slots {
            let future_slot = current_slot.advance(offset);
            let (pickups, returns) = self.predict_raw(station_id, future_slot);
            let net_outflow = pickups - returns;
            cumulative_net += net_outflow;
            max_net_outflow = max_net_outflow.max(cumulative_net);
            positive_outflow_sum += net_outflow.max(0.0);
        }

        let mut base_target = max_net_outflow
            .max((positive_outflow_sum * 0.55).ceil())
            .ceil() as i64;

        let is_peak = self.is_peak(station_id, current_slot, config.peak_percentile);
        if is_peak {
            base_target = (base_target as f64 * config.peak_multiplier).ceil() as i64;
        }

        let safety_floor = if is_peak { 4.0 } else { 2.0 };
        let safety_buffer = (base_target as f64 * config.safety_buffer_ratio)
            .ceil()
            .max(safety_floor) as i64;

        let target = (base_target + safety_buffer).max(0).min(capacity as i64) as u32;

        let reason = if is_peak {
            format!(
                "peak period, predicted {:.0} net outflow in {} slots",
                max_net_outflow, config.prediction_horizon_slots
            )
        } else if max_net_outflow > 0.0 {
            format!(
                "predicted {:.0} net outflow in {} slots",
                max_net_outflow, config.prediction_horizon_slots
            )
        } else {
            "low outflow or net inflow expected".to_string()
        };

        TargetInventory {
            station_id,
            target_bikes: target,
            is_peak,
            reason,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{TimeZone, Utc};

    fn make_record(
        origin: u32,
        dest: u32,
        dep_hour: u32,
        dep_min: u32,
        arr_hour: u32,
        arr_min: u32,
    ) -> DemandRecord {
        DemandRecord {
            origin: StationId(origin),
            destination: StationId(dest),
            departure_time: Utc
                .with_ymd_and_hms(2026, 3, 13, dep_hour, dep_min, 0)
                .unwrap(),
            arrival_time: Utc
                .with_ymd_and_hms(2026, 3, 13, arr_hour, arr_min, 0)
                .unwrap(),
        }
    }

    /// Simulate multiple "days" of the same pattern to build a stable baseline.
    fn feed_day(pred: &mut CompositePredictor, records: &[DemandRecord], day_kind: DayKind) {
        for r in records {
            pred.observe(r, day_kind);
        }
        pred.flush();
    }

    #[test]
    fn test_ewma_convergence() {
        let mut pred = CompositePredictor::new(0.3);
        let records: Vec<_> = (0..10).map(|_| make_record(1, 2, 8, 0, 8, 10)).collect();

        // Feed 5 "days" with the same pattern.
        for _ in 0..5 {
            feed_day(&mut pred, &records, DayKind::Weekday);
        }

        let slot = TimeSlot::from_time(DayKind::Weekday, 8, 0).unwrap();
        let demand = pred.predict(StationId(1), slot);
        assert!(
            demand.pickups > 5.0,
            "pickups={} should approach 10.0",
            demand.pickups
        );
    }

    #[test]
    fn test_net_flow_direction() {
        let mut pred = CompositePredictor::new(0.3);
        // Day pattern: 10 pickups from station 1, 2 returns to station 1.
        let mut records = Vec::new();
        for _ in 0..10 {
            records.push(make_record(1, 2, 8, 0, 8, 10));
        }
        for _ in 0..2 {
            records.push(make_record(3, 1, 7, 50, 8, 5));
        }

        // Feed 3 days.
        for _ in 0..3 {
            feed_day(&mut pred, &records, DayKind::Weekday);
        }

        let slot = TimeSlot::from_time(DayKind::Weekday, 8, 0).unwrap();
        let demand = pred.predict(StationId(1), slot);
        assert!(
            demand.net_flow < 0.0,
            "net_flow={} should be negative for high-pickup station",
            demand.net_flow
        );
        assert!(demand.pickups > demand.returns);
    }

    #[test]
    fn test_target_inventory_respects_capacity() {
        let mut pred = CompositePredictor::new(0.3);
        let records: Vec<_> = (0..50).map(|_| make_record(1, 2, 8, 0, 8, 10)).collect();
        for _ in 0..5 {
            feed_day(&mut pred, &records, DayKind::Weekday);
        }

        let config = SystemConfig::default();
        let slot = TimeSlot::from_time(DayKind::Weekday, 8, 0).unwrap();
        let target = pred.target_inventory(StationId(1), slot, 30, &config);
        assert!(
            target.target_bikes <= 30,
            "target={} must not exceed capacity 30",
            target.target_bikes
        );
    }

    #[test]
    fn test_zero_demand_zero_target() {
        let pred = CompositePredictor::new(0.3);
        let config = SystemConfig::default();
        let slot = TimeSlot::from_time(DayKind::Weekday, 8, 0).unwrap();
        let target = pred.target_inventory(StationId(1), slot, 30, &config);
        // With min safety buffer of 2, zero demand still yields target=2.
        assert_eq!(
            target.target_bikes, 2,
            "no data => min safety buffer target"
        );
    }

    #[test]
    fn test_different_day_kinds_independent() {
        let mut pred = CompositePredictor::new(0.3);
        let records: Vec<_> = (0..10).map(|_| make_record(1, 2, 8, 0, 8, 10)).collect();
        for _ in 0..3 {
            feed_day(&mut pred, &records, DayKind::Weekday);
        }

        let wd = pred.predict(StationId(1), TimeSlot::from_time(DayKind::Weekday, 8, 0).unwrap());
        let sun = pred.predict(StationId(1), TimeSlot::from_time(DayKind::Sunday, 8, 0).unwrap());

        assert!(wd.pickups > 0.0);
        assert_eq!(sun.pickups, 0.0, "Sunday should have no data");
    }

    #[test]
    fn test_target_reflects_tidal_pattern() {
        // Dormitory: morning rush (lots of pickups), afternoon return (lots of returns).
        let mut pred = CompositePredictor::new(0.3);

        let morning_out: Vec<_> = (0..20).map(|_| make_record(1, 2, 8, 0, 8, 10)).collect();
        let afternoon_in: Vec<_> = (0..18).map(|_| make_record(2, 1, 17, 0, 17, 10)).collect();
        let mut day = morning_out.clone();
        day.extend(afternoon_in.clone());

        for _ in 0..5 {
            feed_day(&mut pred, &day, DayKind::Weekday);
        }

        let config = SystemConfig::default();
        let morning_target = pred.target_inventory(
            StationId(1),
            TimeSlot::from_time(DayKind::Weekday, 8, 0).unwrap(),
            30,
            &config,
        );
        let afternoon_target = pred.target_inventory(
            StationId(1),
            TimeSlot::from_time(DayKind::Weekday, 17, 0).unwrap(),
            30,
            &config,
        );

        // Morning needs many bikes (high outflow), afternoon needs few (inflow).
        assert!(
            morning_target.target_bikes > afternoon_target.target_bikes,
            "morning target ({}) should exceed afternoon target ({})",
            morning_target.target_bikes,
            afternoon_target.target_bikes
        );
    }
}
