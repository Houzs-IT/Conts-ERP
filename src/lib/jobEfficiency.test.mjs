// node --test src/lib/jobEfficiency.test.mjs. Card minutes against Start to Done, for Employee Performance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { minutesBetween, totalJobs } from '../../functions/_lib/jobEfficiency.ts';

test('minutesBetween reads Malaysian and UTC stamps alike', () => {
  assert.equal(minutesBetween('2026-11-10T09:00:00+08:00', '2026-11-10T01:45:00Z'), 45);
});

test('minutesBetween is null without both stamps or with the end before the start', () => {
  assert.equal(minutesBetween(null, '2026-11-10T10:00:00+08:00'), null);
  assert.equal(minutesBetween('2026-11-10T10:00:00+08:00', null), null);
  assert.equal(minutesBetween('not a time', '2026-11-10T10:00:00+08:00'), null);
  assert.equal(minutesBetween('2026-11-10T10:00:00+08:00', '2026-11-10T09:00:00+08:00'), null);
});

test('returnsNoEfficiencyWhileEveryCardIsZero', () => {
  const totals = totalJobs([{ cardMinutes: 0, actualMinutes: 50 }, { cardMinutes: 0, actualMinutes: null }]);
  assert.deepEqual(totals, { jobs: 2, cardMinutes: 0, actualMinutes: 50, untimedJobs: 1, efficiencyPercent: null, minutesOverCard: null });
});

test('comparesOnlyTimedJobsWhoseCardIsSet', () => {
  const totals = totalJobs([
    { cardMinutes: 60, actualMinutes: 45 },
    { cardMinutes: 30, actualMinutes: 45 },
    { cardMinutes: 60, actualMinutes: null },
    { cardMinutes: 0, actualMinutes: 20 },
  ]);
  assert.equal(totals.jobs, 4);
  assert.equal(totals.cardMinutes, 150);
  assert.equal(totals.actualMinutes, 110);
  assert.equal(totals.untimedJobs, 1);
  assert.equal(totals.efficiencyPercent, 100);
  assert.equal(totals.minutesOverCard, 0);
});

test('reportsLateWhenActualRunsOverTheCard', () => {
  const totals = totalJobs([{ cardMinutes: 40, actualMinutes: 50 }]);
  assert.equal(totals.efficiencyPercent, 80);
  assert.equal(totals.minutesOverCard, 10);
});

test('returnsZeroTotalsForNoJobs', () => {
  assert.deepEqual(totalJobs([]), { jobs: 0, cardMinutes: 0, actualMinutes: 0, untimedJobs: 0, efficiencyPercent: null, minutesOverCard: null });
});
