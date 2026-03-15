# Campus Bike-Sharing Intelligent Dispatch Simulation Platform

A high-fidelity simulation platform for optimizing campus bike-sharing rebalancing operations. Combines an agent-based demand model with a Rust-powered dispatch optimizer, featuring congestion-aware routing, weather-sensitive scheduling, and dynamic pricing incentives.

Built for Nanchang Institute of Technology campus (15 stations, ~1000 bikes, ~24,000 users).

## Architecture

```
+---------------------------+       REST API        +---------------------------+
|     React Frontend        | <-------------------> |     Rust Backend          |
|                           |    /api/v1/*          |                           |
|  Simulation Engine        |                       |  bike-predict             |
|  Agent-Based Demand Model |                       |    EWMA + seasonal        |
|  Station State Manager    |                       |    confidence intervals   |
|  Vehicle Execution        |                       |                           |
|  Scenario System          |                       |  bike-optimize            |
|  Benchmark Runner         |                       |    greedy solver + VRP    |
|                           |                       |    incentive engine       |
|  Web Workers for heavy    |                       |                           |
|  computation              |                       |  bike-server (Axum)       |
+---------------------------+                       +---------------------------+
```

## Tech Stack

| Layer    | Technology                                              |
|----------|---------------------------------------------------------|
| Frontend | React 18, TypeScript 5.6, Vite 6, Zustand 5            |
| Map      | Leaflet 1.9 + react-leaflet 4.2                        |
| Charts   | Recharts 2.15                                           |
| Backend  | Rust, Axum 0.8, Tokio                                   |
| Crates   | bike-core, bike-predict, bike-optimize, bike-server     |

## Project Structure

```
gx/
├── Cargo.toml                    # Rust workspace
├── config/
│   └── default.toml              # System parameters
├── crates/
│   ├── bike-core/                # Domain models, config, error types
│   │   └── src/
│   │       ├── config.rs         # SystemConfig (weather, congestion, slot index)
│   │       ├── domain.rs         # Station, StationStatus, TimeSlot, DemandRecord
│   │       ├── dispatch.rs       # DispatchPlan, VehicleRoute, RouteStop
│   │       ├── incentive.rs      # PriceIncentive, IncentiveType
│   │       └── error.rs
│   ├── bike-predict/             # Demand prediction engine
│   │   └── src/
│   │       └── predictor.rs      # EWMA + seasonal baseline, confidence intervals
│   ├── bike-optimize/            # Dispatch optimization
│   │   └── src/
│   │       ├── greedy.rs         # Greedy rebalance solver (gap computation, assignment)
│   │       ├── vrp.rs            # VRP with interleaved routing, congestion model
│   │       └── incentive.rs      # Dynamic pricing (departure/arrival incentives)
│   └── bike-server/              # REST API
│       └── src/
│           ├── main.rs           # Axum server entry point (port 3000)
│           ├── handlers.rs       # API endpoints (predict, rebalance, config)
│           ├── state.rs          # Shared application state
│           └── bin/
│               └── benchmark.rs  # CLI benchmark binary
├── web/                          # React frontend
│   ├── package.json
│   ├── vite.config.ts            # Dev server with /api proxy
│   └── src/
│       ├── api/client.ts         # Axios HTTP client
│       ├── simulation/
│       │   ├── engine.ts         # Main simulation loop (1440 slots/day)
│       │   ├── agentSimulator.ts # Rider agent behavior model
│       │   ├── stateManagerV2.ts # Station state, bike health, dock faults
│       │   ├── ridingModel.ts    # Realistic travel time model
│       │   ├── dispatchExecution.ts  # Vehicle route execution
│       │   ├── benchmark.ts      # A/B benchmark orchestration
│       │   ├── benchmarkWorker.ts    # Web Worker benchmark runner
│       │   ├── scenarioCompiler.ts   # Scenario compilation
│       │   ├── clock.ts          # Virtual clock
│       │   ├── rng.ts            # Seeded PRNG
│       │   └── distanceMatrix.ts # Haversine distance matrix
│       ├── components/
│       │   ├── map/              # Leaflet campus map, station markers
│       │   ├── dashboard/        # Demand charts, rebalance metrics
│       │   ├── controls/         # Simulation controls, parameter tuning
│       │   ├── benchmark/        # Benchmark panel
│       │   └── layout/           # App shell, header, sidebar
│       ├── data/
│       │   ├── stations.ts       # 15 campus stations
│       │   ├── constants.ts      # Simulation constants
│       │   ├── scenarioLibrary.ts    # 6 pre-built scenarios
│       │   └── demandProfiles.ts     # Hourly demand by category
│       ├── store/                # Zustand state management
│       └── types/                # TypeScript type definitions
```

## Getting Started

### Prerequisites

- Rust toolchain (1.75+)
- Node.js (18+) and npm
- Git

### Backend

```bash
# Build and start the API server (port 3000)
cargo build --release
cargo run --release --bin bike-server
```

### Frontend

```bash
cd web
npm install
npm run dev    # Vite dev server with API proxy to localhost:3000
```

Open http://localhost:5173 in your browser.

### Run Benchmark (CLI)

```bash
cargo run --release --bin benchmark
```

This runs an A/B comparison (no-dispatch vs with-dispatch) and prints metrics to stdout.

## Campus Layout

15 stations across 6 categories:

| Category          | Stations | Capacity Each | IDs   |
|-------------------|----------|---------------|-------|
| Dormitory         | 4        | 200           | 0-3   |
| Academic Building | 4        | 150           | 4-7   |
| Cafeteria         | 2        | 120           | 8-9   |
| Library           | 1        | 100           | 10    |
| Sports Field      | 2        | 80            | 11-12 |
| Main Gate         | 2        | 80            | 13-14 |

Campus center: 28.7875N, 115.8579E. Total capacity: 2160 docks.

## Simulation Engine

The frontend runs a high-fidelity agent-based simulation at 1-minute resolution (1440 slots per day).

### Rider Agent Model

- Poisson-distributed demand generation calibrated to campus schedules
- 7 rider profiles (early student, regular student, commuter, etc.) with distinct activity windows
- Purpose-driven trips: class, meal, study, exercise, commute
- Weather sensitivity: riders cancel trips in storms, reduce demand in rain
- Retry logic: riders attempt nearby stations when origin has no bikes
- Queue waiting: riders wait up to N minutes before giving up
- Incentive-aware: riders respond to departure discounts and arrival rewards

### Station State Tracking

- O(1) indexed counters per station (available, broken, maintenance, docked)
- Bike health model with component-level degradation (chain, brake, tire)
- Non-linear wear acceleration when health drops below thresholds
- Preventive maintenance scheduling (every 480 slots)
- Dock fault simulation with weather-dependent failure rates
- Overflow handling: riders redirected to nearest station with space

### Scenario System

6 pre-built scenarios with weather timelines and environmental events:

| Scenario         | Day Kind | Weather                    | Key Feature              |
|------------------|----------|----------------------------|--------------------------|
| Weekday Spring   | Weekday  | Clear                      | Normal campus operation  |
| Rainy Commute    | Weekday  | Rain periods               | Weather impact on demand |
| Exam Week        | Weekday  | Clear, high stress         | Library/academic surge   |
| Festival Day     | Holiday  | Clear                      | Special event patterns   |
| Weekend Freeplay | Saturday | Mixed                      | Leisure-oriented demand  |
| Custom           | Any      | Configurable               | User-defined parameters  |

## Dispatch Optimization (Rust Backend)

### Prediction Engine (`bike-predict`)

- Composite predictor: seasonal baseline + EWMA adaptive smoothing
- Per-station, per-day-kind, per-slot granularity
- Variance tracking for confidence intervals (used for uncertainty buffers)
- Configurable prediction horizon (default: 10 slots ahead)

### Greedy Rebalance Solver (`bike-optimize`)

Two-mode assignment strategy:

**Peak Mode** (triggered when total deficit exceeds fleet capacity, or empty stations exist):
1. Coverage phase: guarantees empty/near-empty stations receive minimum allocation
2. Greedy phase with marginal decay: optimizes remaining capacity using transfer scoring

**Normal Mode:**
1. Proportional round: each deficit takes at most 50% of any single surplus
2. Uncapped greedy fill: distribute remaining surplus

Transfer scoring considers: urgency weight, coverage bonus (8x for empty stations), marginal decay, source efficiency, distance cost, and demand uncertainty penalty.

### Vehicle Routing (VRP)

- Bin-packing order distribution across vehicles (largest-first)
- Constrained nearest-neighbor with interleaved pickup/dropoff (not rigid pickup-first)
- Load feasibility checked at each step (pickup: load + count <= capacity; dropoff: load >= count)
- 2-opt local improvement with load feasibility validation (max 50 iterations)
- Route duration trimming with orphan stop reassignment
- Route duration balancing across vehicles

### Congestion-Aware Speed Model

Vehicle speed adapts to time-of-day congestion and weather:

```
effective_speed = 5.0 m/s * weather_factor * congestion_factor

congestion_factor:
  - 3 base Gaussian peaks (7:45, 11:45, 16:45)
  - 5 class-change peaks (7:50, 9:50, 11:50, 13:50, 17:00)
  - Floor: 0.4 (never below 2 m/s)

weather_factor:
  - storm:      0.595 (0.70 * 0.85)
  - rain:       0.782 (0.85 * 0.92)
  - cold_front: 0.92
  - clear:      1.0
```

Variable load/unload time: each successive bike takes slightly longer (15s base + 1s per additional bike, capped at +10s).

### Broken Bike Awareness

- `StationStatus` carries `broken_bikes` and `maintenance_bikes` counts
- Solver boosts urgency for stations with many faulty bikes (up to +60%)
- Effective supply is more fragile when broken ratio is high

### Priority-Weighted Target Normalization

When total target exceeds available bikes, allocation uses priority weights:
- Empty stations (0 bikes): 3x weight
- Near-empty stations (1-2 bikes): 2x weight
- Other stations: 1x weight

This ensures critical stations retain a larger share during scarcity.

### Confidence Interval Buffer

Target inventory includes an uncertainty buffer derived from prediction confidence intervals:
```
buffer = min(ceil(confidence_width * 0.25), 3)
target = base_target + buffer
```

Wider confidence intervals (less certain predictions) trigger larger buffers.

### Dynamic Pricing Incentives

- Arrival rewards: encourage riders to dock at deficit stations
- Departure discounts: encourage riders to leave surplus stations
- Logistic response model for discount-to-demand conversion
- Budget-constrained allocation with emergency relaxation for critical stations
- Vehicle coverage awareness: skip incentives where dispatch already covers the gap

## API Reference

All endpoints are prefixed with `/api/v1`.

### Prediction

| Method | Path                    | Description                          |
|--------|-------------------------|--------------------------------------|
| POST   | /predict/demand         | Predict demand for one station/slot  |
| POST   | /predict/demand/batch   | Batch demand predictions             |
| POST   | /predict/observe        | Feed observed ride records           |
| POST   | /predict/reset          | Reset predictor state                |
| POST   | /predict/target         | Calculate target inventory           |

### Dispatch

| Method | Path              | Description                                        |
|--------|-------------------|----------------------------------------------------|
| POST   | /rebalance/solve  | Solve VRP for given targets                        |
| POST   | /rebalance/cycle  | Full cycle: predict + optimize + incentivize       |

### Configuration

| Method | Path    | Description            |
|--------|---------|------------------------|
| GET    | /config | Fetch system config    |
| PUT    | /config | Update system config   |

### Rebalance Cycle Request

```json
{
  "stations": [...],
  "current_status": [
    {
      "station_id": 0,
      "available_bikes": 15,
      "available_docks": 185,
      "timestamp": 1710300000,
      "broken_bikes": 3,
      "maintenance_bikes": 1
    }
  ],
  "distance_matrix": [[0, 500, ...], ...],
  "vehicles": [{"id": 0, "capacity": 20, "current_position": 0}],
  "current_slot": {"day_kind": "weekday", "slot_index": 480},
  "block_rate": 0.12,
  "weather": "rain"
}
```

## Configuration

System parameters in `config/default.toml`:

```toml
[general]
station_count = 15
total_bikes = 1000
time_slot_minutes = 1

[prediction]
horizon_slots = 10          # How many slots ahead to predict
ewma_alpha = 0.35           # Smoothing factor for adaptive predictor
safety_buffer_ratio = 0.55  # Extra inventory buffer
peak_multiplier = 2.5       # Multiplier during peak demand
peak_percentile = 0.80      # Percentile for peak detection

[dispatch]
vehicle_count = 5           # Number of dispatch vehicles
vehicle_capacity = 20       # Bikes per vehicle
rebalance_interval_minutes = 15

[incentive]
max_discount_percent = 60.0
budget_per_hour = 800.0     # Yuan per hour for incentives
```

All parameters can be adjusted at runtime via the UI parameter tuning panel or the PUT /api/v1/config endpoint.

## Benchmark

### CLI Benchmark

```bash
cargo run --release --bin benchmark
```

Runs a simplified simulation comparing no-dispatch vs with-dispatch over a full weekday (1440 slots). Reports:
- Block rate and satisfaction rate
- Total rides served and blocked
- Bike distribution standard deviation
- Per-station final bike counts

### Browser Benchmark

The web UI includes a benchmark panel that runs the full agent-based simulation with Web Workers. This provides more accurate results since it uses the complete rider model, weather system, bike health degradation, and queue mechanics.

## Testing

```bash
# Run all Rust tests (37 tests across 4 crates)
cargo test

# TypeScript type checking
cd web && npx tsc --noEmit
```

Test coverage includes:
- Congestion/weather speed model validation
- Variable load/unload time correctness
- VRP capacity constraints
- Greedy assignment in peak and normal modes
- Priority normalization (empty stations get larger share)
- Incentive budget constraints
- API endpoint integration tests

## License

MIT
