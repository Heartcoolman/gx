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
) -> Json<PredictDemandResp> {
    let predictor = state.predictor.read().await;
    let demand = predictor.predict(StationId(req.station_id), req.time_slot);
    Json(PredictDemandResp {
        station_id: req.station_id,
        pickups: demand.pickups,
        returns: demand.returns,
        net_flow: demand.net_flow,
    })
}

pub async fn predict_demand_batch(
    State(state): State<AppState>,
    Json(req): Json<BatchPredictReq>,
) -> Json<BatchPredictResp> {
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
            }
        })
        .collect();
    Json(BatchPredictResp { predictions })
}

pub async fn observe(
    State(state): State<AppState>,
    Json(req): Json<ObserveReq>,
) -> Json<ObserveResp> {
    let mut predictor = state.predictor.write().await;
    let count = req.records.len();
    for record in &req.records {
        predictor.observe(record, req.day_kind);
    }
    predictor.flush();
    Json(ObserveResp { accepted: count })
}

#[derive(Serialize)]
pub struct ResetResp {
    pub ok: bool,
}

pub async fn reset_predictor(
    State(state): State<AppState>,
) -> Json<ResetResp> {
    let mut predictor = state.predictor.write().await;
    predictor.reset();
    Json(ResetResp { ok: true })
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
) -> Json<SolveResp> {
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
    Json(SolveResp {
        dispatch_plan: output.dispatch_plan,
        incentives: output.incentives,
    })
}

pub async fn rebalance_cycle(
    State(state): State<AppState>,
    Json(req): Json<CycleReq>,
) -> Json<CycleResp> {
    let config = state.config.read().await;
    let predictor = state.predictor.read().await;

    // Step 1: compute target for each station.
    let targets: Vec<TargetInventory> = req
        .stations
        .iter()
        .map(|s| {
            predictor.target_inventory(s.id, req.current_slot, s.capacity, &config)
        })
        .collect();

    // Step 1.5: enforce category-based minimum target floors.
    // This prevents cold-predictor from producing near-zero targets.
    let target_pairs: Vec<(StationId, u32)> = targets
        .iter()
        .zip(req.stations.iter())
        .map(|(t, s)| {
            let min_ratio = match s.category {
                StationCategory::Dormitory => 0.40,
                StationCategory::AcademicBuilding | StationCategory::Cafeteria => 0.20,
                _ => 0.15,
            };
            let min_target = (s.capacity as f64 * min_ratio).ceil() as u32;
            let effective_target = t.target_bikes.max(min_target);
            (t.station_id, effective_target)
        })
        .collect();

    // Step 2: solve rebalance.
    let input = RebalanceInput {
        stations: req.stations,
        current_status: req.current_status,
        targets: target_pairs,
        distance_matrix: req.distance_matrix,
        vehicles: req.vehicles,
        config: config.clone(),
    };
    let output = state.solver.solve(&input);

    Json(CycleResp {
        targets,
        dispatch_plan: output.dispatch_plan,
        incentives: output.incentives,
    })
}

pub async fn get_config(State(state): State<AppState>) -> Json<SystemConfig> {
    let config = state.config.read().await;
    Json(config.clone())
}

pub async fn put_config(
    State(state): State<AppState>,
    Json(new_config): Json<SystemConfig>,
) -> Json<SystemConfig> {
    let mut config = state.config.write().await;
    *config = new_config.clone();
    Json(new_config)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request, Router, routing::post};
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

    async fn post_json(app: &Router, path: &str, body: serde_json::Value) -> (StatusCode, serde_json::Value) {
        let req = Request::builder()
            .method("POST")
            .uri(path)
            .header("content-type", "application/json")
            .body(Body::from(serde_json::to_string(&body).unwrap()))
            .unwrap();

        let resp = app.clone().oneshot(req).await.unwrap();
        let status = resp.status();
        let bytes = resp.into_body().collect().await.unwrap().to_bytes();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
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

        // Now predict.
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
