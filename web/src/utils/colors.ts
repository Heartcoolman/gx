import type { StationCategory } from '../types/station';

// 站点状态颜色
export function bikeRatioColor(ratio: number): string {
  if (ratio > 0.8) return '#3b82f6';  // 蓝色 - 过剩
  if (ratio >= 0.6) return '#22c55e'; // 绿色 - 充足
  if (ratio >= 0.3) return '#eab308'; // 黄色 - 适中
  return '#ef4444';                    // 红色 - 紧缺
}

export function bikeRatioLabel(ratio: number): string {
  if (ratio > 0.8) return '过剩';
  if (ratio >= 0.6) return '充足';
  if (ratio >= 0.3) return '适中';
  return '紧缺';
}

export const CATEGORY_COLORS: Record<StationCategory, string> = {
  dormitory: '#8b5cf6',
  academic_building: '#3b82f6',
  cafeteria: '#f97316',
  library: '#06b6d4',
  sports_field: '#22c55e',
  main_gate: '#6b7280',
};

export const VEHICLE_COLORS = ['#ef4444', '#3b82f6', '#22c55e'] as const;
