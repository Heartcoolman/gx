import { slotToTime } from '../types/time';

export function formatSlotTime(slotIndex: number): string {
  return slotToTime(slotIndex);
}

export function formatNumber(n: number, decimals = 0): string {
  return n.toFixed(decimals);
}

export function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}分钟`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}小时${m}分钟` : `${h}小时`;
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}米`;
  return `${(meters / 1000).toFixed(1)}公里`;
}
