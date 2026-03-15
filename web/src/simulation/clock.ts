import type { DayKind } from '../types/time';
import { SLOTS_PER_DAY } from '../types/time';
import { SLOT_DURATION_MS } from '../data/constants';

export class VirtualClock {
  /** Virtual time elapsed since midnight, in milliseconds */
  private elapsedMs = 0;
  dayKind: DayKind;

  constructor(dayKind: DayKind = 'weekday') {
    this.dayKind = dayKind;
  }

  /** Advance clock by delta virtual milliseconds */
  tick(deltaVirtualMs: number): void {
    this.elapsedMs += deltaVirtualMs;
    // Wrap at 24 hours
    const dayMs = SLOTS_PER_DAY * SLOT_DURATION_MS;
    if (this.elapsedMs >= dayMs) {
      this.elapsedMs %= dayMs;
    }
  }

  get slotIndex(): number {
    return Math.floor(this.elapsedMs / SLOT_DURATION_MS) % SLOTS_PER_DAY;
  }

  get timeSlot() {
    return { day_kind: this.dayKind, slot_index: this.slotIndex };
  }

  get hour(): number {
    return Math.floor(this.slotIndex / 60);
  }

  get minute(): number {
    return this.slotIndex % 60;
  }

  /** Progress within the current slot, 0..1 */
  get slotProgress(): number {
    return (this.elapsedMs % SLOT_DURATION_MS) / SLOT_DURATION_MS;
  }

  get totalElapsedMs(): number {
    return this.elapsedMs;
  }

  /** ISO string for the virtual time (using today's date) */
  toISO(): string {
    const now = new Date();
    now.setHours(this.hour, this.minute, 0, 0);
    return now.toISOString();
  }

  reset(dayKind?: DayKind): void {
    this.elapsedMs = 0;
    if (dayKind) this.dayKind = dayKind;
  }
}
