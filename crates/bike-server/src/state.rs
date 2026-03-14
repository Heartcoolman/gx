use std::sync::Arc;
use tokio::sync::RwLock;

use bike_core::SystemConfig;
use bike_optimize::GreedyRebalanceSolver;
use bike_predict::CompositePredictor;

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<RwLock<SystemConfig>>,
    pub predictor: Arc<RwLock<CompositePredictor>>,
    pub solver: Arc<GreedyRebalanceSolver>,
}

impl AppState {
    pub fn new() -> Self {
        let config = SystemConfig::default();
        let predictor = CompositePredictor::new(config.ewma_alpha);
        Self {
            config: Arc::new(RwLock::new(config)),
            predictor: Arc::new(RwLock::new(predictor)),
            solver: Arc::new(GreedyRebalanceSolver::new()),
        }
    }
}
