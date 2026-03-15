use bike_core::{
    DispatchPlan, DispatchVehicle, RebalanceInput, RebalanceOutput, RouteStop, StationId,
    StopAction, VehicleRoute,
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
    pub current_bikes: u32,
    /// Positive = surplus (has more than target), Negative = deficit (needs more).
    pub gap: i32,
    /// Urgency score for deficits (higher = more critical).
    pub urgency: f64,
}

#[derive(Debug, Clone)]
struct HotspotCandidate {
    station_id: StationId,
    index: usize,
    score: f64,
}

/// Compute the gap between current inventory and target for each station.
pub(crate) fn compute_gaps(input: &RebalanceInput) -> (Vec<StationGap>, Vec<StationGap>) {
    let mut surpluses = Vec::new();
    let mut deficits = Vec::new();

    // O(1) lookup instead of O(n) .find() per station
    let status_map: std::collections::HashMap<StationId, u32> = input
        .current_status
        .iter()
        .map(|s| (s.station_id, s.available_bikes))
        .collect();

    // Map station_id -> index in the stations (and distance_matrix) array.
    // This decouples gap computation from targets ordering.
    let station_index_map: std::collections::HashMap<StationId, usize> = input
        .stations
        .iter()
        .enumerate()
        .map(|(i, s)| (s.id, i))
        .collect();

    for (station_id, target) in input.targets.iter() {
        let current = status_map.get(station_id).copied().unwrap_or(0);
        let Some(station_idx) = station_index_map.get(station_id).copied() else { continue; };

        let gap = current as i32 - *target as i32;

        if gap > 0 {
            surpluses.push(StationGap {
                station_id: *station_id,
                index: station_idx,
                current_bikes: current,
                gap,
                urgency: 0.0,
            });
        } else if gap < 0 {
            // Urgency: bigger shortage + fewer remaining bikes = more urgent.
            // Empty stations (0 bikes) get a massive urgency boost.
            let shortage = (-gap) as f64;
            let urgency = if current == 0 {
                shortage * 10.0 // empty station: critical priority
            } else {
                shortage / current as f64
            };
            deficits.push(StationGap {
                station_id: *station_id,
                index: station_idx,
                current_bikes: current,
                gap,
                urgency,
            });
        }
    }

    // Sort deficits by urgency descending (most critical first).
    deficits.sort_by(|a, b| b.urgency.partial_cmp(&a.urgency).unwrap_or(std::cmp::Ordering::Equal));
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

fn station_distance(distance_matrix: &[Vec<f64>], from_index: usize, to_index: usize) -> f64 {
    distance_matrix
        .get(from_index)
        .and_then(|row| row.get(to_index))
        .copied()
        .unwrap_or(f64::MAX)
}

fn transfer_score(
    surplus: &StationGap,
    deficit: &StationGap,
    take: u32,
    distance: f64,
    peak_mode: bool,
    already_allocated: u32,
) -> f64 {
    let urgency_weight = 1.0 + deficit.urgency * if peak_mode { 1.25 } else { 0.65 };
    // Coverage bonus: eliminating an empty station is the highest-value action.
    let coverage_bonus = if deficit.current_bikes == 0 && already_allocated == 0 {
        8.0
    } else if deficit.current_bikes == 0 {
        3.5
    } else if deficit.current_bikes <= 2 && already_allocated == 0 {
        3.0
    } else if deficit.current_bikes <= 2 {
        1.5
    } else {
        0.0
    };
    // Marginal decay: discourage over-concentrating limited capacity on one deficit.
    let marginal_decay = 1.0 / (1.0 + already_allocated as f64 * 0.35);
    let source_headroom =
        ((surplus.gap.max(0) as f64) / surplus.current_bikes.max(1) as f64).min(3.0);
    let source_efficiency = 1.0 + source_headroom * 0.3;
    // In peak mode, reduce distance penalty so critical empty stations get served
    // even when the nearest surplus is far away.
    let effective_distance = if peak_mode { distance * 0.4 } else { distance };
    let trip_efficiency = take as f64 / (effective_distance + 100.0);

    // Add distance cost: penalize long-distance transfers more heavily
    let distance_cost = 1.0 / (1.0 + distance / 500.0);

    // Demand uncertainty penalty: deficits with low urgency might resolve naturally
    let uncertainty_penalty = if deficit.urgency < 1.0 { 0.7 } else { 1.0 };

    trip_efficiency * (urgency_weight + coverage_bonus) * source_efficiency * marginal_decay * distance_cost * uncertainty_penalty
}

/// Greedy assignment: satisfy deficits from nearest surpluses.
/// Uses a two-round strategy:
///   Round 1: Each deficit can take at most 50% of any surplus (spread allocation).
///   Round 2: Remaining surplus is distributed without cap (greedy fill).
pub(crate) fn greedy_assign(
    surpluses: &mut [StationGap],
    deficits: &[StationGap],
    distance_matrix: &[Vec<f64>],
    fleet_capacity: u32,
    max_order_size: u32,
    peak_mode: bool,
) -> Vec<MoveOrder> {
    let mut orders = Vec::new();
    if fleet_capacity == 0 || max_order_size == 0 {
        return orders;
    }

    let mut deficit_remaining: Vec<u32> = deficits.iter().map(|d| (-d.gap) as u32).collect();
    let mut deficit_allocated: Vec<u32> = vec![0; deficits.len()];
    let mut remaining_capacity = fleet_capacity;

    if peak_mode {
        // ── Phase 0: Coverage ──
        // Guarantee every empty or near-empty station receives a meaningful
        // allocation from the nearest surplus before global optimization begins.
        for di in 0..deficits.len() {
            let deficit = &deficits[di];
            // Cover both empty stations (0 bikes) and near-empty (1–2 bikes)
            let min_coverage = if deficit.current_bikes == 0 {
                4 // empty stations: provide enough to sustain short-term demand
            } else if deficit.current_bikes <= 2 {
                2 // near-empty stations: top up to prevent imminent emptying
            } else {
                continue
            };
            if deficit_remaining[di] == 0 || remaining_capacity == 0 {
                continue;
            }
            let coverage_cap = deficit_remaining[di]
                .min(min_coverage)
                .min(remaining_capacity);
            let nearest = surpluses
                .iter()
                .enumerate()
                .filter(|(_, s)| s.gap > 0)
                .min_by(|(_, a), (_, b)| {
                    let da = station_distance(distance_matrix, a.index, deficit.index);
                    let db = station_distance(distance_matrix, b.index, deficit.index);
                    da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
                });
            if let Some((si, _)) = nearest {
                let take = coverage_cap.min(surpluses[si].gap as u32);
                if take > 0 {
                    let before = deficit_remaining[di];
                    let surplus = &mut surpluses[si];
                    allocate_chunked_order(
                        &mut orders,
                        surplus,
                        deficit,
                        take,
                        max_order_size,
                        &mut deficit_remaining[di],
                        &mut remaining_capacity,
                    );
                    deficit_allocated[di] += before - deficit_remaining[di];
                }
            }
        }

        // ── Phase 1: Greedy with marginal decay ──
        while remaining_capacity > 0 {
            let mut best_pair: Option<(usize, usize, u32, f64, f64)> = None;

            for (di, deficit) in deficits.iter().enumerate() {
                if deficit_remaining[di] == 0 {
                    continue;
                }

                for (surplus_idx, surplus) in surpluses.iter().enumerate() {
                    if surplus.gap <= 0 {
                        continue;
                    }

                    let take = deficit_remaining[di]
                        .min(surplus.gap as u32)
                        .min(remaining_capacity)
                        .min(max_order_size);
                    if take == 0 {
                        continue;
                    }

                    let distance = station_distance(distance_matrix, surplus.index, deficit.index);
                    let score = transfer_score(
                        surplus, deficit, take, distance, true, deficit_allocated[di],
                    );

                    let should_replace = best_pair
                        .as_ref()
                        .map(|(_, _, _, best_score, best_distance)| {
                            score > *best_score
                                || (score == *best_score && distance < *best_distance)
                        })
                        .unwrap_or(true);

                    if should_replace {
                        best_pair = Some((surplus_idx, di, take, score, distance));
                    }
                }
            }

            let Some((surplus_idx, di, take, _, _)) = best_pair else {
                break;
            };

            let before = deficit_remaining[di];
            let surplus = &mut surpluses[surplus_idx];
            allocate_chunked_order(
                &mut orders,
                surplus,
                &deficits[di],
                take,
                max_order_size,
                &mut deficit_remaining[di],
                &mut remaining_capacity,
            );
            deficit_allocated[di] += before - deficit_remaining[di];
        }

        return orders;
    }

    // Round 1: proportional — each deficit takes at most 50% of any single surplus.
    assign_round(
        &mut orders,
        surpluses,
        deficits,
        &mut deficit_remaining,
        &mut deficit_allocated,
        &mut remaining_capacity,
        distance_matrix,
        max_order_size,
        Some(0.5),
    );

    // Round 2: uncapped — distribute remaining surplus greedily.
    assign_round(
        &mut orders,
        surpluses,
        deficits,
        &mut deficit_remaining,
        &mut deficit_allocated,
        &mut remaining_capacity,
        distance_matrix,
        max_order_size,
        None,
    );

    orders
}

/// Common assignment round used by the non-peak greedy path.
/// When `cap_ratio` is `Some(0.5)`, each deficit takes at most 50% of any single surplus (Round 1).
/// When `cap_ratio` is `None`, no cap is applied (Round 2).
fn assign_round(
    orders: &mut Vec<MoveOrder>,
    surpluses: &mut [StationGap],
    deficits: &[StationGap],
    deficit_remaining: &mut [u32],
    deficit_allocated: &mut [u32],
    remaining_capacity: &mut u32,
    distance_matrix: &[Vec<f64>],
    max_order_size: u32,
    cap_ratio: Option<f64>,
) {
    for (di, deficit) in deficits.iter().enumerate() {
        if deficit_remaining[di] == 0 || *remaining_capacity == 0 {
            continue;
        }

        let mut candidates: Vec<(usize, f64, f64)> = surpluses
            .iter()
            .enumerate()
            .filter(|(_, s)| s.gap > 0)
            .map(|(i, s)| {
                let dist = station_distance(distance_matrix, s.index, deficit.index);
                let take = if let Some(ratio) = cap_ratio {
                    let max_from_this = ((s.gap as f64) * ratio).ceil() as u32;
                    deficit_remaining[di]
                        .min(max_from_this)
                        .min(s.gap as u32)
                        .min(*remaining_capacity)
                        .min(max_order_size)
                } else {
                    deficit_remaining[di]
                        .min(s.gap as u32)
                        .min(*remaining_capacity)
                        .min(max_order_size)
                };
                let score = transfer_score(s, deficit, take, dist, false, deficit_allocated[di]);
                (i, score, dist)
            })
            .collect();
        candidates.sort_by(|a, b| {
            b.1.partial_cmp(&a.1)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.2.partial_cmp(&b.2).unwrap_or(std::cmp::Ordering::Equal))
        });

        for (surplus_idx, _, _) in &candidates {
            if deficit_remaining[di] == 0 || *remaining_capacity == 0 {
                break;
            }
            let surplus = &mut surpluses[*surplus_idx];
            if surplus.gap <= 0 {
                continue;
            }
            let take = if let Some(ratio) = cap_ratio {
                let max_from_this = ((surplus.gap as f64) * ratio).ceil() as u32;
                deficit_remaining[di]
                    .min(max_from_this)
                    .min(surplus.gap as u32)
                    .min(*remaining_capacity)
            } else {
                deficit_remaining[di]
                    .min(surplus.gap as u32)
                    .min(*remaining_capacity)
            };
            if take == 0 {
                continue;
            }

            let before = deficit_remaining[di];
            allocate_chunked_order(
                orders,
                surplus,
                deficit,
                take,
                max_order_size,
                &mut deficit_remaining[di],
                remaining_capacity,
            );
            deficit_allocated[di] += before - deficit_remaining[di];
        }
    }
}

fn allocate_chunked_order(
    orders: &mut Vec<MoveOrder>,
    surplus: &mut StationGap,
    deficit: &StationGap,
    mut total_take: u32,
    max_order_size: u32,
    deficit_remaining: &mut u32,
    remaining_capacity: &mut u32,
) {
    while total_take > 0 && *remaining_capacity > 0 {
        let chunk = total_take.min(max_order_size).min(*remaining_capacity);
        if chunk == 0 {
            break;
        }

        orders.push(MoveOrder {
            from: surplus.station_id,
            from_index: surplus.index,
            to: deficit.station_id,
            to_index: deficit.index,
            count: chunk,
        });

        surplus.gap -= chunk as i32;
        *deficit_remaining -= chunk;
        *remaining_capacity -= chunk;
        total_take -= chunk;
    }
}

fn travel_minutes(distance_meters: f64) -> f64 {
    let avg_speed_mps = 5.0;
    (distance_meters / avg_speed_mps) / 60.0
}

fn build_hotspot_candidates(
    input: &RebalanceInput,
    deficits: &[StationGap],
    orders: &[MoveOrder],
    peak_mode: bool,
) -> Vec<HotspotCandidate> {
    let mut planned_inflow: std::collections::HashMap<StationId, u32> =
        std::collections::HashMap::new();
    for order in orders {
        *planned_inflow.entry(order.to).or_insert(0) += order.count;
    }

    let urgency_by_station: std::collections::HashMap<StationId, f64> = deficits
        .iter()
        .map(|deficit| (deficit.station_id, deficit.urgency))
        .collect();

    // O(1) lookup instead of O(n) .find() per station
    let status_map: std::collections::HashMap<StationId, u32> = input
        .current_status
        .iter()
        .map(|s| (s.station_id, s.available_bikes))
        .collect();

    // Map station_id -> index in the stations (and distance_matrix) array.
    let station_index_map: std::collections::HashMap<StationId, usize> = input
        .stations
        .iter()
        .enumerate()
        .map(|(i, s)| (s.id, i))
        .collect();

    let mut hotspots = Vec::new();
    for (station_id, target) in input.targets.iter() {
        let station_idx = match station_index_map.get(station_id).copied() {
            Some(idx) => idx,
            None => continue,
        };
        let station = match input.stations.get(station_idx) {
            Some(station) => station,
            None => continue,
        };
        let current = status_map.get(station_id).copied().unwrap_or(0);
        let planned = planned_inflow.get(station_id).copied().unwrap_or(0);
        let residual_shortage = target.saturating_sub(current.saturating_add(planned));
        if residual_shortage == 0 {
            continue;
        }

        let capacity = station.capacity.max(1) as f64;
        let shortage_ratio = residual_shortage as f64 / capacity;
        let target_ratio = *target as f64 / capacity;
        let urgency = urgency_by_station.get(station_id).copied().unwrap_or(0.0);
        let score = shortage_ratio * 5.0
            + target_ratio * if peak_mode { 2.5 } else { 1.5 }
            + urgency * if peak_mode { 0.25 } else { 0.1 }
            + if current == 0 { 1.0 } else { 0.0 };

        hotspots.push(HotspotCandidate {
            station_id: *station_id,
            index: station_idx,
            score,
        });
    }

    hotspots.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    hotspots
}

fn append_hotspot_staging(
    routes: &mut Vec<VehicleRoute>,
    input: &RebalanceInput,
    deficits: &[StationGap],
    orders: &[MoveOrder],
    peak_mode: bool,
) {
    if input.vehicles.is_empty() {
        return;
    }

    let hotspots = build_hotspot_candidates(input, deficits, orders, peak_mode);
    if hotspots.is_empty() {
        return;
    }

    let station_index_by_id: std::collections::HashMap<StationId, usize> = input
        .stations
        .iter()
        .enumerate()
        .map(|(index, station)| (station.id, index))
        .collect();
    let mut hotspot_assignments: std::collections::HashMap<StationId, u32> =
        std::collections::HashMap::new();
    let max_route_minutes = (input.config.rebalance_interval_minutes.max(1) as f64) * 1.5;

    for vehicle in &input.vehicles {
        let route_index = routes
            .iter()
            .position(|route| route.vehicle_id == vehicle.id);
        let (current_station_id, current_index, current_route_minutes) =
            if let Some(index) = route_index {
                let route = &routes[index];
                let station_id = route
                    .stops
                    .last()
                    .map(|stop| stop.station_id)
                    .unwrap_or(vehicle.current_position);
                let station_index = match station_index_by_id.get(&station_id) {
                    Some(&idx) => idx,
                    None => continue,
                };
                (station_id, station_index, route.estimated_duration_minutes)
            } else {
                (
                    vehicle.current_position,
                    vehicle.current_position.0 as usize,
                    0.0,
                )
            };

        let best_hotspot = hotspots
            .iter()
            .filter_map(|hotspot| {
                let distance =
                    station_distance(&input.distance_matrix, current_index, hotspot.index);
                let stage_minutes = travel_minutes(distance);
                if current_route_minutes + stage_minutes > max_route_minutes {
                    return None;
                }

                let spread_penalty = 1.0
                    + hotspot_assignments
                        .get(&hotspot.station_id)
                        .copied()
                        .unwrap_or(0) as f64
                        * 0.7;
                let score = hotspot.score / spread_penalty / (1.0 + distance / 700.0);
                Some((hotspot, score, distance, stage_minutes))
            })
            .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));

        let Some((hotspot, score, distance, stage_minutes)) = best_hotspot else {
            continue;
        };
        if hotspot.station_id == current_station_id || score < 0.6 {
            continue;
        }

        *hotspot_assignments.entry(hotspot.station_id).or_insert(0) += 1;

        if let Some(index) = route_index {
            let route = &mut routes[index];
            route.stops.push(RouteStop {
                station_id: hotspot.station_id,
                action: StopAction::Dropoff,
                bike_count: 0,
                load_after: 0,
            });
            route.total_distance_meters += distance;
            route.estimated_duration_minutes += stage_minutes;
        } else {
            routes.push(VehicleRoute {
                vehicle_id: vehicle.id,
                capacity: vehicle.capacity,
                stops: vec![
                    RouteStop {
                        station_id: current_station_id,
                        action: StopAction::Dropoff,
                        bike_count: 0,
                        load_after: 0,
                    },
                    RouteStop {
                        station_id: hotspot.station_id,
                        action: StopAction::Dropoff,
                        bike_count: 0,
                        load_after: 0,
                    },
                ],
                total_distance_meters: distance,
                estimated_duration_minutes: stage_minutes,
            });
        }
    }
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
        let fleet_capacity: u32 = input.vehicles.iter().map(|vehicle| vehicle.capacity).sum();
        let max_order_size = input
            .vehicles
            .iter()
            .map(|vehicle| vehicle.capacity)
            .max()
            .unwrap_or(0);
        let total_deficit: u32 = deficits.iter().map(|d| (-d.gap) as u32).sum();
        let peak_mode = total_deficit > fleet_capacity
            || deficits.iter().any(|d| d.current_bikes == 0)
            || deficits.iter().filter(|d| d.urgency >= 6.0).count() >= 2;
        let orders = greedy_assign(
            &mut surpluses,
            &deficits,
            &input.distance_matrix,
            fleet_capacity,
            max_order_size,
            peak_mode,
        );

        let mut vehicle_routes = build_routes(&orders, &input.vehicles, &input.distance_matrix);
        append_hotspot_staging(&mut vehicle_routes, input, &deficits, &orders, peak_mode);
        let total_bikes_moved: u32 = vehicle_routes
            .iter()
            .map(|route| {
                route
                    .stops
                    .iter()
                    .filter(|stop| matches!(stop.action, bike_core::StopAction::Pickup))
                    .map(|stop| stop.bike_count)
                    .sum::<u32>()
            })
            .sum();

        let dispatch_plan = DispatchPlan {
            id: Uuid::new_v4(),
            generated_at: Utc::now(),
            vehicle_routes,
            total_bikes_moved,
        };

        // Build vehicle_inflow: how many bikes each deficit station will receive
        // this cycle, so compute_incentives can skip / reduce incentives where
        // vehicles already cover the gap.
        let vehicle_inflow: std::collections::HashMap<bike_core::StationId, u32> =
            orders.iter().fold(std::collections::HashMap::new(), |mut map, order| {
                *map.entry(order.to).or_insert(0) += order.count;
                map
            });

        let weather_ref = input.config.weather.as_deref();
        let incentives = compute_incentives(input, &surpluses, &deficits, &vehicle_inflow, weather_ref);

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
        let targets = vec![(StationId(0), 20), (StationId(1), 8), (StationId(2), 10)];
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
        let orders = greedy_assign(
            &mut surpluses,
            &deficits,
            &input.distance_matrix,
            15,
            15,
            false,
        );

        let total: u32 = orders.iter().map(|o| o.count).sum();
        // Deficit is 15, surplus available is 14+5=19, so all 15 should be covered.
        assert_eq!(total, 15);
    }

    #[test]
    fn test_peak_mode_respects_fleet_capacity() {
        let mut input = test_input();
        input.targets = vec![(StationId(0), 24), (StationId(1), 5), (StationId(2), 4)];
        input.vehicles = vec![DispatchVehicle {
            id: 1,
            capacity: 6,
            current_position: StationId(0),
        }];

        let (mut surpluses, deficits) = compute_gaps(&input);
        let orders = greedy_assign(
            &mut surpluses,
            &deficits,
            &input.distance_matrix,
            6,
            6,
            true,
        );

        assert_eq!(orders.iter().map(|o| o.count).sum::<u32>(), 6);
        assert!(orders.iter().all(|o| o.count <= 6));
    }

    #[test]
    fn test_peak_mode_prefers_higher_benefit_density() {
        let mut input = test_input();
        input.current_status = vec![
            StationStatus {
                station_id: StationId(0),
                available_bikes: 20,
                available_docks: 10,
                timestamp: Utc::now(),
            },
            StationStatus {
                station_id: StationId(1),
                available_bikes: 0,
                available_docks: 25,
                timestamp: Utc::now(),
            },
            StationStatus {
                station_id: StationId(2),
                available_bikes: 0,
                available_docks: 20,
                timestamp: Utc::now(),
            },
        ];
        input.targets = vec![(StationId(0), 0), (StationId(1), 5), (StationId(2), 10)];
        input.distance_matrix = vec![
            vec![0.0, 100.0, 2000.0],
            vec![100.0, 0.0, 2100.0],
            vec![2000.0, 2100.0, 0.0],
        ];
        input.vehicles = vec![DispatchVehicle {
            id: 1,
            capacity: 5,
            current_position: StationId(0),
        }];

        let (mut surpluses, deficits) = compute_gaps(&input);
        let orders = greedy_assign(
            &mut surpluses,
            &deficits,
            &input.distance_matrix,
            5,
            5,
            true,
        );

        // Coverage-first: both empty stations should receive bikes.
        // Station 1 (near, deficit 5) and Station 2 (far, deficit 10) both get coverage.
        assert_eq!(orders.len(), 2);
        let total: u32 = orders.iter().map(|o| o.count).sum();
        assert_eq!(total, 5);
        // Near station should get the first/larger share.
        assert!(orders.iter().any(|o| o.to == StationId(1)));
        assert!(orders.iter().any(|o| o.to == StationId(2)));
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
        input.targets = vec![(StationId(0), 5), (StationId(1), 22), (StationId(2), 15)];
        let solver = GreedyRebalanceSolver::new();
        let output = solver.solve(&input);
        assert_eq!(output.dispatch_plan.total_bikes_moved, 0);
    }

    #[test]
    fn test_solver_stages_idle_vehicle_toward_residual_hotspot() {
        let now = Utc::now();
        let input = RebalanceInput {
            stations: vec![
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
                    name: "Warehouse".into(),
                    category: StationCategory::AcademicBuilding,
                    capacity: 30,
                    latitude: 30.52,
                    longitude: 114.36,
                },
            ],
            current_status: vec![
                StationStatus {
                    station_id: StationId(0),
                    available_bikes: 0,
                    available_docks: 30,
                    timestamp: now,
                },
                StationStatus {
                    station_id: StationId(1),
                    available_bikes: 10,
                    available_docks: 20,
                    timestamp: now,
                },
            ],
            targets: vec![(StationId(0), 20), (StationId(1), 0)],
            distance_matrix: vec![vec![0.0, 500.0], vec![500.0, 0.0]],
            vehicles: vec![
                DispatchVehicle {
                    id: 1,
                    capacity: 10,
                    current_position: StationId(1),
                },
                DispatchVehicle {
                    id: 2,
                    capacity: 10,
                    current_position: StationId(1),
                },
            ],
            config: SystemConfig::default(),
        };

        let solver = GreedyRebalanceSolver::new();
        let output = solver.solve(&input);

        assert_eq!(output.dispatch_plan.total_bikes_moved, 10);
        assert_eq!(output.dispatch_plan.vehicle_routes.len(), 2);
        let staging_route = output
            .dispatch_plan
            .vehicle_routes
            .iter()
            .find(|route| route.stops.iter().all(|stop| stop.bike_count == 0))
            .expect("expected one staging-only route");
        assert_eq!(staging_route.stops.last().unwrap().station_id, StationId(0));
    }
}
