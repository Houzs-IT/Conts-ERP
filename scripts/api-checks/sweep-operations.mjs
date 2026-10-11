// Operations click-sweep fixes (11 Oct 2026): guest out only on the day, a later repair block leaves the unit as it is,
// checklist items not doubled, a part draw shows on the job's history.
// Runs against the seeded database (default user) or a real-data one: CHECK_USER_ID / CHECK_USER_EMAIL name a management user there.
import { callAsUser, check, done } from './harness.mjs';

const me = { userId: process.env.CHECK_USER_ID ?? '11111111-1111-4111-8111-000000000002', email: process.env.CHECK_USER_EMAIL ?? 'management@theconts.com', role: 'management', fullName: 'Sweep check' };
const call = (m, p, b) => callAsUser(me, m, p, b);
const myt = (d = 0) => new Date(Date.now() + 8 * 3600e3 + d * 864e5).toISOString().slice(0, 10);

// 1. Guest out for a stay that ends tomorrow is refused.
let r = await call('GET', `/api/operations/day?date=${myt(1)}`);
check('tomorrow loads', r.status === 200, r.text.slice(0, 200));
const leaver = r.json?.departures?.find(d => d.state === 'checked_in' || d.state === 'confirmed');
if (leaver) {
  r = await call('POST', '/api/housekeeping/guest-left', { reservationId: leaver.reservationId });
  check('guest out for tomorrow refused (409 NOT_YET)', r.status === 409 && r.json?.error?.code === 'NOT_YET', r.text);
  r = await call('GET', `/api/operations/day?date=${myt(1)}`);
  check('the booking is still not checked out', r.json.departures.find(d => d.reservationId === leaver.reservationId)?.state !== 'checked_out', '');
} else console.log('skip guest-out check: nobody leaves tomorrow in this data');

// 2. A repair block that starts next month does not put the unit under repair today; closing the job gives the nights back.
r = await call('GET', '/api/units');
const units = r.json?.data ?? [];
const unit = units.find(u => u.readiness === 'ready') ?? units[0];
r = await call('POST', '/api/maintenance/issues', { unitId: unit.id, title: 'Sweep check: later block', category: 'other', chargeTo: 'the_conts' });
check('job opened', r.status === 201, r.text); const issueId = r.json?.id;
const before = unit.readiness;
let from = myt(40), to = myt(41);
r = await call('POST', '/api/blocks', { unitId: unit.id, from, to, reason: 'Maintenance: Sweep check', issueId });
if (r.status === 409) { from = myt(200); to = myt(201); r = await call('POST', '/api/blocks', { unitId: unit.id, from, to, reason: 'Maintenance: Sweep check', issueId }); }
check('later block made', r.status === 201, r.text);
r = await call('GET', '/api/units');
check('unit readiness unchanged by a later block', r.json.data.find(u => u.id === unit.id)?.readiness === before, `${before} -> ${r.json.data.find(u => u.id === unit.id)?.readiness}`);

// 3. A part drawn from stock shows on the job's history.
const code = `SWP-${Date.now().toString(36).toUpperCase()}`;
r = await call('POST', '/api/maintenance/skus', { code, name: 'Sweep part', category: 'general', unitLabel: 'unit', defaultPrice: 1000, trackStock: true, stockOnHand: 2 });
check('stocked part added', r.status === 201, r.text);
r = await call('POST', '/api/maintenance/skus', { code, name: 'Same code', category: 'general', unitLabel: 'unit', defaultPrice: 1000 });
check('same code refused (409)', r.status === 409, r.text);
r = await call('GET', '/api/maintenance/skus');
const sku = r.json.data.find(s => s.code === code);
r = await call('POST', `/api/maintenance/issues/${issueId}/exchange`, { skuId: sku.id, qty: 3 });
check('drawing more than in stock refused', r.status === 409, r.text);
r = await call('POST', `/api/maintenance/issues/${issueId}/exchange`, { skuId: sku.id, qty: 2 });
check('draw 2 of 2', r.status === 201 && r.json.stockOnHand === 0, r.text);
r = await call('POST', `/api/maintenance/issues/${issueId}/exchange`, { skuId: sku.id, qty: 1 });
check('nothing left to draw', r.status === 409, r.text);
r = await call('GET', `/api/audit?entityTable=maintenance_issues&entityId=${issueId}`);
check('draw is on the job history', r.json?.data?.some(e => e.action === 'maintenance.exchange' && e.after?.quantity === 2), r.text.slice(0, 300));

r = await call('POST', `/api/maintenance/issues/${issueId}/complete`, { finalAmount: 0 });
check('job closed', r.status === 200, r.text);
check('later block given back on close', (r.json?.blocksReleased ?? 0) >= 1, r.text);

// 4. The same checklist item cannot be added twice.
r = await call('GET', `/api/housekeeping/board?date=${myt(0)}`);
const clean = r.json?.rows?.find(x => x.status !== 'done');
if (clean) {
  const label = `Sweep item ${Date.now()}`;
  r = await call('POST', `/api/housekeeping/tasks/${clean.id}/checklist`, { label });
  check('checklist item added', r.status === 201, r.text);
  r = await call('POST', `/api/housekeeping/tasks/${clean.id}/checklist`, { label: label.toUpperCase() });
  check('same item again refused (409)', r.status === 409 && r.json?.error?.code === 'DUPLICATE', r.text);
} else console.log('skip checklist check: no open clean today');

done();
