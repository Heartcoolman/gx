import type { SystemConfig } from '../types/api';

/** 默认参数 — 与 Rust SystemConfig::default() 完全一致 */
export const DEFAULT_CONFIG: SystemConfig = {
  time_slot_minutes: 15,
  prediction_horizon_slots: 8,
  ewma_alpha: 0.3,
  safety_buffer_ratio: 0.50,
  peak_multiplier: 2.5,
  peak_percentile: 0.80,
  dispatch_vehicle_count: 5,
  dispatch_vehicle_capacity: 20,
  max_incentive_discount: 50.0,
  incentive_budget_per_hour: 500.0,
  rebalance_interval_minutes: 15,
};

/** 保守方案 — 更谨慎的预测、更少资源投入 */
export const CONSERVATIVE_CONFIG: SystemConfig = {
  time_slot_minutes: 15,
  prediction_horizon_slots: 3,
  ewma_alpha: 0.2,
  safety_buffer_ratio: 0.50,
  peak_multiplier: 1.5,
  peak_percentile: 0.85,
  dispatch_vehicle_count: 2,
  dispatch_vehicle_capacity: 10,
  max_incentive_discount: 30.0,
  incentive_budget_per_hour: 300.0,
  rebalance_interval_minutes: 60,
};

/** 激进方案 — 最大化调度能力，测试算法上限 */
export const AGGRESSIVE_CONFIG: SystemConfig = {
  time_slot_minutes: 15,
  prediction_horizon_slots: 12,
  ewma_alpha: 0.5,
  safety_buffer_ratio: 0.20,
  peak_multiplier: 3.0,
  peak_percentile: 0.70,
  dispatch_vehicle_count: 5,
  dispatch_vehicle_capacity: 25,
  max_incentive_discount: 80.0,
  incentive_budget_per_hour: 1500.0,
  rebalance_interval_minutes: 15,
};

export interface PresetOption {
  key: string;
  label: string;
  description: string;
  config: SystemConfig;
  color: string;
}

export const PRESETS: PresetOption[] = [
  {
    key: 'conservative',
    label: '🛡️ 保守',
    description: '少车辆、低频次、高安全缓冲',
    config: CONSERVATIVE_CONFIG,
    color: '#10b981',
  },
  {
    key: 'default',
    label: '⚖️ 默认',
    description: '系统默认参数组合',
    config: DEFAULT_CONFIG,
    color: '#3b82f6',
  },
  {
    key: 'aggressive',
    label: '🚀 激进',
    description: '多车辆、高频次、测试上限',
    config: AGGRESSIVE_CONFIG,
    color: '#f59e0b',
  },
];
