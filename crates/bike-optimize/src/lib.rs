mod greedy;
mod incentive;
mod vrp;

pub use greedy::GreedyRebalanceSolver;

use bike_core::{RebalanceInput, RebalanceOutput};

/// Trait for rebalance solvers.
pub trait RebalanceSolver: Send + Sync {
    fn solve(&self, input: &RebalanceInput) -> RebalanceOutput;
}
