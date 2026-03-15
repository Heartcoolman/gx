// Mirror of Rust DayKind, TimeSlot

export type DayKind = 'weekday' | 'saturday' | 'sunday' | 'holiday' | 'exam_period';

export interface TimeSlot {
  day_kind: DayKind;
  slot_index: number; // 0..1440
}

export const SLOTS_PER_DAY = 1440;
export const SLOT_MINUTES = 1;

export function slotToTime(slotIndex: number): string {
  const hour = Math.floor(slotIndex / 60);
  const minute = slotIndex % 60;
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
}

export function timeToSlot(hour: number, minute: number): number {
  return hour * 60 + minute;
}

export const DAY_KIND_LABELS: Record<DayKind, string> = {
  weekday: '工作日',
  saturday: '周六',
  sunday: '周日',
  holiday: '节假日',
  exam_period: '考试周',
};
