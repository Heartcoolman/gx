mod handlers;
mod state;

use axum::{
    routing::{get, post},
    Router,
};
use std::net::SocketAddr;
use tower_http::cors::CorsLayer;
use tracing_subscriber::EnvFilter;

use state::AppState;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::from_default_env().add_directive("bike_server=info".parse().unwrap()),
        )
        .init();

    let state = AppState::new();

    let app = Router::new()
        .route("/api/v1/predict/demand", post(handlers::predict_demand))
        .route(
            "/api/v1/predict/demand/batch",
            post(handlers::predict_demand_batch),
        )
        .route("/api/v1/predict/observe", post(handlers::observe))
        .route("/api/v1/predict/reset", post(handlers::reset_predictor))
        .route("/api/v1/predict/target", post(handlers::target_inventory))
        .route("/api/v1/rebalance/solve", post(handlers::rebalance_solve))
        .route("/api/v1/rebalance/cycle", post(handlers::rebalance_cycle))
        .route(
            "/api/v1/config",
            get(handlers::get_config).put(handlers::put_config),
        )
        .layer(CorsLayer::permissive())
        .with_state(state);

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3000);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
