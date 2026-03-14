import type { Station, StationCategory } from '../types/station';

// 南昌理工学院校园站点
// 校园范围: 南28.7823~北28.7927, 西115.8490~东115.8668
// 校园中心: 28.7875°N, 115.8579°E
export const STATIONS: Station[] = [
  // 宿舍区 (0-3) - 校园南部
  { id: 0, name: '东区宿舍A', category: 'dormitory', capacity: 30, latitude: 28.7838, longitude: 115.8590 },
  { id: 1, name: '东区宿舍B', category: 'dormitory', capacity: 30, latitude: 28.7843, longitude: 115.8615 },
  { id: 2, name: '西区宿舍A', category: 'dormitory', capacity: 30, latitude: 28.7840, longitude: 115.8545 },
  { id: 3, name: '西区宿舍B', category: 'dormitory', capacity: 30, latitude: 28.7835, longitude: 115.8520 },
  // 教学区 (4-7) - 校园中北部
  { id: 4, name: '第一教学楼', category: 'academic_building', capacity: 25, latitude: 28.7885, longitude: 115.8560 },
  { id: 5, name: '第二教学楼', category: 'academic_building', capacity: 25, latitude: 28.7890, longitude: 115.8590 },
  { id: 6, name: '实验楼', category: 'academic_building', capacity: 25, latitude: 28.7895, longitude: 115.8540 },
  { id: 7, name: '实训中心', category: 'academic_building', capacity: 25, latitude: 28.7900, longitude: 115.8620 },
  // 食堂 (8-9) - 宿舍与教学区之间
  { id: 8, name: '第一食堂', category: 'cafeteria', capacity: 20, latitude: 28.7860, longitude: 115.8555 },
  { id: 9, name: '第二食堂', category: 'cafeteria', capacity: 20, latitude: 28.7862, longitude: 115.8600 },
  // 图书馆 (10) - 校园中心
  { id: 10, name: '图书馆', category: 'library', capacity: 20, latitude: 28.7875, longitude: 115.8578 },
  // 运动场 (11-12) - 校园西侧
  { id: 11, name: '体育馆', category: 'sports_field', capacity: 15, latitude: 28.7870, longitude: 115.8505 },
  { id: 12, name: '运动场', category: 'sports_field', capacity: 15, latitude: 28.7880, longitude: 115.8498 },
  // 大门 (13-14) - 校园边缘
  { id: 13, name: '南大门', category: 'main_gate', capacity: 15, latitude: 28.7825, longitude: 115.8575 },
  { id: 14, name: '北大门', category: 'main_gate', capacity: 15, latitude: 28.7922, longitude: 115.8580 },
];

export const STATION_MAP = new Map(STATIONS.map(s => [s.id, s]));

export const CATEGORY_STATIONS: Record<StationCategory, number[]> = {
  dormitory: [0, 1, 2, 3],
  academic_building: [4, 5, 6, 7],
  cafeteria: [8, 9],
  library: [10],
  sports_field: [11, 12],
  main_gate: [13, 14],
};
