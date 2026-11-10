import { afterEach, describe, expect, test, vi } from 'vitest';
import { todayMyt } from './dates';

/* `new Date().toISOString().slice(0, 10)` is the UTC day, so before 08:00 in
   Malaysia every "today" default read as yesterday. */
describe('todayMyt', () => {
  afterEach(() => { vi.useRealTimers(); });

  test('07:30 Malaysia time is still today, not yesterday', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-07T23:30:00Z')); // 2026-11-08 07:30 MYT
    expect(new Date().toISOString().slice(0, 10)).toBe('2026-11-07');
    expect(todayMyt()).toBe('2026-11-08');
  });

  test('late evening stays on the same day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-08T15:59:00Z')); // 23:59 MYT
    expect(todayMyt()).toBe('2026-11-08');
    expect(todayMyt(-1)).toBe('2026-11-07');
  });
});
