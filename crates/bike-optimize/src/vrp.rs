use bike_core::{DispatchVehicle, RouteStop, StationId, StopAction, SystemConfig, VehicleRoute};

use crate::greedy::MoveOrder;

const MAX_ROUTE_DURATION_MINUTES: f64 = 45.0;

// ── Congestion & weather-aware speed model ──

/// Base congestion coefficient (3 Gaussian peaks: 7:45 / 11:45 / 16:45)
fn base_congestion_coefficient(minute: u32) -> f64 {
    let peaks = [(465.0, 0.8, 0.15), (705.0, 0.7, 0.12), (1005.0, 0.9, 0.15)];
    let mut reduction = 0.0;
    for (center, sigma, depth) in &peaks {
        let dx = (minute as f64 - center) / (sigma * 60.0);
        reduction += depth * (-0.5 * dx * dx).exp();
    }
    1.0 - reduction
}

/// Campus vehicle congestion coefficient (base + 5 class-change peaks)
fn campus_vehicle_congestion(minute: u32) -> f64 {
    let base = base_congestion_coefficient(minute);
    let class_peaks = [
        (470.0, 0.3, 0.12),
        (590.0, 0.2, 0.08),
        (710.0, 0.3, 0.10),
        (830.0, 0.2, 0.08),
        (1020.0, 0.3, 0.10),
    ];
    let mut extra = 0.0;
    for (center, sigma, depth) in &class_peaks {
        let dx = (minute as f64 - center) / (sigma * 60.0);
        extra += depth * (-0.5 * dx * dx).exp();
    }
    (base - extra).max(0.4)
}

/// Weather impact on vehicle speed
fn vehicle_weather_speed_factor(weather: Option<&str>) -> f64 {
    match weather {
        Some("storm") => 0.7 * 0.85,       // ~0.595
        Some("rain") => 0.85 * 0.92,        // ~0.782
        Some("cold_front") => 0.92,
        _ => 1.0,
    }
}

/// Effective vehicle speed (m/s) considering congestion + weather
pub(crate) fn effective_vehicle_speed(config: &SystemConfig) -> f64 {
    let weather = vehicle_weather_speed_factor(config.weather.as_deref());
    let congestion = config
        .current_slot_index
        .map(|s| campus_vehicle_congestion(s.min(1439)))
        .unwrap_or(1.0);
    5.0 * weather * congestion
}

/// Variable load/unload time: each successive bike takes slightly longer
fn variable_load_unload_minutes(bike_count: u32) -> f64 {
    let mut total_s = 0.0;
    for i in 1..=bike_count {
        total_s += 15.0 + (i - 1).min(10) as f64;
    }
    total_s / 60.0
}

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
    config: &SystemConfig,
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
            let route = build_single_route(vehicle, &stops, distance_matrix, config);
            routes.push(route);
        }
    }

    // ── Max route duration constraint: trim routes, reassign orphaned stops ──
    let max_dur = config.max_route_duration_minutes.max(MAX_ROUTE_DURATION_MINUTES.min(config.max_route_duration_minutes));
    let mut orphaned_stops: Vec<RouteStop> = Vec::new();
    for route in &mut routes {
        if route.estimated_duration_minutes > max_dur && route.stops.len() > 2 {
            while route.estimated_duration_minutes > max_dur && route.stops.len() > 2 {
                if let Some(removed) = route.stops.pop() {
                    orphaned_stops.push(removed);
                }
                let (dist, dur) = recalculate_route_metrics(&route.stops, distance_matrix, config);
                route.total_distance_meters = dist;
                route.estimated_duration_minutes = dur;
            }
        }
    }

    // Try to reassign orphaned stops to routes with remaining time budget
    for orphan in orphaned_stops {
        let orphan_idx = orphan.station_id.0 as usize;
        let mut best_route: Option<(usize, f64)> = None;
        for (ri, route) in routes.iter().enumerate() {
            let last_idx = route.stops.last()
                .map(|s| s.station_id.0 as usize)
                .unwrap_or(0);
            let extra_dist = distance_matrix
                .get(last_idx)
                .and_then(|row| row.get(orphan_idx))
                .copied()
                .unwrap_or(f64::MAX);
            let speed = effective_vehicle_speed(config);
            let extra_travel = (extra_dist / speed) / 60.0;
            let extra_service = variable_load_unload_minutes(orphan.bike_count);
            let new_dur = route.estimated_duration_minutes + extra_travel + extra_service;
            if new_dur <= max_dur {
                let cost = extra_dist;
                if best_route.as_ref().map_or(true, |(_, bc)| cost < *bc) {
                    best_route = Some((ri, cost));
                }
            }
        }
        if let Some((ri, _)) = best_route {
            routes[ri].stops.push(orphan);
            let (dist, dur) = recalculate_route_metrics(&routes[ri].stops, distance_matrix, config);
            routes[ri].total_distance_meters = dist;
            routes[ri].estimated_duration_minutes = dur;
        }
        // If no route can fit it, the stop is truly dropped
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
            let (ld, lt) = recalculate_route_metrics(&routes[longest_idx].stops, distance_matrix, config);
            routes[longest_idx].total_distance_meters = ld;
            routes[longest_idx].estimated_duration_minutes = lt;

            routes[shortest_idx].stops.push(moved_stop);
            let (sd, st) = recalculate_route_metrics(&routes[shortest_idx].stops, distance_matrix, config);
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
                let (ld2, lt2) = recalculate_route_metrics(&routes[longest_idx].stops, distance_matrix, config);
                routes[longest_idx].total_distance_meters = ld2;
                routes[longest_idx].estimated_duration_minutes = lt2;
                let (sd2, st2) = recalculate_route_metrics(&routes[shortest_idx].stops, distance_matrix, config);
                routes[shortest_idx].total_distance_meters = sd2;
                routes[shortest_idx].estimated_duration_minutes = st2;
            }
        }
    }

    routes
}

/// Build a single vehicle route using constrained nearest-neighbor with interleaved pickup/dropoff + 2-opt.
fn build_single_route(
    vehicle: &DispatchVehicle,
    stops: &[VrpStop],
    distance_matrix: &[Vec<f64>],
    config: &SystemConfig,
) -> VehicleRoute {
    let depot_index = vehicle
        .current_position
        .0
        .min(distance_matrix.len().saturating_sub(1) as u32) as usize;

    // Constrained nearest-neighbor: interleave pickups and dropoffs
    let mut visited = vec![false; stops.len()];
    let mut ordered_indices: Vec<usize> = Vec::with_capacity(stops.len());
    let mut current_load: u32 = 0;
    let mut current_pos = depot_index;

    for _ in 0..stops.len() {
        let mut best_idx: Option<usize> = None;
        let mut best_dist = f64::MAX;

        for (i, stop) in stops.iter().enumerate() {
            if visited[i] {
                continue;
            }
            // Feasibility check
            let feasible = match stop.action {
                StopAction::Pickup => current_load + stop.bike_count <= vehicle.capacity,
                StopAction::Dropoff => current_load >= stop.bike_count,
            };
            if !feasible {
                continue;
            }
            let dist = distance_matrix
                .get(current_pos)
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
            match stops[idx].action {
                StopAction::Pickup => current_load += stops[idx].bike_count,
                StopAction::Dropoff => current_load -= stops[idx].bike_count,
            }
            current_pos = stops[idx].station_index;
            ordered_indices.push(idx);
        } else {
            // No feasible stop found — add remaining unvisited stops in distance order
            // (they'll be clamped during load tracking below)
            let mut remaining: Vec<(usize, f64)> = stops.iter().enumerate()
                .filter(|(i, _)| !visited[*i])
                .map(|(i, s)| {
                    let d = distance_matrix.get(current_pos)
                        .and_then(|row| row.get(s.station_index))
                        .copied()
                        .unwrap_or(f64::MAX);
                    (i, d)
                })
                .collect();
            remaining.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
            for (i, _) in remaining {
                visited[i] = true;
                ordered_indices.push(i);
            }
            break;
        }
    }

    let ordered_stops: Vec<&VrpStop> = ordered_indices.iter().map(|&i| &stops[i]).collect();

    // 2-opt improvement with load feasibility validation
    let ordered_stops = two_opt_improve_with_load_check(ordered_stops, depot_index, vehicle.capacity, distance_matrix);

    // Build route stops with load tracking
    let mut route_stops = Vec::new();
    let mut current_load: u32 = 0;
    let mut total_distance = 0.0;
    let mut prev_index = depot_index;

    for stop in &ordered_stops {
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

    let avg_speed_mps = effective_vehicle_speed(config);
    let total_service_minutes: f64 = route_stops
        .iter()
        .map(|s| variable_load_unload_minutes(s.bike_count))
        .sum();
    let estimated_minutes = (total_distance / avg_speed_mps) / 60.0 + total_service_minutes;

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
fn recalculate_route_metrics(stops: &[RouteStop], distance_matrix: &[Vec<f64>], config: &SystemConfig) -> (f64, f64) {
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
    let avg_speed_mps = effective_vehicle_speed(config);
    let total_service_minutes: f64 = stops
        .iter()
        .map(|s| variable_load_unload_minutes(s.bike_count))
        .sum();
    let estimated_minutes = (total_distance / avg_speed_mps) / 60.0 + total_service_minutes;
    (total_distance, estimated_minutes)
}

/// 2-opt with load feasibility validation: after each swap, verify the entire
/// route respects capacity constraints. Revert if infeasible.
fn two_opt_improve_with_load_check<'a>(
    mut route: Vec<&'a VrpStop>,
    depot: usize,
    capacity: u32,
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

    let is_load_feasible = |r: &[&VrpStop]| -> bool {
        let mut load: u32 = 0;
        for s in r {
            match s.action {
                StopAction::Pickup => {
                    if load + s.bike_count > capacity {
                        return false;
                    }
                    load += s.bike_count;
                }
                StopAction::Dropoff => {
                    if load < s.bike_count {
                        return false;
                    }
                    load -= s.bike_count;
                }
            }
        }
        true
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
                if is_load_feasible(&route) {
                    let new_dist = total_dist(&route);
                    if new_dist < best_dist {
                        best_dist = new_dist;
                        improved = true;
                    } else {
                        route[i..=j].reverse(); // undo — no distance improvement
                    }
                } else {
                    route[i..=j].reverse(); // undo — infeasible
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

    fn default_config() -> SystemConfig {
        SystemConfig::default()
    }

    #[test]
    fn test_empty_orders() {
        let routes = optimize_routes(&[], &[], &[], &default_config());
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
        let routes = optimize_routes(&orders, &vehicles, &dm, &default_config());
        assert_eq!(routes.len(), 1);
        assert_eq!(routes[0].stops.len(), 2);
    }

    #[test]
    fn test_multi_vehicle_balanced() {
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
        let routes = optimize_routes(&orders, &vehicles, &dm, &default_config());
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

        let routes = optimize_routes(&orders, &vehicles, &dm, &default_config());

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

        let routes = optimize_routes(&orders, &vehicles, &dm, &default_config());

        assert_eq!(routes.len(), 1);
        assert_eq!(routes[0].vehicle_id, 2);
    }

    #[test]
    fn test_congestion_speed_model() {
        // At peak congestion (slot 470 = ~7:50 AM), speed should be significantly lower
        let mut config = SystemConfig::default();
        config.current_slot_index = Some(470);
        let peak_speed = effective_vehicle_speed(&config);

        // At off-peak (slot 180 = 3:00 AM), speed should be near base
        config.current_slot_index = Some(180);
        let offpeak_speed = effective_vehicle_speed(&config);

        assert!(peak_speed < offpeak_speed, "peak speed {peak_speed} should be < off-peak {offpeak_speed}");
        assert!(peak_speed > 1.0, "peak speed should still be > 1 m/s");
        assert!((offpeak_speed - 5.0).abs() < 0.5, "off-peak speed should be near 5 m/s");
    }

    #[test]
    fn test_weather_speed_factor() {
        let mut config = SystemConfig::default();
        let base_speed = effective_vehicle_speed(&config);

        config.weather = Some("storm".into());
        let storm_speed = effective_vehicle_speed(&config);

        config.weather = Some("rain".into());
        let rain_speed = effective_vehicle_speed(&config);

        assert!(storm_speed < rain_speed, "storm should be slower than rain");
        assert!(rain_speed < base_speed, "rain should be slower than clear");
    }

    #[test]
    fn test_variable_load_unload() {
        let t1 = variable_load_unload_minutes(1);
        let t5 = variable_load_unload_minutes(5);
        let t10 = variable_load_unload_minutes(10);
        assert!(t1 < t5, "more bikes should take longer");
        assert!(t5 < t10, "more bikes should take longer");
        assert!(t1 > 0.0);
    }
}
