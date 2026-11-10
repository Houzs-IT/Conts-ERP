/* Worker actual hours (TODO item 16): the sums, the budget comparison, and the checks on a typed entry. */
import { describe, expect, it } from 'vitest';
import { checkEntryTimes, entryMinutes, hoursOf, MAX_ENTRY_MINUTES, overlaps, stopTimeFor, summarizeHours, type TimeEntry } from './production-hours';

const NOW = new Date('2026-11-10T10:00:00Z');
const e = (id: string, person: string, start: string, stop: string | null): TimeEntry => ({ id, person_key: person, name: person.toUpperCase(), started_at: start, stopped_at: stop });

describe('entryMinutes', () => {
  it('counts a stopped entry and a running one up to now', () => {
    expect(entryMinutes(e('1', 'a', '2026-11-10T08:00:00Z', '2026-11-10T09:30:00Z'), NOW)).toBe(90);
    expect(entryMinutes(e('2', 'a', '2026-11-10T09:15:00Z', null), NOW)).toBe(45);
  });
  it('reads nought for a broken entry rather than a negative', () => {
    expect(entryMinutes(e('3', 'a', '2026-11-10T09:00:00Z', '2026-11-10T08:00:00Z'), NOW)).toBe(0);
    expect(entryMinutes(e('4', 'a', 'not a date', null), NOW)).toBe(0);
  });
});

describe('summarizeHours — actual against the budget', () => {
  const entries = [
    e('1', 'ali', '2026-11-09T01:00:00Z', '2026-11-09T09:00:00Z'), // 8 h
    e('2', 'ali', '2026-11-10T09:00:00Z', null),                   // 1 h, running
    e('3', 'mei', '2026-11-09T02:00:00Z', '2026-11-09T05:30:00Z'), // 3.5 h
  ];
  it('adds every entry, per person, and counts who is on the clock', () => {
    const s = summarizeHours(entries, 10, NOW);
    expect(s.actualMinutes).toBe(750);
    expect(s.running).toBe(1);
    expect(s.people).toEqual([
      { personKey: 'ali', name: 'ALI', minutes: 540, running: true, entries: 2 },
      { personKey: 'mei', name: 'MEI', minutes: 210, running: false, entries: 1 },
    ]);
  });
  it('says over budget by how much; under budget is a negative variance', () => {
    expect(summarizeHours(entries, 10, NOW)).toMatchObject({ budgetMinutes: 600, varianceMinutes: 150, overBudget: true });
    expect(summarizeHours(entries, 20, NOW)).toMatchObject({ budgetMinutes: 1200, varianceMinutes: -450, overBudget: false });
  });
  it('without a budget there is no variance and never "over"', () => {
    expect(summarizeHours(entries, null, NOW)).toMatchObject({ budgetMinutes: null, varianceMinutes: null, overBudget: false });
  });
  it('hours read with one decimal, as the budget is typed', () => {
    expect(hoursOf(750)).toBe(12.5);
    expect(hoursOf(100)).toBe(1.7);
  });
});

describe('checkEntryTimes — an entry typed by hand', () => {
  it('takes a real start and stop, the stop after the start', () => {
    expect(checkEntryTimes('2026-11-10T01:00:00Z', '2026-11-10T03:00:00Z', NOW)).toEqual({ ok: true, startedAt: '2026-11-10T01:00:00.000Z', stoppedAt: '2026-11-10T03:00:00.000Z' });
  });
  it('refuses a missing time, a stop before the start, a future stop, an overlong entry', () => {
    expect(checkEntryTimes(undefined, '2026-11-10T03:00:00Z', NOW)).toMatchObject({ ok: false });
    expect(checkEntryTimes('2026-11-10T03:00:00Z', '2026-11-10T03:00:00Z', NOW)).toMatchObject({ ok: false, message: 'The stop time must be after the start time.' });
    expect(checkEntryTimes('2026-11-10T09:00:00Z', '2026-11-10T12:00:00Z', NOW)).toMatchObject({ ok: false, message: 'The stop time is in the future.' });
    expect(checkEntryTimes('2026-11-08T00:00:00Z', '2026-11-09T00:00:00Z', NOW)).toMatchObject({ ok: false });
  });
});

describe('stopTimeFor — a timer left on overnight', () => {
  it('stops now when within the limit', () => {
    expect(stopTimeFor('2026-11-10T08:00:00Z', NOW)).toEqual({ stoppedAt: NOW.toISOString(), capped: false });
  });
  it('stops at the limit, and says so, when the timer ran past it', () => {
    const r = stopTimeFor('2026-11-09T08:00:00Z', NOW);
    expect(r.capped).toBe(true);
    expect(Date.parse(r.stoppedAt) - Date.parse('2026-11-09T08:00:00Z')).toBe(MAX_ENTRY_MINUTES * 60_000);
  });
});

describe('overlaps — the same hour is not worked twice on one order', () => {
  const list = [e('1', 'ali', '2026-11-10T01:00:00Z', '2026-11-10T03:00:00Z'), e('2', 'mei', '2026-11-10T01:00:00Z', null)];
  it('finds a clash of the same person only', () => {
    expect(overlaps(list, 'ali', '2026-11-10T02:00:00Z', '2026-11-10T04:00:00Z', null, NOW)?.id).toBe('1');
    expect(overlaps(list, 'ali', '2026-11-10T03:00:00Z', '2026-11-10T04:00:00Z', null, NOW)).toBeNull();
    expect(overlaps(list, 'mei', '2026-11-10T05:00:00Z', '2026-11-10T06:00:00Z', null, NOW)?.id).toBe('2');
  });
  it('ignores the entry being edited', () => {
    expect(overlaps(list, 'ali', '2026-11-10T01:30:00Z', '2026-11-10T02:30:00Z', '1', NOW)).toBeNull();
  });
});
