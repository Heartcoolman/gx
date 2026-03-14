use bike_core::{
    IncentiveReason, IncentiveType, PriceIncentive, RebalanceInput,
};
use chrono::{Duration, Utc};

use crate::greedy::StationGap;

/// Compute price incentives for surplus and deficit stations.
///
/// - Deficit stations get `ArrivalReward` (attract bikes).
/// - Surplus stations get `DepartureDiscount` (encourage leaving).
/// - Discounts proportional to severity = |gap| / capacity, capped at max_discount.
pub(crate) fn compute_incentives(
    input: &RebalanceInput,
    surpluses: &[StationGap],
    deficits: &[StationGap],
) -> Vec<PriceIncentive> {
    let max_discount = input.config.max_incentive_discount;
    let now = Utc::now();
    let valid_until = now + Duration::hours(1);

    let mut incentives = Vec::new();

    // Deficit stations: arrival rewards.
    for deficit in deficits {
        let station = input
            .stations
            .iter()
            .find(|s| s.id == deficit.station_id);
        let capacity = station.map(|s| s.capacity).unwrap_or(20) as f64;
        let severity = (-deficit.gap) as f64 / capacity;
        let discount = (severity * 100.0).min(max_discount);

        if discount > 1.0 {
            incentives.push(PriceIncentive {
                station_id: deficit.station_id,
                incentive_type: IncentiveType::ArrivalReward,
                discount_percent: discount,
                reward_credits: discount * 0.5,
                valid_from: now,
                valid_until,
                reason: IncentiveReason::PredictedShortage,
            });
        }
    }

    // Surplus stations: departure discounts (slightly lower than arrival rewards).
    for surplus in surpluses {
        if surplus.gap <= 0 {
            continue;
        }
        let station = input
            .stations
            .iter()
            .find(|s| s.id == surplus.station_id);
        let capacity = station.map(|s| s.capacity).unwrap_or(20) as f64;
        let severity = surplus.gap as f64 / capacity;
        let discount = (severity * 80.0).min(max_discount * 0.8);

        if discount > 1.0 {
            incentives.push(PriceIncentive {
                station_id: surplus.station_id,
                incentive_type: IncentiveType::DepartureDiscount,
                discount_percent: discount,
                reward_credits: 0.0,
                valid_from: now,
                valid_until,
                reason: IncentiveReason::Surplus,
            });
        }
    }

    // Budget constraint: cap total expected cost.
    let budget = input.config.incentive_budget_per_hour;
    let avg_revenue = 2.0; // Assume 2 yuan per ride.
    let mut running_cost = 0.0;
    incentives.retain(|inc| {
        // Logistic response: 10% discount ≈ 5% riders influenced, 50% ≈ 20%.
        let influence_rate = logistic_response(inc.discount_percent);
        let estimated_rides = 10.0; // Rough estimate of rides per station per hour.
        let cost = (inc.discount_percent / 100.0) * influence_rate * estimated_rides * avg_revenue;
        running_cost += cost;
        running_cost <= budget
    });

    incentives
}

/// Logistic response curve: maps discount percentage to fraction of riders influenced.
fn logistic_response(discount: f64) -> f64 {
    // Calibrated: 10% discount → ~5% influence, 50% → ~20%.
    let k = 0.06;
    let mid = 25.0;
    0.25 / (1.0 + (-k * (discount - mid)).exp())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_logistic_response_range() {
        // 0% discount should yield minimal influence.
        assert!(logistic_response(0.0) < 0.05);
        // 50% discount should yield ~20%.
        let r50 = logistic_response(50.0);
        assert!(r50 > 0.10 && r50 < 0.30, "50% discount response: {}", r50);
    }

    #[test]
    fn test_logistic_monotonic() {
        // Higher discount should yield higher influence.
        for d in (0..90).step_by(5) {
            let r1 = logistic_response(d as f64);
            let r2 = logistic_response(d as f64 + 5.0);
            assert!(r2 >= r1, "not monotonic at d={}", d);
        }
    }
}
