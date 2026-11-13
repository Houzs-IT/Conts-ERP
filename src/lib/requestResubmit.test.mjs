// A withdrawn or rejected request to finance is changed and sent again from My claims, keeping its number (chew, 13 Nov
// 2026: no copy, "just change it and submit again"); one made from utility bills is fixed on Utility bills instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { canResubmit, fixOnUtilityBills, lineDraftOf, wantedOnAgain } = await import('./requestResubmit.ts');

test('a withdrawn or rejected request can be changed and sent again; one finance still has, or paid, cannot', () => {
  for (const status of ['WITHDRAWN', 'REJECTED']) assert.equal(canResubmit({ status }), true, status);
  for (const status of ['SUBMITTED', 'PART_PAID', 'PAID', 'CLOSED']) assert.equal(canResubmit({ status }), false, status);
});

test('a request made from utility bills is fixed on Utility bills, not in My claims', () => {
  assert.equal(canResubmit({ status: 'REJECTED', fromBills: true }), false);
  assert.equal(fixOnUtilityBills({ status: 'REJECTED', fromBills: true }), true);
  assert.equal(fixOnUtilityBills({ status: 'WITHDRAWN', fromBills: true }), true);
  assert.equal(fixOnUtilityBills({ status: 'SUBMITTED', fromBills: true }), false);
  assert.equal(fixOnUtilityBills({ status: 'REJECTED' }), false);
});

test('a saved line comes back into the form as it was: a job, a unit, a project or nothing, with its amount and words', () => {
  const line = { unitId: null, maintenanceIssueId: null, projectId: null, amountSen: 5000, description: null };
  assert.deepEqual(lineDraftOf({ ...line, maintenanceIssueId: 'M1', unitId: 'U1', description: 'Tap' }),
    { where: 'job', unitId: 'U1', jobId: 'M1', projectId: '', amountSen: 5000, description: 'Tap' });
  assert.deepEqual(lineDraftOf({ ...line, unitId: 'U1' }), { where: 'unit', unitId: 'U1', jobId: '', projectId: '', amountSen: 5000, description: '' });
  assert.deepEqual(lineDraftOf({ ...line, projectId: 7 }), { where: 'project', unitId: '', jobId: '', projectId: '7', amountSen: 5000, description: '' });
  assert.deepEqual(lineDraftOf(line), { where: 'none', unitId: '', jobId: '', projectId: '', amountSen: 5000, description: '' });
});

test('a pay-by date already past is not offered again', () => {
  assert.equal(wantedOnAgain('2026-11-20', '2026-11-13'), '2026-11-20');
  assert.equal(wantedOnAgain('2026-11-13', '2026-11-13'), '2026-11-13');
  assert.equal(wantedOnAgain('2026-11-01', '2026-11-13'), '');
  assert.equal(wantedOnAgain(null, '2026-11-13'), '');
});

// Review, 13 Nov 2026: a request sent again keeps its old reason as a record; once it is with finance (or paid) again it
// reads "Rejected before", not as a rejection now, on the person's own screen as on finance's list.
test('a rejection reason reads as the reason now while rejected or closed, and as "Rejected before" once sent again', async () => {
  const { reasonNote } = await import('./requestResubmit.ts');
  assert.deepEqual(reasonNote({ status: 'REJECTED', reason: 'Wrong amount', decidedBy: 'Chew' }), { text: 'Wrong amount', now: true });
  assert.deepEqual(reasonNote({ status: 'CLOSED', reason: 'Supplier gave a discount', decidedBy: 'Chew' }), { text: 'Supplier gave a discount', now: true });
  assert.deepEqual(reasonNote({ status: 'SUBMITTED', reason: 'Wrong amount', decidedBy: 'Chew' }), { text: 'Rejected before by Chew: Wrong amount', now: false });
  assert.deepEqual(reasonNote({ status: 'PAID', reason: 'Wrong amount' }), { text: 'Rejected before: Wrong amount', now: false });
  assert.equal(reasonNote({ status: 'SUBMITTED', reason: null }), null);
});
