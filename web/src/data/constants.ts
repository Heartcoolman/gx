// System constants

export const TOTAL_BIKES = 200;
export const DISPATCH_VEHICLE_COUNT = 3;
export const DISPATCH_VEHICLE_CAPACITY = 15;

// 仿真速度对照（1x = 15分钟真实 → 15秒仿真）
export const SPEED_OPTIONS = [1, 2, 4, 8, 16] as const;
export type SpeedMultiplier = (typeof SPEED_OPTIONS)[number];

// 1x时每帧推进的虚拟毫秒 = 15min / 15s * (1000ms/60fps) ≈ 1000ms虚拟时间/帧
export const VIRTUAL_MS_PER_FRAME_1X = (15 * 60 * 1000) / (15 * 60); // = 1000

export const SLOT_DURATION_MS = 15 * 60 * 1000; // 15 minutes in ms

// 调度间隔 (每2个slot=30分钟)
export const REBALANCE_INTERVAL_SLOTS = 2;

// 最大同时显示的骑行动画数
export const MAX_VISIBLE_RIDES = 100;

// 校园地图中心和缩放
export const MAP_CENTER: [number, number] = [28.7875, 115.8579];
export const MAP_ZOOM = 16;

// 初始分布：70%在宿舍，30%按容量分配
export const INITIAL_DORMITORY_RATIO = 0.7;
