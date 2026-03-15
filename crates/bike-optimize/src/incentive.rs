use std::collections::HashMap;

use bike_core::{IncentiveReason, IncentiveType, PriceIncentive, RebalanceInput, StationId};
use chrono::{Duration, Utc};

use crate::greedy::StationGap;

/// Compute cost-optimised price incentives, coordinated with the vehicle dispatch plan.
///
/// `vehicle_inflow` maps each deficit station to the number of bikes that dispatched
/// vehicles will deliver this cycle.  The incentive logic uses this to:
///
///   • **Fully covered** (`inflow ≥ deficit`): skip incentive — vehicle does the job.
///   • **Partially covered** (`0 < inflow < deficit`): incentive targets only the
///     residual gap, keeping costs proportionally lower.
///   • **No vehicle coming** (`inflow = 0`): full incentive as the primary lever.
///
/// This ensures the algorithm chooses the cheapest available tool for each deficit
/// instead of blindly applying both vehicles *and* high incentives to the same station.
///
/// Strategy (three tiers, budget-guarded):
///
/// **Tier 1 – Emergency free rides** (空站 & 极度拥堵, no vehicle coming)
/// **Tier 2 – Minimum-effective discounts for remaining deficit stations**
/// **Tier 3 – Departure discounts for surplus stations**
pub(crate) fn compute_incentives(
    input: &RebalanceInput,
    surpluses: &[StationGap],
    deficits: &[StationGap],
    vehicle_inflow: &HashMap<StationId, u32>,
) -> Vec<PriceIncentive> {
    let max_discount = input.config.max_incentive_discount;
    let budget = input.config.incentive_budget_per_hour;
    let avg_fare = 2.0_f64; // yuan per average ride
    let now = Utc::now();
    // Shorter window → incentives stay current and don't confuse riders after conditions change.
    let valid_until = now + Duration::minutes(30);

    // ── System pressure ──
    // fill_ratio: how full is the overall fleet?  Low fill ⟹ high pressure.
    let total_bikes: u32 = input.current_status.iter().map(|s| s.available_bikes).sum();
    let total_capacity: u32 = input.stations.iter().map(|s| s.capacity).sum();
    let fill_ratio = total_bikes as f64 / total_capacity.max(1) as f64;
    let pressure = (1.0 - fill_ratio).clamp(0.0, 1.0);

    let empty_count = deficits.iter().filter(|d| d.current_bikes == 0).count();
    // Unlock free rides when the system is genuinely stressed.
    let allow_free = pressure > 0.25 || empty_count >= 2;

    let mut incentives: Vec<PriceIncentive> = Vec::new();
    let mut running_cost = 0.0_f64;

    // ── Tier 1: Emergency free rides for empty stations ──
    // Only for stations NOT already served by a vehicle.  If a vehicle is en route,
    // that's a better (and free) solution — don't burn incentive budget on top of it.
    let emergency_budget = budget * 1.5;

    let mut empty_deficits: Vec<&StationGap> =
        deficits.iter().filter(|d| d.current_bikes == 0).collect();
    empty_deficits.sort_by(|a, b| b.urgency.partial_cmp(&a.urgency).unwrap());

    for deficit in &empty_deficits {
        let incoming = vehicle_inflow.get(&deficit.station_id).copied().unwrap_or(0);
        let needed   = (-deficit.gap) as u32;

        // Vehicle fully covers this station — no incentive needed.
        if incoming >= needed {
            continue;
        }

        // Residual gap the incentive still needs to cover.
        let residual = (needed - incoming) as f64;

        let discount = if allow_free && deficit.urgency >= 5.0 && incoming == 0 {
            100.0 // truly free ride — only when no vehicle at all
        } else {
            (max_discount * 0.80).clamp(50.0, 100.0)
        };

        // Scale expected demand by the residual fraction so cost is proportional.
        let residual_ratio = residual / needed.max(1) as f64;
        let expected_demand = residual * 1.8;
        let cost = incentive_cost(discount, expected_demand, avg_fare) * residual_ratio;

        if running_cost + cost <= emergency_budget {
            running_cost += cost;
            incentives.push(PriceIncentive {
                station_id:       deficit.station_id,
                incentive_type:   IncentiveType::ArrivalReward,
                discount_percent: discount,
                reward_credits:   discount * 0.5,
                valid_from:       now,
                valid_until,
                reason:           IncentiveReason::Rebalancing,
            });
        }
    }

    // ── Tier 2: Minimum-effective discounts for non-empty deficit stations ──
    // For partially-covered stations, target only the residual gap.
    let mut moderate_deficits: Vec<&StationGap> = deficits
        .iter()
        .filter(|d| d.current_bikes > 0)
        .collect();
    moderate_deficits.sort_by(|a, b| b.urgency.partial_cmp(&a.urgency).unwrap());

    for deficit in moderate_deficits {
        if running_cost >= budget {
            break;
        }

        let incoming = vehicle_inflow.get(&deficit.station_id).copied().unwrap_or(0);
        let needed   = (-deficit.gap) as u32;

        // Vehicle fully covers this station — skip incentive entirely.
        if incoming >= needed {
            continue;
        }

        let station   = input.stations.iter().find(|s| s.id == deficit.station_id);
        let capacity  = station.map(|s| s.capacity).unwrap_or(20) as f64;
        // Residual shortage after vehicle delivery.
        let residual  = (needed - incoming) as f64;
        let shortage_ratio = residual / capacity;

        // Target influence rate for the residual gap only.
        let target_influence = (shortage_ratio * 0.40).clamp(0.03, 0.20);
        let raw_discount     = inverse_logistic(target_influence);

        let discount = if deficit.current_bikes <= 2 {
            (raw_discount * 1.35).min(max_discount)
        } else {
            raw_discount.min(max_discount)
        };

        let expected_demand = residual * 1.5;
        let cost = incentive_cost(discount, expected_demand, avg_fare);

        if running_cost + cost <= budget {
            running_cost += cost;
            incentives.push(PriceIncentive {
                station_id:       deficit.station_id,
                incentive_type:   IncentiveType::ArrivalReward,
                discount_percent: discount,
                reward_credits:   discount * 0.25,
                valid_from:       now,
                valid_until,
                reason: IncentiveReason::PredictedShortage,
            });
        }
    }

    // ── Tier 3: Departure discounts for surplus stations ──
    // Only spend up to 40 % of remaining budget here since departure discounts are
    // untargeted: they push bikes away from the surplus but don't control the destination.
    let surplus_cap = (budget - running_cost) * 0.40;
    let mut surplus_cost = 0.0_f64;

    let mut sorted_surpluses: Vec<&StationGap> =
        surpluses.iter().filter(|s| s.gap > 0).collect();
    sorted_surpluses.sort_by(|a, b| b.gap.cmp(&a.gap)); // biggest surplus first

    for surplus in sorted_surpluses {
        if surplus_cost >= surplus_cap {
            break;
        }

        let station = input.stations.iter().find(|s| s.id == surplus.station_id);
        let capacity = station.map(|s| s.capacity).unwrap_or(20) as f64;
        let excess_ratio = surplus.gap as f64 / capacity;

        // Minimum effective departure discount — capped at 60 % of max.
        let target_influence = (excess_ratio * 0.30).clamp(0.03, 0.15);
        let discount = inverse_logistic(target_influence).min(max_discount * 0.60);

        let expected_demand = surplus.gap as f64 * 1.2;
        let cost = incentive_cost(discount, expected_demand, avg_fare);

        if surplus_cost + cost <= surplus_cap {
            surplus_cost += cost;
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

    incentives
}

/// Estimated yuan cost of offering `discount`% off `expected_demand` rides.
///
/// cost = (discount / 100) × avg_fare × influenced_rides
///      = (discount / 100) × avg_fare × logistic_response(discount) × expected_demand
///
/// This is the actual subsidy the operator pays, not the face value of the discount.
fn incentive_cost(discount: f64, expected_demand: f64, avg_fare: f64) -> f64 {
    let influence = logistic_response(discount);
    (discount / 100.0) * avg_fare * influence * expected_demand
}

/// Logistic response curve: fraction of eligible riders influenced by a given discount.
///
///   0%  discount →  ~3 % influence
///  10%  discount →  ~7 % influence
///  22%  discount → ~15 % influence   (inflection point)
///  30%  discount → ~18 % influence
///  50%  discount → ~24 % influence
/// 100%  discount → ~29 % influence   (free ride: strong but not universal)
fn logistic_response(discount: f64) -> f64 {
    let k = 0.065;
    let mid = 22.0;
    0.30 / (1.0 + (-k * (discount - mid)).exp())
}

/// Inverse of `logistic_response`: returns the minimum discount needed to achieve
/// `target_rate` fraction of influenced riders.
///
/// Derivation:
///   rate = 0.30 / (1 + exp(-k*(d-m)))
///   d = m + ln(rate / (0.30 - rate)) / k
fn inverse_logistic(target_rate: f64) -> f64 {
    let k = 0.065;
    let mid = 22.0;
    // Clamp away from the asymptote at 0.30.
    let rate = target_rate.clamp(0.001, 0.295);
    let d = mid + (rate / (0.30 - rate)).ln() / k;
    d.clamp(0.0, 100.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_logistic_response_range() {
        assert!(logistic_response(0.0) < 0.06);
        let r50 = logistic_response(50.0);
        assert!(r50 > 0.15 && r50 < 0.35, "50% discount response: {}", r50);
    }

    #[test]
    fn test_logistic_monotonic() {
        for d in (0..90).step_by(5) {
            let r1 = logistic_response(d as f64);
            let r2 = logistic_response(d as f64 + 5.0);
            assert!(r2 >= r1, "not monotonic at d={}", d);
        }
    }

    #[test]
    fn test_inverse_logistic_is_correct_inverse() {
        // Only test values where the exact inverse is in [0, 100].
        // logistic(0) ≈ 0.058, so targets below that are clamped and the
        // round-trip is inexact by design (no discount is needed).
        for target in [0.08, 0.10, 0.15, 0.20, 0.25] {
            let d = inverse_logistic(target);
            assert!(d >= 0.0, "discount should be non-negative for target={}", target);
            let recovered = logistic_response(d);
            assert!(
                (recovered - target).abs() < 0.002,
                "inverse_logistic({}) = {:.2} → logistic({:.1}) = {:.4} ≠ target",
                target,
                d,
                d,
                recovered
            );
        }
    }

    #[test]
    fn test_inverse_logistic_lower_target_gives_lower_discount() {
        let d_low = inverse_logistic(0.05);
        let d_mid = inverse_logistic(0.15);
        let d_high = inverse_logistic(0.25);
        assert!(d_low < d_mid, "lower target should require lower discount");
        assert!(d_mid < d_high, "lower target should require lower discount");
    }

    #[test]
    fn test_free_ride_for_critical_empty_station() {
        use bike_core::{
            DispatchVehicle, Station, StationCategory, StationId, StationStatus, SystemConfig,
        };
        use chrono::Utc;

        let stations = vec![
            Station {
                id: StationId(0),
                name: "Dorm A".into(),
                category: StationCategory::Dormitory,
                capacity: 30,
                latitude: 30.51,
                longitude: 114.35,
            },
            Station {
                id: StationId(1),
                name: "Lib".into(),
                category: StationCategory::Library,
                capacity: 20,
                latitude: 30.52,
                longitude: 114.36,
            },
        ];
        let now = Utc::now();
        let status = vec![
            StationStatus {
                station_id: StationId(0),
                available_bikes: 0, // empty — critical
                available_docks: 30,
                timestamp: now,
            },
            StationStatus {
                station_id: StationId(1),
                available_bikes: 18, // big surplus
                available_docks: 2,
                timestamp: now,
            },
        ];
        let targets = vec![(StationId(0), 20), (StationId(1), 5)];
        let input = RebalanceInput {
            stations,
            current_status: status,
            targets,
            distance_matrix: vec![vec![0.0, 500.0], vec![500.0, 0.0]],
            vehicles: vec![DispatchVehicle {
                id: 1,
                capacity: 10,
                current_position: StationId(1),
            }],
            config: SystemConfig::default(),
        };

        let deficits = vec![StationGap {
            station_id: StationId(0),
            index: 0,
            current_bikes: 0,
            gap: -20,
            urgency: 200.0, // very high: empty station, big shortage
        }];
        let surpluses = vec![StationGap {
            station_id: StationId(1),
            index: 1,
            current_bikes: 18,
            gap: 13,
            urgency: 0.0,
        }];

        let incentives = compute_incentives(&input, &surpluses, &deficits, &Default::default());

        let arrival = incentives
            .iter()
            .find(|i| i.station_id == StationId(0) && i.incentive_type == IncentiveType::ArrivalReward)
            .expect("should offer arrival incentive for empty station");

        // Under extreme pressure (fill=0/50=0%, pressure=1.0), should be free.
        assert_eq!(
            arrival.discount_percent, 100.0,
            "empty station with high urgency should get a free ride: got {}%",
            arrival.discount_percent
        );
    }

    #[test]
    fn test_moderate_deficit_uses_minimum_discount() {
        use bike_core::{
            DispatchVehicle, Station, StationCategory, StationId, StationStatus, SystemConfig,
        };
        use chrono::Utc;

        let stations = vec![Station {
            id: StationId(0),
            name: "Lib".into(),
            category: StationCategory::Library,
            capacity: 30,
            latitude: 30.51,
            longitude: 114.35,
        }];
        let now = Utc::now();
        // Fill ratio = 20/30 ≈ 67 % → pressure ≈ 33 % — moderate, no free rides needed.
        let status = vec![StationStatus {
            station_id: StationId(0),
            available_bikes: 20,
            available_docks: 10,
            timestamp: now,
        }];
        let targets = vec![(StationId(0), 28)]; // needs 8 more
        let input = RebalanceInput {
            stations,
            current_status: status,
            targets,
            distance_matrix: vec![vec![0.0]],
            vehicles: vec![DispatchVehicle {
                id: 1,
                capacity: 10,
                current_position: StationId(0),
            }],
            config: SystemConfig::default(),
        };

        let deficits = vec![StationGap {
            station_id: StationId(0),
            index: 0,
            current_bikes: 20,
            gap: -8,
            urgency: 0.4,
        }];

        let incentives = compute_incentives(&input, &[], &deficits, &Default::default());

        let arr = incentives
            .iter()
            .find(|i| i.incentive_type == IncentiveType::ArrivalReward);

        if let Some(arr) = arr {
            // Should NOT give a free ride for a moderate shortage.
            assert!(
                arr.discount_percent < 100.0,
                "moderate deficit should not trigger free ride, got {}%",
                arr.discount_percent
            );
            // Discount should be low — minimum effective for this shortage ratio.
            assert!(
                arr.discount_percent < 40.0,
                "moderate deficit discount should be conservative, got {}%",
                arr.discount_percent
            );
        }
        // It's also valid to issue no incentive if the minimum-effective discount
        // isn't worth spending budget on.
    }

    #[test]
    fn test_budget_is_respected() {
        use bike_core::{
            DispatchVehicle, Station, StationCategory, StationId, StationStatus, SystemConfig,
        };
        use chrono::Utc;

        // Many deficit stations, tiny budget — incentives should stay within budget.
        let mut config = SystemConfig::default();
        config.incentive_budget_per_hour = 5.0; // very tight: 5 yuan/hour

        let n = 10usize;
        let stations: Vec<Station> = (0..n)
            .map(|i| Station {
                id: StationId(i as u32),
                name: format!("S{i}"),
                category: StationCategory::AcademicBuilding,
                capacity: 20,
                latitude: 30.51,
                longitude: 114.35,
            })
            .collect();
        let now = Utc::now();
        let status: Vec<StationStatus> = (0..n)
            .map(|i| StationStatus {
                station_id: StationId(i as u32),
                available_bikes: 5,
                available_docks: 15,
                timestamp: now,
            })
            .collect();
        let targets: Vec<(StationId, u32)> = (0..n).map(|i| (StationId(i as u32), 15)).collect();
        let dm = vec![vec![0.0; n]; n];
        let input = RebalanceInput {
            stations,
            current_status: status,
            targets,
            distance_matrix: dm,
            vehicles: vec![DispatchVehicle {
                id: 1,
                capacity: 10,
                current_position: StationId(0),
            }],
            config,
        };

        let deficits: Vec<StationGap> = (0..n)
            .map(|i| StationGap {
                station_id: StationId(i as u32),
                index: i,
                current_bikes: 5,
                gap: -10,
                urgency: 2.0,
            })
            .collect();

        let incentives = compute_incentives(&input, &[], &deficits, &Default::default());
        let avg_fare = 2.0_f64;
        let total_cost: f64 = incentives.iter().map(|inc| {
            incentive_cost(inc.discount_percent, 15.0, avg_fare)
        }).sum();

        // Tier-2 budget is strictly `budget` (5 yuan); no emergency relaxation here.
        assert!(
            total_cost <= 5.0 * 1.01, // 1% tolerance for float rounding
            "total incentive cost {total_cost:.2} exceeds budget 5.0"
        );
    }

    #[test]
    fn test_departure_discount_capped_below_max() {
        use bike_core::{
            DispatchVehicle, Station, StationCategory, StationId, StationStatus, SystemConfig,
        };
        use chrono::Utc;

        let now = Utc::now();
        let stations = vec![
            Station {
                id: StationId(0),
                name: "Dorm".into(),
                category: StationCategory::Dormitory,
                capacity: 30,
                latitude: 30.51,
                longitude: 114.35,
            },
            Station {
                id: StationId(1),
                name: "Lib".into(),
                category: StationCategory::Library,
                capacity: 30,
                latitude: 30.52,
                longitude: 114.36,
            },
        ];
        let status = vec![
            StationStatus {
                station_id: StationId(0),
                available_bikes: 5,
                available_docks: 25,
                timestamp: now,
            },
            StationStatus {
                station_id: StationId(1),
                available_bikes: 25,
                available_docks: 5,
                timestamp: now,
            },
        ];
        let mut config = SystemConfig::default();
        config.max_incentive_discount = 60.0;
        let input = RebalanceInput {
            stations,
            current_status: status,
            targets: vec![(StationId(0), 15), (StationId(1), 10)],
            distance_matrix: vec![vec![0.0, 500.0], vec![500.0, 0.0]],
            vehicles: vec![DispatchVehicle {
                id: 1,
                capacity: 10,
                current_position: StationId(0),
            }],
            config,
        };

        let deficits = vec![StationGap {
            station_id: StationId(0),
            index: 0,
            current_bikes: 5,
            gap: -10,
            urgency: 2.0,
        }];
        let surpluses = vec![StationGap {
            station_id: StationId(1),
            index: 1,
            current_bikes: 25,
            gap: 15,
            urgency: 0.0,
        }];

        let incentives = compute_incentives(&input, &surpluses, &deficits, &Default::default());

        let dep = incentives.iter().find(|i| i.incentive_type == IncentiveType::DepartureDiscount);
        if let Some(dep) = dep {
            // Departure discounts must not exceed 60% of max_discount = 36%.
            assert!(
                dep.discount_percent <= 60.0 * 0.60 + 0.1,
                "departure discount ({:.1}%) should be capped at 60% of max (36%)",
                dep.discount_percent
            );
        }
        // Both incentive types should be issued.
        assert!(incentives.iter().any(|i| i.incentive_type == IncentiveType::ArrivalReward));
        assert!(incentives.iter().any(|i| i.incentive_type == IncentiveType::DepartureDiscount));
    }

    #[test]
    fn test_vehicle_covered_station_skips_incentive() {
        use bike_core::{
            DispatchVehicle, Station, StationCategory, StationId, StationStatus, SystemConfig,
        };
        use chrono::Utc;
        use std::collections::HashMap;

        let now = Utc::now();
        let stations = vec![
            Station {
                id: StationId(0),
                name: "Dorm".into(),
                category: StationCategory::Dormitory,
                capacity: 30,
                latitude: 30.51,
                longitude: 114.35,
            },
            Station {
                id: StationId(1),
                name: "Lib".into(),
                category: StationCategory::Library,
                capacity: 30,
                latitude: 30.52,
                longitude: 114.36,
            },
        ];
        let status = vec![
            StationStatus {
                station_id: StationId(0),
                available_bikes: 0, // empty — needs bikes
                available_docks: 30,
                timestamp: now,
            },
            StationStatus {
                station_id: StationId(1),
                available_bikes: 25,
                available_docks: 5,
                timestamp: now,
            },
        ];
        let input = RebalanceInput {
            stations,
            current_status: status,
            targets: vec![(StationId(0), 20), (StationId(1), 5)],
            distance_matrix: vec![vec![0.0, 500.0], vec![500.0, 0.0]],
            vehicles: vec![DispatchVehicle {
                id: 1,
                capacity: 20,
                current_position: StationId(1),
            }],
            config: SystemConfig::default(),
        };

        let deficits = vec![StationGap {
            station_id: StationId(0),
            index: 0,
            current_bikes: 0,
            gap: -20,
            urgency: 200.0,
        }];
        let surpluses = vec![StationGap {
            station_id: StationId(1),
            index: 1,
            current_bikes: 25,
            gap: 13,
            urgency: 0.0,
        }];

        // Simulate: vehicle will deliver exactly the full deficit (20 bikes) to station 0.
        let mut full_coverage: HashMap<StationId, u32> = HashMap::new();
        full_coverage.insert(StationId(0), 20);

        let incentives_with_vehicle = compute_incentives(&input, &surpluses, &deficits, &full_coverage);
        let incentives_no_vehicle   = compute_incentives(&input, &surpluses, &deficits, &Default::default());

        // Without vehicle: station 0 (empty, high urgency) should get a free ride incentive.
        assert!(
            incentives_no_vehicle.iter().any(|i| i.station_id == StationId(0)),
            "no-vehicle case should issue incentive for empty station"
        );

        // With vehicle covering the full gap: station 0 should NOT receive an incentive
        // (the vehicle already solves the problem — don't double-spend).
        assert!(
            !incentives_with_vehicle.iter().any(|i| i.station_id == StationId(0)),
            "vehicle-covered station should not receive an additional incentive"
        );
    }

    #[test]
    fn test_partial_vehicle_coverage_reduces_incentive() {
        use bike_core::{
            DispatchVehicle, Station, StationCategory, StationId, StationStatus, SystemConfig,
        };
        use chrono::Utc;
        use std::collections::HashMap;

        let now = Utc::now();
        let stations = vec![Station {
            id: StationId(0),
            name: "Dorm".into(),
            category: StationCategory::Dormitory,
            capacity: 30,
            latitude: 30.51,
            longitude: 114.35,
        }];
        let status = vec![StationStatus {
            station_id: StationId(0),
            available_bikes: 0,
            available_docks: 30,
            timestamp: now,
        }];
        let input = RebalanceInput {
            stations,
            current_status: status,
            targets: vec![(StationId(0), 20)],
            distance_matrix: vec![vec![0.0]],
            vehicles: vec![DispatchVehicle {
                id: 1,
                capacity: 10,
                current_position: StationId(0),
            }],
            config: SystemConfig::default(),
        };

        let deficits = vec![StationGap {
            station_id: StationId(0),
            index: 0,
            current_bikes: 0,
            gap: -20,
            urgency: 200.0,
        }];

        // Vehicle delivers only 10 of the 20 needed — residual = 10.
        let mut partial: HashMap<StationId, u32> = HashMap::new();
        partial.insert(StationId(0), 10);

        let inc_partial = compute_incentives(&input, &[], &deficits, &partial);
        let inc_none    = compute_incentives(&input, &[], &deficits, &Default::default());

        // Both should issue an incentive (residual gap still exists).
        let cost_partial = inc_partial.iter()
            .find(|i| i.station_id == StationId(0))
            .map(|i| incentive_cost(i.discount_percent, 10.0 * 1.8, 2.0))
            .unwrap_or(0.0);
        let cost_none = inc_none.iter()
            .find(|i| i.station_id == StationId(0))
            .map(|i| incentive_cost(i.discount_percent, 20.0 * 1.8, 2.0))
            .unwrap_or(0.0);

        // Partial-coverage incentive should cost less than no-coverage.
        assert!(
            cost_partial < cost_none,
            "partial vehicle coverage should yield lower incentive cost ({cost_partial:.2} vs {cost_none:.2})"
        );
    }
}
