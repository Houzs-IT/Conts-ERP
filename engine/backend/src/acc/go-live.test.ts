/* Renovation contracts go live the day after AutoCount's cut-over (chew, 17 Nov 2026). */
import { describe, expect, test } from 'vitest';
import { goLiveOf, nextDay } from './go-live';

describe('the renovation go-live day', () => {
  test('the day after the cut-over when it is later than the ledger start', () => {
    expect(goLiveOf({ ledger_start_date: '2026-09-01', documents_cutover_date: '2026-11-16' })).toBe('2026-11-17');
  });
  test('the ledger start when there is no cut-over, or it is earlier', () => {
    expect(goLiveOf({ ledger_start_date: '2026-09-01', documents_cutover_date: null })).toBe('2026-09-01');
    expect(goLiveOf({ ledger_start_date: '2026-09-01', documents_cutover_date: '2026-08-20' })).toBe('2026-09-01');
    expect(goLiveOf(null)).toBeNull();
  });
  test('the next day crosses a month', () => {
    expect(nextDay('2026-11-30')).toBe('2026-12-01');
  });
});
