// node --test src/lib/leave.test.mjs. Leave rules in functions/_lib/leaveRules.ts (migration 0164), ported from Hookka.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { calendarDays, serviceYears, chargeableDays, allowanceDays, balance, leaveRequest, holidayList, parseHolidays } = await import('../../functions/_lib/leaveRules.ts');

const noOwn = { annualLeaveDays: null, medicalLeaveDays: null };

test('calendar span is inclusive and crosses months', () => {
  assert.equal(calendarDays('2026-10-26', '2026-10-26'), 1);
  assert.equal(calendarDays('2026-10-30', '2026-11-02'), 4);
});

test('years of service count whole years only', () => {
  assert.equal(serviceYears('2024-10-27', '2026-10-26'), 1);
  assert.equal(serviceYears('2024-10-26', '2026-10-26'), 2);
  assert.equal(serviceYears(null, '2026-10-26'), null);
  assert.equal(serviceYears('2027-01-01', '2026-10-26'), 0);
});

test('Employment Act tiers unless the record sets its own number', () => {
  assert.equal(allowanceDays('annual', { joinDate: '2026-01-01', ...noOwn }, '2026-10-26'), 8);
  assert.equal(allowanceDays('annual', { joinDate: '2024-01-01', ...noOwn }, '2026-10-26'), 12);
  assert.equal(allowanceDays('annual', { joinDate: '2020-01-01', ...noOwn }, '2026-10-26'), 16);
  assert.equal(allowanceDays('medical', { joinDate: '2024-01-01', ...noOwn }, '2026-10-26'), 18);
  assert.equal(allowanceDays('medical', { joinDate: null, ...noOwn }, '2026-10-26'), 14);
  assert.equal(allowanceDays('annual', { joinDate: '2020-01-01', annualLeaveDays: 10, medicalLeaveDays: null }, '2026-10-26'), 10);
  assert.equal(allowanceDays('annual', { joinDate: '2020-01-01', annualLeaveDays: 0, medicalLeaveDays: null }, '2026-10-26'), 0);
});

test('public holidays inside a request are not charged', () => {
  const hols = [{ date: '2026-08-31', name: 'Hari Merdeka' }, { date: '2026-09-16', name: 'Hari Malaysia' }];
  assert.equal(chargeableDays({ startDate: '2026-08-30', endDate: '2026-09-01', days: 3 }, hols), 2);
  assert.equal(chargeableDays({ startDate: '2026-08-31', endDate: '2026-08-31', days: 1 }, hols), 0);
});

test('balance: approved counts, pending apart, other years and types ignored, overdraw shown', () => {
  const e = { joinDate: '2026-01-01', ...noOwn };
  const leaves = [
    { type: 'annual', status: 'approved', startDate: '2026-03-02', endDate: '2026-03-06', days: 5 },
    { type: 'annual', status: 'approved', startDate: '2026-12-30', endDate: '2027-01-02', days: 4 },
    { type: 'annual', status: 'pending', startDate: '2026-11-02', endDate: '2026-11-03', days: 2 },
    { type: 'annual', status: 'rejected', startDate: '2026-05-04', endDate: '2026-05-08', days: 5 },
    { type: 'annual', status: 'approved', startDate: '2025-12-29', endDate: '2025-12-31', days: 3 },
    { type: 'medical', status: 'approved', startDate: '2026-04-01', endDate: '2026-04-01', days: 1 },
  ];
  assert.deepEqual(balance('annual', e, leaves, 2026, [], '2026-10-26'), { type: 'annual', year: 2026, allowance: 8, used: 9, pending: 2, left: -1 });
  assert.equal(balance('medical', e, leaves, 2026, [], '2026-10-26').left, 13);
});

test('a request must be in order and at most 60 days', () => {
  assert.equal(leaveRequest.safeParse({ type: 'annual', startDate: '2026-10-27', endDate: '2026-10-28' }).success, true);
  const back = leaveRequest.safeParse({ type: 'annual', startDate: '2026-10-28', endDate: '2026-10-27' });
  assert.equal(back.success, false);
  assert.equal(back.error.issues[0].path[0], 'endDate');
  assert.equal(leaveRequest.safeParse({ type: 'annual', startDate: '2026-01-01', endDate: '2026-03-15' }).success, false);
  assert.equal(leaveRequest.safeParse({ type: 'holiday', startDate: '2026-10-27', endDate: '2026-10-27' }).success, false);
});

test('holiday list: sorted, one per date; a broken stored list fails loud', () => {
  const ok = holidayList.parse([{ date: '2026-12-25', name: 'Christmas' }, { date: '2026-08-31', name: 'Merdeka' }]);
  assert.deepEqual(ok.map(h => h.date), ['2026-08-31', '2026-12-25']);
  assert.equal(holidayList.safeParse([{ date: '2026-08-31', name: 'A' }, { date: '2026-08-31', name: 'B' }]).success, false);
  assert.deepEqual(parseHolidays(null), []);
  assert.throws(() => parseHolidays('[{"date":"31-08-2026","name":"x"}]'), /not valid/);
});
