import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passKeyStatus } from './passKeyStatus.ts';

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
