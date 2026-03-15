import type { StationCategory } from '../types/station';

/**
 * Adaptive station color based on relative bike availability.
 *
 * When `globalMeanRatio` is provided, the color is computed relative to the
 * system-wide average — a station is "good" when it is near or above the
 * mean, and "bad" when it is significantly below the mean.  This prevents
 * all markers from turning red when total bike supply is intentionally low.
 *
 * `normalizedRatio` maps the raw ratio into a [0, 1] range centred on the
 * global mean, so the full colour palette is always used.
 */
export function bikeRatioColor(ratio: number, globalMeanRatio?: number): string {
  const effective = globalMeanRatio !== undefined && globalMeanRatio > 0
    ? normalizeRatio(ratio, globalMeanRatio)
    : ratio;

  if (effective > 0.8) return '#3b82f6';  // 蓝色 - 相对过剩
  if (effective >= 0.6) return '#22c55e'; // 绿色 - 相对充足
  if (effective >= 0.3) return '#eab308'; // 黄色 - 适中
  return '#ef4444';                       // 红色 - 相对紧缺
}

export function bikeRatioLabel(ratio: number, globalMeanRatio?: number): string {
  const effective = globalMeanRatio !== undefined && globalMeanRatio > 0
    ? normalizeRatio(ratio, globalMeanRatio)
    : ratio;

  if (effective > 0.8) return '过剩';
  if (effective >= 0.6) return '充足';
  if (effective >= 0.3) return '适中';
  return '紧缺';
}

/**
 * Normalise `ratio` relative to `mean` so that:
 *   - ratio == 0         → ~0.0
 *   - ratio == mean      → 0.5
 *   - ratio >= 2 * mean  → ~1.0
 *
 * This ensures the colour palette is evenly distributed regardless of
 * absolute bike supply.
 */
function normalizeRatio(ratio: number, mean: number): number {
  if (mean <= 0) return ratio;
  // Clamp ratio/mean to [0, 2] and scale to [0, 1]
  const relative = ratio / mean;
  return Math.min(1, Math.max(0, relative * 0.5));
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
