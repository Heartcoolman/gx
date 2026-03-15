import { create } from 'zustand';

export interface SimEnvConfig {
  /** 总车辆数 */
  totalBikes: number;
  /** 需求倍率 — 对所有 BASE_RIDES_PER_SLOT 的缩放 (1.0 = 默认) */
  demandMultiplier: number;
  /** 高峰强度倍率 — 对 profile peak 值的缩放 (1.0 = 默认) */
  peakIntensity: number;
  /** 随机噪声系数 — Gaussian sigma 比例 (0.2 = 默认) */
  noiseFactor: number;
}

export const DEFAULT_SIM_ENV: SimEnvConfig = {
  totalBikes: 0, // 0 = use scenario default
  demandMultiplier: 1.0,
  peakIntensity: 1.0,
  noiseFactor: 0.2,
};

interface SimEnvState extends SimEnvConfig {
  setParam: (key: keyof SimEnvConfig, value: number) => void;
  applyPreset: (preset: SimEnvConfig) => void;
}

export const useSimEnvStore = create<SimEnvState>((set) => ({
  ...DEFAULT_SIM_ENV,
  setParam: (key, value) => set({ [key]: value }),
  applyPreset: (preset) => set(preset),
}));

/** 仿真环境预设 — 南昌理工 24,000师生 */
export const SIM_ENV_PRESETS = [
  {
    key: 'light',
    label: '😌 低峰',
    description: '课少/周末低需求',
    config: { totalBikes: 0, demandMultiplier: 0.6, peakIntensity: 0.7, noiseFactor: 0.1 },
    color: '#10b981',
  },
  {
    key: 'normal',
    label: '⚖️ 工作日',
    description: '正常教学日',
    config: DEFAULT_SIM_ENV,
    color: '#3b82f6',
  },
  {
    key: 'busy',
    label: '🔥 高峰日',
    description: '考试周/活动日',
    config: { totalBikes: 0, demandMultiplier: 1.5, peakIntensity: 1.5, noiseFactor: 0.25 },
    color: '#f59e0b',
  },
  {
    key: 'extreme',
    label: '💀 极端',
    description: '开学日/大型活动',
    config: { totalBikes: 0, demandMultiplier: 2.0, peakIntensity: 2.0, noiseFactor: 0.3 },
    color: '#ef4444',
  },
  {
    key: 'shortage',
    label: '🚲 车辆不足',
    description: '600车应对全校需求',
    config: { totalBikes: 600, demandMultiplier: 1.0, peakIntensity: 1.0, noiseFactor: 0.2 },
    color: '#8b5cf6',
  },
];
