use bike_core::{DispatchVehicle, RouteStop, StationId, StopAction, VehicleRoute};

use crate::greedy::MoveOrder;

const MAX_ROUTE_DURATION_MINUTES: f64 = 45.0;

/// A stop to visit: either pick up or drop off bikes.
#[derive(Debug, Clone)]
struct VrpStop {
    station_index: usize,
    station_id: StationId,
    action: StopAction,
    bike_count: u32,
}

/// Build VehicleRoutes from move orders.
///
/// Algorithm:
/// 1. Flatten orders into pickup/dropoff stops.
/// 2. Assign move orders (not individual stops) to vehicles by capacity, so each
///    vehicle gets matched pickup-dropoff pairs.
/// 3. For each vehicle: nearest-neighbor route construction + 2-opt improvement.
pub(crate) fn optimize_routes(
    orders: &[MoveOrder],
    vehicles: &[DispatchVehicle],
    distance_matrix: &[Vec<f64>],
) -> Vec<VehicleRoute> {
    if orders.is_empty() || vehicles.is_empty() {
        return Vec::new();
    }

    // Distribute move orders across vehicles by capacity.
    // Each order carries both its pickup and dropoff, keeping them paired.
    let mut vehicle_orders: Vec<Vec<&MoveOrder>> = vec![Vec::new(); vehicles.len()];
    let mut vehicle_load: Vec<u32> = vec![0; vehicles.len()];

    // Sort orders by count descending (largest first for better bin-packing).
    let mut sorted_orders: Vec<&MoveOrder> = orders.iter().collect();
    sorted_orders.sort_by(|a, b| b.count.cmp(&a.count));

    for order in &sorted_orders {
        let best_vi = vehicle_load
            .iter()
            .enumerate()
            .filter_map(|(vi, &load)| {
                let capacity = vehicles[vi].capacity;
                if load + order.count > capacity {
                    return None;
                }
                let start_index = vehicles[vi]
                    .current_position
                    .0
                    .min(distance_matrix.len().saturating_sub(1) as u32)
                    as usize;
                let deadhead = distance_matrix
                    .get(start_index)
                    .and_then(|row| row.get(order.from_index))
                    .copied()
                    .unwrap_or(f64::MAX);
                Some((vi, deadhead, capacity - (load + order.count)))
            })
            .min_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal).then_with(|| a.2.cmp(&b.2)))
            .map(|(vi, _, _)| vi);

        if let Some(best_vi) = best_vi {
            vehicle_orders[best_vi].push(order);
            vehicle_load[best_vi] += order.count;
        }
    }

    let mut routes = Vec::new();
    for (vi, v_orders) in vehicle_orders.iter().enumerate() {
        if v_orders.is_empty() {
            continue;
        }
        let vehicle = &vehicles[vi];

        // Build stops from this vehicle's orders.
        let mut net_map: std::collections::HashMap<(StationId, usize), i32> =
            std::collections::HashMap::new();
        for o in v_orders {
            *net_map.entry((o.from, o.from_index)).or_insert(0) += o.count as i32;
            *net_map.entry((o.to, o.to_index)).or_insert(0) -= o.count as i32;
        }

        let mut stops: Vec<VrpStop> = Vec::new();
        for ((station_id, station_index), net) in &net_map {
            if *net > 0 {
                stops.push(VrpStop {
                    station_index: *station_index,
                    station_id: *station_id,
                    action: StopAction::Pickup,
                    bike_count: *net as u32,
                });
            } else if *net < 0 {
                stops.push(VrpStop {
                    station_index: *station_index,
                    station_id: *station_id,
                    action: StopAction::Dropoff,
                    bike_count: (-*net) as u32,
                });
            }
        }

        if !stops.is_empty() {
            let route = build_single_route(vehicle, &stops, distance_matrix);
            routes.push(route);
        }
    }

    // ── Max route duration constraint: trim routes that exceed the limit ──
    for route in &mut routes {
        if route.estimated_duration_minutes > MAX_ROUTE_DURATION_MINUTES && route.stops.len() > 2 {
            while route.estimated_duration_minutes > MAX_ROUTE_DURATION_MINUTES && route.stops.len() > 2 {
                route.stops.pop();
                // Recalculate distance and duration from remaining stops
                let (dist, dur) = recalculate_route_metrics(&route.stops, distance_matrix);
                route.total_distance_meters = dist;
                route.estimated_duration_minutes = dur;
            }
        }
    }

    // ── Route duration balancing ──
    // If the longest route is more than 2x the shortest, move the last stop
    // from the longest to the shortest (only if it improves balance).
    if routes.len() >= 2 {
        let (longest_idx, shortest_idx) = {
            let mut longest = 0;
            let mut shortest = 0;
            for (i, route) in routes.iter().enumerate() {
                if route.estimated_duration_minutes > routes[longest].estimated_duration_minutes {
                    longest = i;
                }
                if route.estimated_duration_minutes < routes[shortest].estimated_duration_minutes {
                    shortest = i;
                }
            }
            (longest, shortest)
        };

        if longest_idx != shortest_idx
            && routes[longest_idx].estimated_duration_minutes
                > 2.0 * routes[shortest_idx].estimated_duration_minutes
            && routes[longest_idx].stops.len() > 1
        {
            let old_longest_dur = routes[longest_idx].estimated_duration_minutes;
            let old_shortest_dur = routes[shortest_idx].estimated_duration_minutes;
            let old_ratio = old_longest_dur / old_shortest_dur.max(0.01);

            let moved_stop = routes[longest_idx].stops.pop().unwrap();
            let (ld, lt) = recalculate_route_metrics(&routes[longest_idx].stops, distance_matrix);
            routes[longest_idx].total_distance_meters = ld;
            routes[longest_idx].estimated_duration_minutes = lt;

            routes[shortest_idx].stops.push(moved_stop);
            let (sd, st) = recalculate_route_metrics(&routes[shortest_idx].stops, distance_matrix);
            routes[shortest_idx].total_distance_meters = sd;
            routes[shortest_idx].estimated_duration_minutes = st;

            let new_longest_dur = routes[longest_idx].estimated_duration_minutes
                .max(routes[shortest_idx].estimated_duration_minutes);
            let new_shortest_dur = routes[longest_idx].estimated_duration_minutes
                .min(routes[shortest_idx].estimated_duration_minutes);
            let new_ratio = new_longest_dur / new_shortest_dur.max(0.01);

            // Revert if balance didn't improve
            if new_ratio >= old_ratio {
                let moved_back = routes[shortest_idx].stops.pop().unwrap();
                routes[longest_idx].stops.push(moved_back);
                let (ld2, lt2) = recalculate_route_metrics(&routes[longest_idx].stops, distance_matrix);
                routes[longest_idx].total_distance_meters = ld2;
                routes[longest_idx].estimated_duration_minutes = lt2;
                let (sd2, st2) = recalculate_route_metrics(&routes[shortest_idx].stops, distance_matrix);
                routes[shortest_idx].total_distance_meters = sd2;
                routes[shortest_idx].estimated_duration_minutes = st2;
            }
        }
    }

    routes
}

/// Build a single vehicle route using nearest-neighbor + 2-opt.
fn build_single_route(
    vehicle: &DispatchVehicle,
    stops: &[VrpStop],
    distance_matrix: &[Vec<f64>],
) -> VehicleRoute {
    // Separate pickups and dropoffs. Visit all pickups first, then dropoffs.
    let mut pickups: Vec<&VrpStop> = stops
        .iter()
        .filter(|s| matches!(s.action, StopAction::Pickup))
        .collect();
    let mut dropoffs: Vec<&VrpStop> = stops
        .iter()
        .filter(|s| matches!(s.action, StopAction::Dropoff))
        .collect();

    let depot_index = vehicle
        .current_position
        .0
        .min(distance_matrix.len().saturating_sub(1) as u32) as usize;

    nearest_neighbor_sort(&mut pickups, depot_index, distance_matrix);
    let last_pickup_idx = pickups
        .last()
        .map(|s| s.station_index)
        .unwrap_or(depot_index);
    nearest_neighbor_sort(&mut dropoffs, last_pickup_idx, distance_matrix);

    // Apply 2-opt within each phase separately to preserve pickup-before-dropoff constraint.
    let pickups = two_opt_improve(pickups, depot_index, distance_matrix);
    let last_pickup_idx2 = pickups
        .last()
        .map(|s| s.station_index)
        .unwrap_or(depot_index);
    let dropoffs = two_opt_improve(dropoffs, last_pickup_idx2, distance_matrix);

    // Combine: pickups first, then dropoffs.
    let ordered: Vec<&VrpStop> = pickups.iter().chain(dropoffs.iter()).copied().collect();

    // Build route stops with load tracking.
    let mut route_stops = Vec::new();
    let mut current_load: u32 = 0;
    let mut total_distance = 0.0;
    let mut prev_index = depot_index;

    for stop in &ordered {
        let dist = distance_matrix
            .get(prev_index)
            .and_then(|row| row.get(stop.station_index))
            .copied()
            .unwrap_or(0.0);
        total_distance += dist;

        match stop.action {
            StopAction::Pickup => {
                let take = stop.bike_count.min(vehicle.capacity - current_load);
                current_load += take;
                route_stops.push(RouteStop {
                    station_id: stop.station_id,
                    action: StopAction::Pickup,
                    bike_count: take,
                    load_after: current_load,
                });
            }
            StopAction::Dropoff => {
                let drop = stop.bike_count.min(current_load);
                current_load -= drop;
                route_stops.push(RouteStop {
                    station_id: stop.station_id,
                    action: StopAction::Dropoff,
                    bike_count: drop,
                    load_after: current_load,
                });
            }
        }
        prev_index = stop.station_index;
    }

    let avg_speed_mps = 5.0; // ~18 km/h campus vehicle
    let service_time_per_stop_minutes = 2.0; // 2 minutes per stop for positioning
    let estimated_minutes = (total_distance / avg_speed_mps) / 60.0
        + route_stops.len() as f64 * service_time_per_stop_minutes;

    VehicleRoute {
        vehicle_id: vehicle.id,
        capacity: vehicle.capacity,
        stops: route_stops,
        total_distance_meters: total_distance,
        estimated_duration_minutes: estimated_minutes,
    }
}

/// Recalculate total distance and estimated duration from a list of RouteStops.
/// Uses station_id.0 as the station index for distance_matrix lookups.
fn recalculate_route_metrics(stops: &[RouteStop], distance_matrix: &[Vec<f64>]) -> (f64, f64) {
    let mut total_distance = 0.0;
    let mut prev_index: Option<usize> = None;
    for stop in stops {
        let idx = stop.station_id.0 as usize;
        if let Some(prev) = prev_index {
            total_distance += distance_matrix
                .get(prev)
                .and_then(|row| row.get(idx))
                .copied()
                .unwrap_or(0.0);
        }
        prev_index = Some(idx);
    }
    let avg_speed_mps = 5.0;
    let service_time_per_stop_minutes = 2.0;
    let estimated_minutes = (total_distance / avg_speed_mps) / 60.0
        + stops.len() as f64 * service_time_per_stop_minutes;
    (total_distance, estimated_minutes)
}

/// Sort stops in-place using nearest-neighbor heuristic.
fn nearest_neighbor_sort(stops: &mut Vec<&VrpStop>, start: usize, dm: &[Vec<f64>]) {
    if stops.len() <= 1 {
        return;
    }
    let mut ordered = Vec::with_capacity(stops.len());
    let mut visited = vec![false; stops.len()];
    let mut current = start;

    for _ in 0..stops.len() {
        let mut best_idx = None;
        let mut best_dist = f64::MAX;
        for (i, stop) in stops.iter().enumerate() {
            if visited[i] {
                continue;
            }
            let dist = dm
                .get(current)
                .and_then(|row| row.get(stop.station_index))
                .copied()
                .unwrap_or(f64::MAX);
            if dist < best_dist {
                best_dist = dist;
                best_idx = Some(i);
            }
        }
        if let Some(idx) = best_idx {
            visited[idx] = true;
            current = stops[idx].station_index;
            ordered.push(idx);
        }
    }

    let original: Vec<&VrpStop> = stops.clone();
    for (i, &orig_idx) in ordered.iter().enumerate() {
        stops[i] = original[orig_idx];
    }
}

/// 2-opt local improvement with iteration cap for large-scale scenarios.
fn two_opt_improve<'a>(
    mut route: Vec<&'a VrpStop>,
    depot: usize,
    dm: &[Vec<f64>],
) -> Vec<&'a VrpStop> {
    if route.len() <= 2 {
        return route;
    }

    let total_dist = |r: &[&VrpStop]| -> f64 {
        let mut d = 0.0;
        let mut prev = depot;
        for s in r {
            d += dm
                .get(prev)
                .and_then(|row| row.get(s.station_index))
                .copied()
                .unwrap_or(0.0);
            prev = s.station_index;
        }
        d
    };

    let mut improved = true;
    let mut iterations = 0;
    const MAX_ITERATIONS: usize = 50;
    let mut best_dist = total_dist(&route);
    while improved && iterations < MAX_ITERATIONS {
        improved = false;
        iterations += 1;
        let n = route.len();
        for i in 0..n.saturating_sub(1) {
            for j in (i + 1)..n {
                route[i..=j].reverse();
                let new_dist = total_dist(&route);
                if new_dist < best_dist {
                    best_dist = new_dist;
                    improved = true;
                } else {
                    route[i..=j].reverse(); // undo
                }
            }
        }
    }

    route
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::greedy::MoveOrder;

    #[test]
    fn test_empty_orders() {
        let routes = optimize_routes(&[], &[], &[]);
        assert!(routes.is_empty());
    }

    #[test]
    fn test_single_move() {
        let orders = vec![MoveOrder {
            from: StationId(1),
            from_index: 1,
            to: StationId(0),
            to_index: 0,
            count: 10,
        }];
        let vehicles = vec![DispatchVehicle {
            id: 1,
            capacity: 15,
            current_position: StationId(0),
        }];
        let dm = vec![vec![0.0, 500.0], vec![500.0, 0.0]];
        let routes = optimize_routes(&orders, &vehicles, &dm);
        assert_eq!(routes.len(), 1);
        assert_eq!(routes[0].stops.len(), 2);
    }

    #[test]
    fn test_multi_vehicle_balanced() {
        // Two move orders, two vehicles.
        let orders = vec![
            MoveOrder {
                from: StationId(1),
                from_index: 1,
                to: StationId(0),
                to_index: 0,
                count: 10,
            },
            MoveOrder {
                from: StationId(2),
                from_index: 2,
                to: StationId(0),
                to_index: 0,
                count: 8,
            },
        ];
        let vehicles = vec![
            DispatchVehicle {
                id: 1,
                capacity: 15,
                current_position: StationId(0),
            },
            DispatchVehicle {
                id: 2,
                capacity: 15,
                current_position: StationId(0),
            },
        ];
        let dm = vec![
            vec![0.0, 500.0, 800.0],
            vec![500.0, 0.0, 600.0],
            vec![800.0, 600.0, 0.0],
        ];
        let routes = optimize_routes(&orders, &vehicles, &dm);
        // Each vehicle should have both pickup and dropoff.
        for route in &routes {
            let has_pickup = route
                .stops
                .iter()
                .any(|s| matches!(s.action, StopAction::Pickup));
            let has_dropoff = route
                .stops
                .iter()
                .any(|s| matches!(s.action, StopAction::Dropoff));
            assert!(has_pickup, "vehicle {} missing pickup", route.vehicle_id);
            assert!(has_dropoff, "vehicle {} missing dropoff", route.vehicle_id);
        }
    }

    #[test]
    fn test_vehicle_capacity_is_not_exceeded() {
        let orders = vec![
            MoveOrder {
                from: StationId(1),
                from_index: 1,
                to: StationId(0),
                to_index: 0,
                count: 9,
            },
            MoveOrder {
                from: StationId(2),
                from_index: 2,
                to: StationId(0),
                to_index: 0,
                count: 8,
            },
        ];
        let vehicles = vec![DispatchVehicle {
            id: 1,
            capacity: 10,
            current_position: StationId(0),
        }];
        let dm = vec![
            vec![0.0, 500.0, 800.0],
            vec![500.0, 0.0, 600.0],
            vec![800.0, 600.0, 0.0],
        ];

        let routes = optimize_routes(&orders, &vehicles, &dm);

        assert_eq!(routes.len(), 1);
        let moved: u32 = routes[0]
            .stops
            .iter()
            .filter(|s| matches!(s.action, StopAction::Pickup))
            .map(|s| s.bike_count)
            .sum();
        assert!(moved <= 10);
    }

    #[test]
    fn test_assignment_prefers_nearest_vehicle_start() {
        let orders = vec![MoveOrder {
            from: StationId(2),
            from_index: 2,
            to: StationId(0),
            to_index: 0,
            count: 6,
        }];
        let vehicles = vec![
            DispatchVehicle {
                id: 1,
                capacity: 10,
                current_position: StationId(1),
            },
            DispatchVehicle {
                id: 2,
                capacity: 10,
                current_position: StationId(2),
            },
        ];
        let dm = vec![
            vec![0.0, 500.0, 800.0],
            vec![500.0, 0.0, 300.0],
            vec![800.0, 300.0, 0.0],
        ];

        let routes = optimize_routes(&orders, &vehicles, &dm);

        assert_eq!(routes.len(), 1);
        assert_eq!(routes[0].vehicle_id, 2);
    }
}
