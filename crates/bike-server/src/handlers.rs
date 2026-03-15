use axum::{extract::State, http::StatusCode, Json};
use serde::{Deserialize, Serialize};

use bike_core::*;
use bike_optimize::RebalanceSolver;
use bike_predict::DemandPredictor;

use crate::state::AppState;

// ── Request / Response types ──

#[derive(Deserialize)]
pub struct PredictDemandReq {
    pub station_id: u32,
    pub time_slot: TimeSlot,
}

#[derive(Serialize)]
pub struct PredictDemandResp {
    pub station_id: u32,
    pub pickups: f64,
    pub returns: f64,
    pub net_flow: f64,
    pub confidence_low: f64,
    pub confidence_high: f64,
}

#[derive(Deserialize)]
pub struct BatchPredictReq {
    pub queries: Vec<PredictDemandReq>,
}

#[derive(Serialize)]
pub struct BatchPredictResp {
    pub predictions: Vec<PredictDemandResp>,
}

#[derive(Deserialize)]
pub struct ObserveReq {
    pub records: Vec<DemandRecord>,
    #[serde(default = "default_day_kind")]
    pub day_kind: DayKind,
}

fn default_day_kind() -> DayKind {
    DayKind::Weekday
}

#[derive(Serialize)]
pub struct ObserveResp {
    pub accepted: usize,
}

#[derive(Deserialize)]
pub struct TargetReq {
    pub station_ids: Vec<u32>,
    pub capacities: Vec<u32>,
    pub current_slot: TimeSlot,
}

#[derive(Serialize)]
pub struct TargetResp {
    pub targets: Vec<TargetInventory>,
}

#[derive(Deserialize)]
pub struct SolveReq {
    pub stations: Vec<Station>,
    pub current_status: Vec<StationStatus>,
    pub targets: Vec<TargetEntry>,
    pub distance_matrix: Vec<Vec<f64>>,
    pub vehicles: Vec<DispatchVehicle>,
}

#[derive(Deserialize)]
pub struct TargetEntry {
    pub station_id: u32,
    pub target_bikes: u32,
}

#[derive(Serialize)]
pub struct SolveResp {
    pub dispatch_plan: DispatchPlan,
    pub incentives: Vec<PriceIncentive>,
}

#[derive(Deserialize)]
pub struct CycleReq {
    pub stations: Vec<Station>,
    pub current_status: Vec<StationStatus>,
    pub distance_matrix: Vec<Vec<f64>>,
    pub vehicles: Vec<DispatchVehicle>,
    pub current_slot: TimeSlot,
    /// Current block rate (0.0–1.0) for adaptive congestion response.
    #[serde(default)]
    pub block_rate: f64,
    /// Current weather condition (e.g. "rain", "storm", "cold_front")
    #[serde(default)]
    pub weather: Option<String>,
}

#[derive(Serialize)]
pub struct CycleResp {
    pub targets: Vec<TargetInventory>,
    pub dispatch_plan: DispatchPlan,
    pub incentives: Vec<PriceIncentive>,
}

// ── Handlers ──

pub async fn predict_demand(
    State(state): State<AppState>,
    Json(req): Json<PredictDemandReq>,
) -> Result<Json<PredictDemandResp>, (StatusCode, String)> {
    let predictor = state.predictor.read().await;
    let demand = predictor.predict(StationId(req.station_id), req.time_slot);
    Ok(Json(PredictDemandResp {
        station_id: req.station_id,
        pickups: demand.pickups,
        returns: demand.returns,
        net_flow: demand.net_flow,
        confidence_low: demand.confidence_low,
        confidence_high: demand.confidence_high,
    }))
}

pub async fn predict_demand_batch(
    State(state): State<AppState>,
    Json(req): Json<BatchPredictReq>,
) -> Result<Json<BatchPredictResp>, (StatusCode, String)> {
    let predictor = state.predictor.read().await;
    let predictions = req
        .queries
        .iter()
        .map(|q| {
            let demand = predictor.predict(StationId(q.station_id), q.time_slot);
            PredictDemandResp {
                station_id: q.station_id,
                pickups: demand.pickups,
                returns: demand.returns,
                net_flow: demand.net_flow,
                confidence_low: demand.confidence_low,
                confidence_high: demand.confidence_high,
            }
        })
        .collect();
    Ok(Json(BatchPredictResp { predictions }))
}

pub async fn observe(
    State(state): State<AppState>,
    Json(req): Json<ObserveReq>,
) -> Result<Json<ObserveResp>, (StatusCode, String)> {
    let mut predictor = state.predictor.write().await;
    let count = req.records.len();
    for record in &req.records {
        predictor.observe(record, req.day_kind);
    }
    predictor.flush();
    Ok(Json(ObserveResp { accepted: count }))
}

#[derive(Serialize)]
pub struct ResetResp {
    pub ok: bool,
}

pub async fn reset_predictor(State(state): State<AppState>) -> Result<Json<ResetResp>, (StatusCode, String)> {
    let mut predictor = state.predictor.write().await;
    predictor.reset();
    Ok(Json(ResetResp { ok: true }))
}

pub async fn target_inventory(
    State(state): State<AppState>,
    Json(req): Json<TargetReq>,
) -> Result<Json<TargetResp>, StatusCode> {
    if req.station_ids.len() != req.capacities.len() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let predictor = state.predictor.read().await;
    let config = state.config.read().await;
    let targets = req
        .station_ids
        .iter()
        .zip(req.capacities.iter())
        .map(|(&sid, &cap)| {
            predictor.target_inventory(StationId(sid), req.current_slot, cap, &config)
        })
        .collect();
    Ok(Json(TargetResp { targets }))
}

pub async fn rebalance_solve(
    State(state): State<AppState>,
    Json(req): Json<SolveReq>,
) -> Result<Json<SolveResp>, (StatusCode, String)> {
    let n = req.stations.len();
    if req.distance_matrix.len() != n || req.distance_matrix.iter().any(|row| row.len() != n) {
        return Err((StatusCode::BAD_REQUEST, format!("distance_matrix must be {n}x{n}")));
    }
    if req.vehicles.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "vehicles must not be empty".into()));
    }
    let config = state.config.read().await;
    let targets: Vec<(StationId, u32)> = req
        .targets
        .iter()
        .map(|t| (StationId(t.station_id), t.target_bikes))
        .collect();
    let input = RebalanceInput {
        stations: req.stations,
        current_status: req.current_status,
        targets,
        distance_matrix: req.distance_matrix,
        vehicles: req.vehicles,
        config: config.clone(),
    };
    let output = state.solver.solve(&input);
    Ok(Json(SolveResp {
        dispatch_plan: output.dispatch_plan,
        incentives: output.incentives,
    }))
}

pub async fn rebalance_cycle(
    State(state): State<AppState>,
    Json(req): Json<CycleReq>,
) -> Result<Json<CycleResp>, (StatusCode, String)> {
    let config = state.config.read().await;
    let predictor = state.predictor.read().await;

    // ── Adaptive congestion detection ──
    // congestion_factor: 1.0 at 0% block rate, scales up with congestion.
    let block_rate = req.block_rate.clamp(0.0, 1.0);
    let congestion_factor = 1.0 + block_rate * 4.0;
    let high_pressure = block_rate > 0.08;

    // Adaptive config overrides
    let effective_safety = (config.safety_buffer_ratio * congestion_factor).min(2.0);
    let effective_peak_mult = config.peak_multiplier * (1.0 + block_rate * 1.25);

    let mut adaptive_config = config.clone();
    adaptive_config.safety_buffer_ratio = effective_safety;
    adaptive_config.peak_multiplier = effective_peak_mult;
    adaptive_config.prediction_horizon_slots = if high_pressure {
        (config.prediction_horizon_slots + 2 + (block_rate * 4.0).round() as u32).min(16)
    } else {
        config.prediction_horizon_slots
    };

    // Step 1: compute prediction-based target for each station.
    let targets: Vec<TargetInventory> = req
        .stations
        .iter()
        .map(|s| predictor.target_inventory(s.id, req.current_slot, s.capacity, &adaptive_config))
        .collect();

    // Step 1.5: enforce category-based minimum target floors (adaptive).
    let total_bikes: u32 = req.current_status.iter().map(|s| s.available_bikes).sum();

    // Under high pressure, compute demand-proportional targets.
    let demand_targets: Vec<f64> = if high_pressure {
        let predicted_pickups: Vec<f64> = req
            .stations
            .iter()
            .map(|s| {
                let mut cumulative_outflow = 0.0;
                let mut max_cumulative_outflow: f64 = 0.0;
                let mut positive_outflow_sum = 0.0;

                for offset in 0..adaptive_config.prediction_horizon_slots {
                    let future_slot = req.current_slot.advance(offset);
                    let pred = predictor.predict(s.id, future_slot);
                    let net_outflow = pred.pickups - pred.returns;
                    cumulative_outflow += net_outflow;
                    max_cumulative_outflow = max_cumulative_outflow.max(cumulative_outflow);
                    positive_outflow_sum += net_outflow.max(0.0);
                }

                max_cumulative_outflow
                    .max(positive_outflow_sum * 0.5)
                    .max(0.1)
            })
            .collect();
        let total_predicted: f64 = predicted_pickups.iter().sum();
        predicted_pickups
            .iter()
            .map(|p| (p / total_predicted) * total_bikes as f64)
            .collect()
    } else {
        vec![0.0; req.stations.len()]
    };

    let mut target_pairs: Vec<(StationId, u32)> = targets
        .iter()
        .zip(req.stations.iter())
        .enumerate()
        .map(|(i, (t, s))| {
            // Adaptive category floors
            let base_ratio = match s.category {
                StationCategory::Dormitory => 0.50,
                StationCategory::AcademicBuilding | StationCategory::Cafeteria => 0.30,
                _ => 0.25,
            };
            let adaptive_ratio = (base_ratio * congestion_factor).min(0.90);
            let min_target = (s.capacity as f64 * adaptive_ratio).ceil() as u32;

            let prediction_target = t.target_bikes.max(min_target);

            // Under high pressure, blend prediction target with demand-proportional target.
            let effective_target = if high_pressure {
                let demand_t = demand_targets[i].round() as u32;
                let blend = (0.35 + block_rate * 0.9).min(0.9);
                let blended = (prediction_target as f64 * (1.0 - blend) + demand_t as f64 * blend)
                    .round() as u32;
                blended.max(min_target).min(s.capacity)
            } else {
                prediction_target
            };

            (t.station_id, effective_target)
        })
        .collect();

    // ── Target normalization ──
    // When total target exceeds total available bikes the solver is fighting
    // an impossible battle.  Scale down proportionally, preserving a dynamic
    // floor: 1 per station when affordable, 0 when total_bikes < station_count.
    let total_target: u32 = target_pairs.iter().map(|(_, t)| *t).sum();
    if total_target > total_bikes {
        let station_count = req.stations.len() as u32;
        let per_station_floor: u32 = if total_bikes >= station_count { 1 } else { 0 };
        let total_min = per_station_floor * station_count;
        let allocatable = total_bikes.saturating_sub(total_min);
        let surplus_above_min: f64 = target_pairs
            .iter()
            .map(|(_, t)| t.saturating_sub(per_station_floor) as f64)
            .sum();
        let scale = if surplus_above_min > 0.0 {
            (allocatable as f64 / surplus_above_min).min(1.0)
        } else {
            0.0
        };
        target_pairs = target_pairs
            .iter()
            .zip(req.stations.iter())
            .map(|((sid, t), s)| {
                let above_min = t.saturating_sub(per_station_floor);
                let scaled = per_station_floor + (above_min as f64 * scale).round() as u32;
                (*sid, scaled.min(s.capacity))
            })
            .collect();
    }

    // Step 2: solve rebalance.
    // Build the actual targets response from the (possibly normalized) target_pairs
    // so the caller sees exactly what the solver received.
    let actual_targets: Vec<TargetInventory> = target_pairs
        .iter()
        .map(|(sid, target)| {
            // Preserve is_peak from the original prediction-based targets where available.
            let is_peak = targets.iter().find(|t| t.station_id == *sid).map(|t| t.is_peak).unwrap_or(false);
            TargetInventory {
                station_id: *sid,
                target_bikes: *target,
                is_peak,
                reason: String::new(),
            }
        })
        .collect();

    let mut solve_config = config.clone();
    solve_config.weather = req.weather;

    let input = RebalanceInput {
        stations: req.stations,
        current_status: req.current_status,
        targets: target_pairs,
        distance_matrix: req.distance_matrix,
        vehicles: req.vehicles,
        config: solve_config,
    };
    let output = state.solver.solve(&input);

    Ok(Json(CycleResp {
        targets: actual_targets,
        dispatch_plan: output.dispatch_plan,
        incentives: output.incentives,
    }))
}

pub async fn get_config(State(state): State<AppState>) -> Result<Json<SystemConfig>, (StatusCode, String)> {
    let config = state.config.read().await;
    Ok(Json(config.clone()))
}

pub async fn put_config(
    State(state): State<AppState>,
    Json(new_config): Json<SystemConfig>,
) -> Result<Json<SystemConfig>, (StatusCode, String)> {
    new_config.validate().map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    let mut config = state.config.write().await;
    *config = new_config.clone();
    Ok(Json(new_config))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request, routing::post, Router};
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    fn test_app() -> Router {
        let state = AppState::new();
        Router::new()
            .route("/api/v1/predict/demand", post(predict_demand))
            .route("/api/v1/predict/demand/batch", post(predict_demand_batch))
            .route("/api/v1/predict/observe", post(observe))
            .route("/api/v1/predict/target", post(target_inventory))
            .route("/api/v1/rebalance/solve", post(rebalance_solve))
            .route("/api/v1/rebalance/cycle", post(rebalance_cycle))
            .with_state(state)
    }

    async fn post_json(
        app: &Router,
        path: &str,
        body: serde_json::Value,
    ) -> (StatusCode, serde_json::Value) {
        let req = Request::builder()
            .method("POST")
            .uri(path)
            .header("content-type", "application/json")
            .body(Body::from(serde_json::to_string(&body).unwrap()))
            .unwrap();

        let resp = app.clone().oneshot(req).await.unwrap();
        let status = resp.status();
        let bytes = resp.into_body().collect().await.unwrap().to_bytes();
        let json: serde_json::Value =
            serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
        (status, json)
    }

    #[tokio::test]
    async fn test_predict_demand_empty() {
        let app = test_app();
        let (status, body) = post_json(
            &app,
            "/api/v1/predict/demand",
            serde_json::json!({
                "station_id": 1,
                "time_slot": {"day_kind": "weekday", "slot_index": 32}
            }),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["pickups"], 0.0);
    }

    #[tokio::test]
    async fn test_observe_and_predict() {
        let app = test_app();

        // Feed observations.
        let (status, body) = post_json(
            &app,
            "/api/v1/predict/observe",
            serde_json::json!({
                "records": [
                    {
                        "origin": 1,
                        "destination": 2,
                        "departure_time": "2026-03-13T08:00:00Z",
                        "arrival_time": "2026-03-13T08:10:00Z"
                    }
                ],
                "day_kind": "weekday"
            }),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["accepted"], 1);

        // Now predict at slot 480 (= 08:00 in 1-minute slots).
        let (status, body) = post_json(
            &app,
            "/api/v1/predict/demand",
            serde_json::json!({
                "station_id": 1,
                "time_slot": {"day_kind": "weekday", "slot_index": 480}
            }),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(body["pickups"].as_f64().unwrap() > 0.0);
    }

    #[tokio::test]
    async fn test_batch_predict() {
        let app = test_app();
        let (status, body) = post_json(
            &app,
            "/api/v1/predict/demand/batch",
            serde_json::json!({
                "queries": [
                    {"station_id": 1, "time_slot": {"day_kind": "weekday", "slot_index": 32}},
                    {"station_id": 2, "time_slot": {"day_kind": "weekday", "slot_index": 32}}
                ]
            }),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["predictions"].as_array().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn test_target_inventory_api() {
        let app = test_app();
        let (status, body) = post_json(
            &app,
            "/api/v1/predict/target",
            serde_json::json!({
                "station_ids": [1, 2],
                "capacities": [30, 25],
                "current_slot": {"day_kind": "weekday", "slot_index": 32}
            }),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["targets"].as_array().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn test_rebalance_solve_api() {
        let app = test_app();
        let (status, body) = post_json(
            &app,
            "/api/v1/rebalance/solve",
            serde_json::json!({
                "stations": [
                    {"id": 0, "name": "Dorm", "category": "dormitory", "capacity": 30, "latitude": 30.51, "longitude": 114.35},
                    {"id": 1, "name": "Building", "category": "academic_building", "capacity": 25, "latitude": 30.52, "longitude": 114.36}
                ],
                "current_status": [
                    {"station_id": 0, "available_bikes": 5, "available_docks": 25, "timestamp": 1710300000},
                    {"station_id": 1, "available_bikes": 22, "available_docks": 3, "timestamp": 1710300000}
                ],
                "targets": [
                    {"station_id": 0, "target_bikes": 20},
                    {"station_id": 1, "target_bikes": 8}
                ],
                "distance_matrix": [[0, 800], [800, 0]],
                "vehicles": [{"id": 1, "capacity": 15, "current_position": 0}]
            }),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(body["dispatch_plan"]["total_bikes_moved"].as_u64().unwrap() > 0);
    }

    #[tokio::test]
    async fn test_rebalance_cycle_api() {
        let app = test_app();
        let (status, body) = post_json(
            &app,
            "/api/v1/rebalance/cycle",
            serde_json::json!({
                "stations": [
                    {"id": 0, "name": "Dorm", "category": "dormitory", "capacity": 30, "latitude": 30.51, "longitude": 114.35}
                ],
                "current_status": [
                    {"station_id": 0, "available_bikes": 5, "available_docks": 25, "timestamp": 1710300000}
                ],
                "distance_matrix": [[0]],
                "vehicles": [{"id": 1, "capacity": 15, "current_position": 0}],
                "current_slot": {"day_kind": "weekday", "slot_index": 32}
            }),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(body["targets"].as_array().is_some());
    }
}
