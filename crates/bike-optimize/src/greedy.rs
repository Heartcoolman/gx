use bike_core::{
    DispatchPlan, DispatchVehicle, RebalanceInput, RebalanceOutput, StationId, VehicleRoute,
};
use chrono::Utc;
use uuid::Uuid;

use crate::incentive::compute_incentives;
use crate::vrp::optimize_routes;
use crate::RebalanceSolver;

/// A station classified as having surplus or deficit.
#[derive(Debug, Clone)]
pub(crate) struct StationGap {
    pub station_id: StationId,
    /// Index into the station/status arrays.
    pub index: usize,
    /// Positive = surplus (has more than target), Negative = deficit (needs more).
    pub gap: i32,
    /// Urgency score for deficits (higher = more critical).
    pub urgency: f64,
}

/// Compute the gap between current inventory and target for each station.
pub(crate) fn compute_gaps(input: &RebalanceInput) -> (Vec<StationGap>, Vec<StationGap>) {
    let mut surpluses = Vec::new();
    let mut deficits = Vec::new();

    for (i, (station_id, target)) in input.targets.iter().enumerate() {
        let current = input
            .current_status
            .iter()
            .find(|s| s.station_id == *station_id)
            .map(|s| s.available_bikes)
            .unwrap_or(0);

        let gap = current as i32 - *target as i32;

        if gap > 0 {
            surpluses.push(StationGap {
                station_id: *station_id,
                index: i,
                gap,
                urgency: 0.0,
            });
        } else if gap < 0 {
            // Urgency: bigger shortage + fewer remaining bikes = more urgent.
            let shortage = (-gap) as f64;
            let remaining = current.max(1) as f64;
            let urgency = shortage / remaining;
            deficits.push(StationGap {
                station_id: *station_id,
                index: i,
                gap,
                urgency,
            });
        }
    }

    // Sort deficits by urgency descending (most critical first).
    deficits.sort_by(|a, b| b.urgency.partial_cmp(&a.urgency).unwrap());
    // Sort surpluses by gap descending (largest surplus first).
    surpluses.sort_by(|a, b| b.gap.cmp(&a.gap));

    (surpluses, deficits)
}

/// A move order: take `count` bikes from `from` to `to`.
#[derive(Debug, Clone)]
pub(crate) struct MoveOrder {
    pub from: StationId,
    pub from_index: usize,
    pub to: StationId,
    pub to_index: usize,
    pub count: u32,
}

/// Greedy assignment: satisfy deficits from nearest surpluses.
pub(crate) fn greedy_assign(
    surpluses: &mut [StationGap],
    deficits: &[StationGap],
    distance_matrix: &[Vec<f64>],
) -> Vec<MoveOrder> {
    let mut orders = Vec::new();

    for deficit in deficits {
        let mut needed = (-deficit.gap) as u32;
        if needed == 0 {
            continue;
        }

        // Sort surpluses by distance to this deficit.
        let mut candidates: Vec<(usize, f64)> = surpluses
            .iter()
            .enumerate()
            .filter(|(_, s)| s.gap > 0)
            .map(|(i, s)| {
                let dist = distance_matrix
                    .get(s.index)
                    .and_then(|row| row.get(deficit.index))
                    .copied()
                    .unwrap_or(f64::MAX);
                (i, dist)
            })
            .collect();
        candidates.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap());

        for (surplus_idx, _dist) in candidates {
            if needed == 0 {
                break;
            }
            let surplus = &mut surpluses[surplus_idx];
            if surplus.gap <= 0 {
                continue;
            }
            let take = needed.min(surplus.gap as u32);
            orders.push(MoveOrder {
                from: surplus.station_id,
                from_index: surplus.index,
                to: deficit.station_id,
                to_index: deficit.index,
                count: take,
            });
            surplus.gap -= take as i32;
            needed -= take;
        }
    }

    orders
}

/// Build vehicle routes from move orders using VRP.
fn build_routes(
    orders: &[MoveOrder],
    vehicles: &[DispatchVehicle],
    distance_matrix: &[Vec<f64>],
) -> Vec<VehicleRoute> {
    if orders.is_empty() || vehicles.is_empty() {
        return Vec::new();
    }
    optimize_routes(orders, vehicles, distance_matrix)
}

/// The main greedy rebalance solver.
pub struct GreedyRebalanceSolver;

impl GreedyRebalanceSolver {
    pub fn new() -> Self {
        Self
    }
}

impl Default for GreedyRebalanceSolver {
    fn default() -> Self {
        Self::new()
    }
}

impl RebalanceSolver for GreedyRebalanceSolver {
    fn solve(&self, input: &RebalanceInput) -> RebalanceOutput {
        let (mut surpluses, deficits) = compute_gaps(input);
        let orders = greedy_assign(&mut surpluses, &deficits, &input.distance_matrix);

        let total_bikes_moved: u32 = orders.iter().map(|o| o.count).sum();
        let vehicle_routes = build_routes(&orders, &input.vehicles, &input.distance_matrix);

        let dispatch_plan = DispatchPlan {
            id: Uuid::new_v4(),
            generated_at: Utc::now(),
            vehicle_routes,
            total_bikes_moved,
        };

        let incentives = compute_incentives(input, &surpluses, &deficits);

        RebalanceOutput {
            dispatch_plan,
            incentives,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bike_core::{Station, StationCategory, StationStatus, SystemConfig};
    use chrono::Utc;

    fn test_input() -> RebalanceInput {
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
                name: "Building 1".into(),
                category: StationCategory::AcademicBuilding,
                capacity: 25,
                latitude: 30.52,
                longitude: 114.36,
            },
            Station {
                id: StationId(2),
                name: "Cafeteria".into(),
                category: StationCategory::Cafeteria,
                capacity: 20,
                latitude: 30.515,
                longitude: 114.355,
            },
        ];
        let now = Utc::now();
        let status = vec![
            StationStatus {
                station_id: StationId(0),
                available_bikes: 5,
                available_docks: 25,
                timestamp: now,
            },
            StationStatus {
                station_id: StationId(1),
                available_bikes: 22,
                available_docks: 3,
                timestamp: now,
            },
            StationStatus {
                station_id: StationId(2),
                available_bikes: 15,
                available_docks: 5,
                timestamp: now,
            },
        ];
        // Dorm needs 20, Building needs 8, Cafeteria needs 10
        let targets = vec![
            (StationId(0), 20),
            (StationId(1), 8),
            (StationId(2), 10),
        ];
        let distance_matrix = vec![
            vec![0.0, 800.0, 500.0],
            vec![800.0, 0.0, 600.0],
            vec![500.0, 600.0, 0.0],
        ];
        let vehicles = vec![DispatchVehicle {
            id: 1,
            capacity: 15,
            current_position: StationId(0),
        }];

        RebalanceInput {
            stations,
            current_status: status,
            targets,
            distance_matrix,
            vehicles,
            config: SystemConfig::default(),
        }
    }

    #[test]
    fn test_gap_computation() {
        let input = test_input();
        let (surpluses, deficits) = compute_gaps(&input);

        // Building has 22, target 8 => surplus 14
        assert_eq!(surpluses.len(), 2); // Building (14) and Cafeteria (5)
        // Dorm has 5, target 20 => deficit 15
        assert_eq!(deficits.len(), 1);
        assert_eq!(deficits[0].station_id, StationId(0));
    }

    #[test]
    fn test_greedy_allocation() {
        let input = test_input();
        let (mut surpluses, deficits) = compute_gaps(&input);
        let orders = greedy_assign(&mut surpluses, &deficits, &input.distance_matrix);

        let total: u32 = orders.iter().map(|o| o.count).sum();
        // Deficit is 15, surplus available is 14+5=19, so all 15 should be covered.
        assert_eq!(total, 15);
    }

    #[test]
    fn test_solve_produces_valid_plan() {
        let input = test_input();
        let solver = GreedyRebalanceSolver::new();
        let output = solver.solve(&input);

        assert!(output.dispatch_plan.total_bikes_moved > 0);
        // Vehicle capacity is 15, so moves should not exceed that per trip.
        for route in &output.dispatch_plan.vehicle_routes {
            for stop in &route.stops {
                assert!(stop.load_after <= route.capacity);
            }
        }
    }

    #[test]
    fn test_no_action_when_balanced() {
        let mut input = test_input();
        // Set targets = current
        input.targets = vec![
            (StationId(0), 5),
            (StationId(1), 22),
            (StationId(2), 15),
        ];
        let solver = GreedyRebalanceSolver::new();
        let output = solver.solve(&input);
        assert_eq!(output.dispatch_plan.total_bikes_moved, 0);
    }
}
