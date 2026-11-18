import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passKeyStatus, passKeyDay, fieldPassKeyDay } from './passKeyStatus.ts';

const TODAY = '2026-11-11';
const job = (facts) => ({ state: 'open', assigneeName: null, dueOn: TODAY, supportRequestedAt: null, ...facts });

test('returnsDoneForAClosedJobEvenWhenItsDayHasPassed', () => {
  assert.equal(passKeyStatus(job({ state: 'resolved', dueOn: '2026-11-01' }), TODAY), 'done');
});

test('returnsNeedsSupportBeforeMissed', () => {
  assert.equal(passKeyStatus(job({ dueOn: '2026-11-10', supportRequestedAt: '2026-11-10T09:00:00Z' }), TODAY), 'needs_support');
});

test('returnsMissedWhenTheCheckInDayHasPassed', () => {
  assert.equal(passKeyStatus(job({ dueOn: '2026-11-10', assigneeName: 'Hafiz' }), TODAY), 'missed');
});

test('returnsAssignedOrNewOnOrBeforeTheCheckInDay', () => {
  assert.equal(passKeyStatus(job({ assigneeName: 'Hafiz' }), TODAY), 'assigned');
  assert.equal(passKeyStatus(job({ assigneeName: '  ', dueOn: '2026-11-12' }), TODAY), 'new');
  assert.equal(passKeyStatus(job({ dueOn: null }), TODAY), 'new');
});

const TOMORROW = '2026-11-12';

test('putsAJobWhoseCheckInIsTomorrowUnderTomorrow', () => {
  assert.equal(passKeyDay(TOMORROW, TOMORROW), 'tomorrow');
});

test('putsTodayMissedUndatedAndLaterUrgentJobsUnderToday', () => {
  assert.equal(passKeyDay(TODAY, TOMORROW), 'today');
  assert.equal(passKeyDay('2026-11-09', TOMORROW), 'today');
  assert.equal(passKeyDay(null, TOMORROW), 'today');
  assert.equal(passKeyDay('2026-11-20', TOMORROW), 'today');
});

test('leavesAMissedJobOffTheTechnicianDayList', () => {
  assert.equal(fieldPassKeyDay(job({ dueOn: '2026-11-09', assigneeName: 'Hafiz' }), TODAY, TOMORROW), null);
});

test('keepsTodayTomorrowUndatedAndSupportJobsOnTheTechnicianDayList', () => {
  assert.equal(fieldPassKeyDay(job({}), TODAY, TOMORROW), 'today');
  assert.equal(fieldPassKeyDay(job({ dueOn: TOMORROW }), TODAY, TOMORROW), 'tomorrow');
  assert.equal(fieldPassKeyDay(job({ dueOn: null }), TODAY, TOMORROW), 'today');
  assert.equal(fieldPassKeyDay(job({ dueOn: '2026-11-09', supportRequestedAt: '2026-11-10T09:00:00Z' }), TODAY, TOMORROW), 'today');
});
