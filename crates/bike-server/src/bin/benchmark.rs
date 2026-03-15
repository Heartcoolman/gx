//! Benchmark: compare simulation with and without dispatch optimization.
//!
//! Simulates a weekday with synthetic demand patterns, runs two phases:
//! 1. Baseline (no dispatch) — bikes redistribute only through rider trips
//! 2. Optimized (with dispatch) — solver rebalances every 15 minutes
//!
//! Usage: cargo run --release --bin benchmark

use bike_core::*;
use bike_optimize::{GreedyRebalanceSolver, RebalanceSolver};
use bike_predict::{CompositePredictor, DemandPredictor};
use chrono::Utc;
use rand::prelude::*;
use rand::rngs::StdRng;

const NUM_STATIONS: usize = 15;
const TOTAL_BIKES: u32 = 800;
const SLOTS_PER_DAY: u32 = 1440;
const REBALANCE_INTERVAL: u32 = 15;
const NUM_VEHICLES: u32 = 5;
const VEHICLE_CAPACITY: u32 = 20;

// ── Station definitions (mirrors frontend) ──

fn build_stations() -> Vec<Station> {
    let data: Vec<(&str, StationCategory, u32, f64, f64)> = vec![
        ("东区宿舍A", StationCategory::Dormitory, 200, 28.7838, 115.8590),
        ("东区宿舍B", StationCategory::Dormitory, 200, 28.7843, 115.8615),
        ("西区宿舍A", StationCategory::Dormitory, 200, 28.7840, 115.8545),
        ("西区宿舍B", StationCategory::Dormitory, 200, 28.7835, 115.8520),
        ("第一教学楼", StationCategory::AcademicBuilding, 150, 28.7885, 115.8560),
        ("第二教学楼", StationCategory::AcademicBuilding, 150, 28.7890, 115.8590),
        ("实验楼", StationCategory::AcademicBuilding, 150, 28.7895, 115.8540),
        ("实训中心", StationCategory::AcademicBuilding, 150, 28.7900, 115.8620),
        ("第一食堂", StationCategory::Cafeteria, 120, 28.7860, 115.8555),
        ("第二食堂", StationCategory::Cafeteria, 120, 28.7862, 115.8600),
        ("图书馆", StationCategory::Library, 100, 28.7875, 115.8578),
        ("体育馆", StationCategory::SportsField, 80, 28.7870, 115.8505),
        ("运动场", StationCategory::SportsField, 80, 28.7880, 115.8498),
        ("南大门", StationCategory::MainGate, 80, 28.7825, 115.8575),
        ("北大门", StationCategory::MainGate, 80, 28.7922, 115.8580),
    ];
    data.into_iter()
        .enumerate()
        .map(|(i, (name, cat, cap, lat, lon))| Station {
            id: StationId(i as u32),
            name: name.into(),
            category: cat,
            capacity: cap,
            latitude: lat,
            longitude: lon,
        })
        .collect()
}
// PLACEHOLDER_CONTINUE2

fn haversine(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let r = 6371000.0;
    let d_lat = (lat2 - lat1).to_radians();
    let d_lon = (lon2 - lon1).to_radians();
    let a = (d_lat / 2.0).sin().powi(2)
        + lat1.to_radians().cos() * lat2.to_radians().cos() * (d_lon / 2.0).sin().powi(2);
    r * 2.0 * a.sqrt().asin()
}

fn build_distance_matrix(stations: &[Station]) -> Vec<Vec<f64>> {
    stations
        .iter()
        .map(|a| {
            stations
                .iter()
                .map(|b| haversine(a.latitude, a.longitude, b.latitude, b.longitude))
                .collect()
        })
        .collect()
}

/// Demand pattern: Gaussian peaks for class times
fn demand_rate(slot: u32) -> f64 {
    let peaks = [
        (480.0_f64, 30.0, 1.0),   // 8:00 morning rush
        (540.0, 20.0, 0.4),        // 9:00 late arrivals
        (690.0, 25.0, 0.7),        // 11:30 lunch
        (780.0, 25.0, 0.6),        // 13:00 afternoon start
        (840.0, 20.0, 0.3),        // 14:00
        (1020.0, 30.0, 0.8),       // 17:00 evening rush
        (1110.0, 25.0, 0.4),       // 18:30 dinner
    ];
    let mut rate = 0.05; // base rate
    for (center, sigma, amplitude) in &peaks {
        let dx = (slot as f64 - center) / sigma;
        rate += amplitude * (-0.5 * dx * dx).exp();
    }
    rate
}

/// Generate origin-destination based on time of day
fn pick_od(slot: u32, rng: &mut StdRng, n: usize) -> (usize, usize) {
    // Morning: dorm -> academic/cafeteria
    // Lunch: academic -> cafeteria
    // Evening: academic -> dorm
    let dorms = [0, 1, 2, 3];
    let academics = [4, 5, 6, 7];
    let cafeterias = [8, 9];
    let all: Vec<usize> = (0..n).collect();

    let (origins, destinations): (&[usize], &[usize]) = if slot < 600 {
        (&dorms, &academics)
    } else if slot < 750 {
        (&academics, &cafeterias)
    } else if slot < 900 {
        (&cafeterias, &academics)
    } else if slot < 1080 {
        (&academics, &dorms)
    } else {
        (&all, &all)
    };

    let o = origins[rng.gen_range(0..origins.len())];
    let mut d = destinations[rng.gen_range(0..destinations.len())];
    if d == o {
        d = (d + 1) % n;
    }
    (o, d)
}

struct SimState {
    bikes: Vec<u32>,       // available bikes per station
    capacities: Vec<u32>,
    served: u32,
    blocked: u32,
}

impl SimState {
    fn new(stations: &[Station], total_bikes: u32) -> Self {
        let n = stations.len();
        let cap: Vec<u32> = stations.iter().map(|s| s.capacity).collect();
        let total_cap: u32 = cap.iter().sum();
        let mut bikes = vec![0u32; n];
        let mut remaining = total_bikes;
        for i in 0..n {
            let share = ((cap[i] as f64 / total_cap as f64) * total_bikes as f64).round() as u32;
            bikes[i] = share.min(cap[i]).min(remaining);
            remaining -= bikes[i];
        }
        // Distribute remainder
        for i in 0..n {
            if remaining == 0 { break; }
            let space = cap[i] - bikes[i];
            if space > 0 {
                bikes[i] += 1;
                remaining -= 1;
            }
        }
        SimState { bikes, capacities: cap, served: 0, blocked: 0 }
    }

    fn try_ride(&mut self, from: usize, to: usize) -> bool {
        if self.bikes[from] == 0 {
            self.blocked += 1;
            return false;
        }
        if self.bikes[to] >= self.capacities[to] {
            // Destination full — still count as blocked
            self.blocked += 1;
            return false;
        }
        self.bikes[from] -= 1;
        self.bikes[to] += 1;
        self.served += 1;
        true
    }

    fn apply_dispatch(&mut self, plan: &DispatchPlan) {
        for route in &plan.vehicle_routes {
            let mut load = 0u32;
            for stop in &route.stops {
                let sid = stop.station_id.0 as usize;
                match stop.action {
                    StopAction::Pickup => {
                        let take = stop.bike_count.min(self.bikes[sid]);
                        self.bikes[sid] -= take;
                        load += take;
                    }
                    StopAction::Dropoff => {
                        let space = self.capacities[sid] - self.bikes[sid];
                        let drop = stop.bike_count.min(load).min(space);
                        self.bikes[sid] += drop;
                        load -= drop;
                    }
                }
            }
        }
    }

    fn block_rate(&self) -> f64 {
        let total = self.served + self.blocked;
        if total == 0 { 0.0 } else { self.blocked as f64 / total as f64 }
    }

    fn satisfaction_rate(&self) -> f64 {
        1.0 - self.block_rate()
    }

    fn bike_std_dev(&self) -> f64 {
        let n = self.bikes.len() as f64;
        let fill_ratios: Vec<f64> = self.bikes.iter().zip(&self.capacities)
            .map(|(b, c)| *b as f64 / *c as f64)
            .collect();
        let mean: f64 = fill_ratios.iter().sum::<f64>() / n;
        let var: f64 = fill_ratios.iter().map(|r| (r - mean).powi(2)).sum::<f64>() / n;
        var.sqrt()
    }
}

fn run_phase(
    stations: &[Station],
    dm: &[Vec<f64>],
    dispatch_enabled: bool,
    seed: u64,
) -> (SimState, u32) {
    let mut rng = StdRng::seed_from_u64(seed);
    let mut state = SimState::new(stations, TOTAL_BIKES);
    let mut predictor = CompositePredictor::new(0.35);
    let solver = GreedyRebalanceSolver::new();
    let mut total_bikes_moved: u32 = 0;
    let mut dispatch_count: u32 = 0;
    let now = Utc::now();
    let day_kind = DayKind::Weekday;

    // Warmup predictor with synthetic demand
    if dispatch_enabled {
        let mut warmup_rng = StdRng::seed_from_u64(seed + 1000);
        for _pass in 0..3 {
            for slot in 0..SLOTS_PER_DAY {
                let rate = demand_rate(slot);
                let n_rides = (rate * 12.0) as u32;
                for _ in 0..n_rides {
                    let (o, d) = pick_od(slot, &mut warmup_rng, stations.len());
                    let departure = now + chrono::Duration::minutes(slot as i64);
                    let arrival = departure + chrono::Duration::minutes(5);
                    predictor.observe(&DemandRecord {
                        origin: StationId(o as u32),
                        destination: StationId(d as u32),
                        departure_time: departure,
                        arrival_time: arrival,
                    }, day_kind);
                }
            }
            predictor.flush();
        }
    }

    for slot in 0..SLOTS_PER_DAY {
        let rate = demand_rate(slot);
        let n_rides = (rate * 15.0 + rng.gen::<f64>() * 3.0) as u32;

        for _ in 0..n_rides {
            let (o, d) = pick_od(slot, &mut rng, stations.len());
            state.try_ride(o, d);

            if dispatch_enabled && state.served % 3 == 0 {
                let departure = now + chrono::Duration::minutes(slot as i64);
                let arrival = departure + chrono::Duration::minutes(5);
                predictor.observe(&DemandRecord {
                    origin: StationId(o as u32),
                    destination: StationId(d as u32),
                    departure_time: departure,
                    arrival_time: arrival,
                }, day_kind);
            }
        }

        if dispatch_enabled && slot > 0 && slot % REBALANCE_INTERVAL == 0 {
            predictor.flush();
            let current_slot = TimeSlot { day_kind, slot_index: slot };
            let block_rate = state.block_rate();
            let congestion_factor = 1.0 + block_rate * 4.0;

            let mut config = SystemConfig::default();
            config.weather = None;
            config.current_slot_index = Some(slot);
            config.safety_buffer_ratio = (0.55 * congestion_factor).min(2.0);
            config.peak_multiplier = 2.5 * (1.0 + block_rate * 1.25);

            let targets: Vec<(StationId, u32)> = stations.iter().map(|s| {
                let t = predictor.target_inventory(s.id, current_slot, s.capacity, &config);
                (s.id, t.target_bikes)
            }).collect();

            let status: Vec<StationStatus> = stations.iter().enumerate().map(|(i, s)| {
                StationStatus {
                    station_id: s.id,
                    available_bikes: state.bikes[i],
                    available_docks: s.capacity - state.bikes[i],
                    timestamp: now,
                    broken_bikes: None,
                    maintenance_bikes: None,
                }
            }).collect();

            let vehicles: Vec<DispatchVehicle> = (0..NUM_VEHICLES).map(|i| {
                DispatchVehicle { id: i, capacity: VEHICLE_CAPACITY, current_position: StationId(0) }
            }).collect();

            let input = RebalanceInput {
                stations: stations.to_vec(),
                current_status: status,
                targets,
                distance_matrix: dm.to_vec(),
                vehicles,
                config,
            };

            let output = solver.solve(&input);
            let moved: u32 = output.dispatch_plan.vehicle_routes.iter()
                .flat_map(|r| r.stops.iter())
                .filter(|s| matches!(s.action, StopAction::Pickup))
                .map(|s| s.bike_count)
                .sum();
            state.apply_dispatch(&output.dispatch_plan);
            total_bikes_moved += moved;
            dispatch_count += 1;
        }
    }
    let _ = total_bikes_moved;
    (state, dispatch_count)
}

fn main() {
    let stations = build_stations();
    let dm = build_distance_matrix(&stations);
    let seed = 42u64;

    println!("╔══════════════════════════════════════════════════════╗");
    println!("║     校园共享单车调度算法 A/B 对比测试               ║");
    println!("╠══════════════════════════════════════════════════════╣");
    println!("║  站点: {}  |  车辆: {}  |  单车: {}            ║", NUM_STATIONS, NUM_VEHICLES, TOTAL_BIKES);
    println!("║  调度间隔: {} min  |  车辆容量: {}             ║", REBALANCE_INTERVAL, VEHICLE_CAPACITY);
    println!("╚══════════════════════════════════════════════════════╝");
    println!();

    println!("▶ 运行 Baseline（无调度）...");
    let (baseline, _) = run_phase(&stations, &dm, false, seed);
    println!("  ✓ 完成");

    println!("▶ 运行 Optimized（有调度）...");
    let (optimized, dispatch_count) = run_phase(&stations, &dm, true, seed);
    println!("  ✓ 完成");
    println!();

    println!("┌─────────────────────┬──────────────┬──────────────┬──────────┐");
    println!("│ 指标                │ 无调度       │ 有调度       │ 变化     │");
    println!("├─────────────────────┼──────────────┼──────────────┼──────────┤");

    let b_br = baseline.block_rate() * 100.0;
    let o_br = optimized.block_rate() * 100.0;
    println!("│ 阻塞率 (block rate) │ {:>10.2}%  │ {:>10.2}%  │ {:>+6.2}%  │", b_br, o_br, o_br - b_br);

    let b_sr = baseline.satisfaction_rate() * 100.0;
    let o_sr = optimized.satisfaction_rate() * 100.0;
    println!("│ 满足率              │ {:>10.2}%  │ {:>10.2}%  │ {:>+6.2}%  │", b_sr, o_sr, o_sr - b_sr);

    println!("│ 服务骑行数          │ {:>12}  │ {:>12}  │ {:>+8}  │",
        baseline.served, optimized.served, optimized.served as i32 - baseline.served as i32);
    println!("│ 被阻塞数            │ {:>12}  │ {:>12}  │ {:>+8}  │",
        baseline.blocked, optimized.blocked, optimized.blocked as i32 - baseline.blocked as i32);

    let b_sd = baseline.bike_std_dev();
    let o_sd = optimized.bike_std_dev();
    println!("│ 分布标准差          │ {:>12.4}  │ {:>12.4}  │ {:>+8.4}  │", b_sd, o_sd, o_sd - b_sd);
    println!("│ 调度次数            │ {:>12}  │ {:>12}  │          │", 0, dispatch_count);

    println!("└─────────────────────┴──────────────┴──────────────┴──────────┘");
    println!();

    println!("站点最终车辆分布:");
    println!("┌────┬──────────────┬──────┬──────────┬──────────┐");
    println!("│ ID │ 名称         │ 容量 │ 无调度   │ 有调度   │");
    println!("├────┼──────────────┼──────┼──────────┼──────────┤");
    for (i, s) in stations.iter().enumerate() {
        println!("│ {:>2} │ {:12} │ {:>4} │ {:>3}/{:<4} │ {:>3}/{:<4} │",
            i, s.name, s.capacity,
            baseline.bikes[i], s.capacity,
            optimized.bikes[i], s.capacity,
        );
    }
    println!("└────┴──────────────┴──────┴──────────┴──────────┘");
}
