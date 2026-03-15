// Mirror of Rust StationCategory, StationId, Station, StationStatus

export type StationCategory =
  | 'academic_building'
  | 'dormitory'
  | 'cafeteria'
  | 'library'
  | 'sports_field'
  | 'main_gate';

export interface Station {
  id: number;
  name: string;
  category: StationCategory;
  capacity: number;
  latitude: number;
  longitude: number;
}

export interface StationStatus {
  station_id: number;
  available_bikes: number;
  available_docks: number;
  timestamp: number; // Unix timestamp in seconds (serde ts_seconds)
  broken_bikes?: number;
  maintenance_bikes?: number;
}

export const CATEGORY_LABELS: Record<StationCategory, string> = {
  dormitory: '宿舍区',
  academic_building: '教学区',
  cafeteria: '食堂',
  library: '图书馆',
  sports_field: '运动场',
  main_gate: '大门',
};

export const CATEGORY_ORDER: StationCategory[] = [
  'dormitory',
  'academic_building',
  'cafeteria',
  'library',
  'sports_field',
  'main_gate',
];
