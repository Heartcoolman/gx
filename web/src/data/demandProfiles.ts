import type { StationCategory } from '../types/station';

// 每个类别96个时段的pickup/return频率系数
// 值为该时段相对于日均需求的倍数

interface DemandProfile {
  pickup: number[];  // 96 slots
  return_: number[]; // 96 slots
}

function makeProfile(peakDef: Array<[number, number, number, number]>): number[] {
  const arr = new Array(96).fill(0.1); // baseline
  for (const [startSlot, endSlot, peakVal, _] of peakDef) {
    const mid = (startSlot + endSlot) / 2;
    const halfWidth = (endSlot - startSlot) / 2;
    for (let i = startSlot; i <= endSlot && i < 96; i++) {
      const dist = Math.abs(i - mid) / halfWidth;
      arr[i] = peakVal * (1 - 0.5 * dist * dist);
    }
  }
  return arr;
}

// 宿舍：早高峰大量取车(07:00-08:45)，晚高峰大量还车(17:00-19:00)
const dormitoryPickup = makeProfile([[28, 35, 1.8, 0], [44, 48, 0.6, 0], [68, 76, 0.7, 0]]);
const dormitoryReturn = makeProfile([[68, 76, 1.8, 0], [36, 40, 0.5, 0], [28, 32, 0.3, 0]]);

// 教学楼：早上还车(学生到达)，晚上取车(学生离开)
const academicPickup = makeProfile([[36, 40, 0.5, 0], [48, 52, 0.4, 0], [68, 76, 1.6, 0]]);
const academicReturn = makeProfile([[28, 35, 1.6, 0], [52, 56, 0.6, 0], [44, 48, 0.4, 0]]);

// 食堂：三餐时段峰值，取还对称
const cafeteriaPickup = makeProfile([[24, 28, 0.8, 0], [44, 48, 1.2, 0], [68, 72, 0.9, 0]]);
const cafeteriaReturn = makeProfile([[26, 30, 0.8, 0], [46, 50, 1.2, 0], [70, 74, 0.9, 0]]);

// 图书馆：白天持续积累还车，闭馆时段取车高峰
const libraryPickup = makeProfile([[80, 88, 1.5, 0], [48, 52, 0.4, 0]]);
const libraryReturn = makeProfile([[32, 48, 0.8, 0], [52, 68, 0.9, 0], [28, 32, 0.5, 0]]);

// 运动场：下午晚间峰值(16:00-18:00)
const sportsPickup = makeProfile([[64, 72, 1.2, 0], [76, 80, 0.6, 0]]);
const sportsReturn = makeProfile([[72, 80, 1.2, 0], [64, 68, 0.4, 0]]);

// 大门：早上进入（还车），晚上外出（取车），全天低流量
const gatePickup = makeProfile([[68, 76, 0.8, 0], [80, 88, 0.5, 0]]);
const gateReturn = makeProfile([[28, 36, 0.8, 0], [8, 16, 0.4, 0]]);

export const DEMAND_PROFILES: Record<StationCategory, DemandProfile> = {
  dormitory:         { pickup: dormitoryPickup, return_: dormitoryReturn },
  academic_building: { pickup: academicPickup,  return_: academicReturn },
  cafeteria:         { pickup: cafeteriaPickup,  return_: cafeteriaReturn },
  library:           { pickup: libraryPickup,    return_: libraryReturn },
  sports_field:      { pickup: sportsPickup,     return_: sportsReturn },
  main_gate:         { pickup: gatePickup,       return_: gateReturn },
};

// 类别间亲和度矩阵 (origin → destination)
export const CATEGORY_AFFINITY: Record<StationCategory, Record<StationCategory, number>> = {
  dormitory: {
    dormitory: 0.05, academic_building: 0.35, cafeteria: 0.25,
    library: 0.15, sports_field: 0.10, main_gate: 0.10,
  },
  academic_building: {
    dormitory: 0.35, academic_building: 0.05, cafeteria: 0.20,
    library: 0.20, sports_field: 0.05, main_gate: 0.15,
  },
  cafeteria: {
    dormitory: 0.30, academic_building: 0.25, cafeteria: 0.05,
    library: 0.15, sports_field: 0.10, main_gate: 0.15,
  },
  library: {
    dormitory: 0.30, academic_building: 0.20, cafeteria: 0.20,
    library: 0.05, sports_field: 0.10, main_gate: 0.15,
  },
  sports_field: {
    dormitory: 0.35, academic_building: 0.10, cafeteria: 0.20,
    library: 0.10, sports_field: 0.10, main_gate: 0.15,
  },
  main_gate: {
    dormitory: 0.25, academic_building: 0.20, cafeteria: 0.15,
    library: 0.15, sports_field: 0.10, main_gate: 0.15,
  },
};

// 每个站点每时段的基准骑行次数
export const BASE_RIDES_PER_SLOT: Record<StationCategory, number> = {
  dormitory: 4.0,
  academic_building: 3.0,
  cafeteria: 2.5,
  library: 2.0,
  sports_field: 1.5,
  main_gate: 1.0,
};
