import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onOpenTab, openOrder, isOffDayPassKey } from './maintenanceOrder.ts';

const TOMORROW = '2026-11-13';
const job = (facts) => ({
  state: 'open', urgency: 'normal', jobType: 'normal', dueOn: null, reportedAt: '2026-11-01T02:00:00Z',
  ownerApprovalRequired: false, ownerApprovedAt: null, chargeTo: 'owner', endedAt: null, supportRequestedAt: null, ...facts,
});

test('keepsFinishedJobsAndJobsWaitingForTheirOwnerOffTheOpenTab', () => {
  assert.equal(onOpenTab(job({ state: 'resolved' }), TOMORROW), false);
  assert.equal(onOpenTab(job({ ownerApprovalRequired: true }), TOMORROW), false);
  assert.equal(onOpenTab(job({ ownerApprovalRequired: true, chargeTo: 'the_conts' }), TOMORROW), true);
});

test('holdsBackAPassKeyForADayAfterTomorrowUnlessItIsUrgent', () => {
  assert.equal(isOffDayPassKey(job({ jobType: 'pass_key', dueOn: '2026-11-14' }), TOMORROW), true);
  assert.equal(isOffDayPassKey(job({ jobType: 'pass_key', dueOn: TOMORROW }), TOMORROW), false);
  assert.equal(isOffDayPassKey(job({ jobType: 'pass_key', dueOn: '2026-11-14', urgency: 'urgent' }), TOMORROW), false);
});

test('ordersUrgentThenPassKeyThenNormalByDueDayThenReported', () => {
  const rows = [
    job({ id: 'n-late', dueOn: '2026-11-20' }),
    job({ id: 'n-early', reportedAt: '2026-11-05T01:00:00Z' }),
    job({ id: 'pk', jobType: 'pass_key', dueOn: TOMORROW }),
    job({ id: 'u', jobType: 'urgent', urgency: 'urgent' }),
    job({ id: 'n-first', reportedAt: '2026-11-05T00:00:00Z' }),
  ];
  assert.deepEqual(rows.sort(openOrder).map(r => r.id), ['u', 'pk', 'n-first', 'n-early', 'n-late']);
});
