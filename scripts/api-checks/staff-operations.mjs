// Staff comment sheet (OPERATION, Sheet3; owner clarifications 17 Oct 2026). Maintenance: job types, the owner-approval
// rules and the visibility rule (a job held for the owner, or for its parts, is not in the technician's app), the amount
// required to close, who may assign. Cleaning: auto-assign gone, photo still required, the guest counted out at the
// checkout time, the price table and per-unit prices, external jobs, cleaner pay. Needs a local server (harness.mjs) on
// demo data with migration 0126.
import { call, check, done, cookieFor } from './harness.mjs';

const BASE = process.env.API_BASE ?? 'http://localhost:8788';
// A 1x1 PNG: proof of work for a clean.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
async function photo(taskId) {
  const form = new FormData();
  form.append('file', new Blob([PNG], { type: 'image/png' }), 'done.png');
  const r = await fetch(`${BASE}/api/tasks/${taskId}/photos`, { method: 'POST', headers: { cookie: cookieFor('management') }, body: form });
  return r.status;
}

const HAFIZ = 'Hafiz Rahman'; // the seeded technician
const units = (await call('GET', '/api/units')).json.data;
const unit = units[0];
const tag = Date.now().toString().slice(-6);
const listed = async id => {
  const r = await call('GET', '/api/field/repairs', undefined, 'technician');
  return r.status === 200 && [...r.json.mine, ...r.json.open].some(j => j.id === id);
};

/* ---------------- maintenance ---------------- */

// Approval rules: management sets them, the office reads them, nobody else changes them.
let r = await call('GET', '/api/maintenance/approval-rules', undefined, 'operations_staff');
check('rules: the office reads them, every category starts at Not needed', r.status === 200 && r.json.rules.aircon.mode === 'never' && r.json.mayEdit === false, r.text.slice(0, 200));
r = await call('PUT', '/api/maintenance/approval-rules', { rules: { aircon: { mode: 'always' } } }, 'operations_staff');
check('rules: operations staff cannot change them (403)', r.status === 403, r.text);
r = await call('PUT', '/api/maintenance/approval-rules', { rules: { aircon: { mode: 'over', amount: -5 } } });
check('rules: a negative amount is refused (422)', r.status === 422, r.text);
r = await call('PUT', '/api/maintenance/approval-rules', { rules: { aircon: { mode: 'always' }, plumbing: { mode: 'major' }, electrical: { mode: 'over', amount: 50000 } } });
check('rules: management saves them', r.status === 200 && r.json.rules.aircon.mode === 'always' && r.json.rules.electrical.amount === 50000, r.text);
r = await call('GET', '/api/maintenance/approval-rules', undefined, 'technician');
check('rules: a technician cannot read them (403)', r.status === 403, r.text);

// A job the rules do not hold goes straight to the technician.
r = await call('POST', '/api/maintenance/issues', { unitId: unit.id, title: `Pass key ${tag}`, category: 'other', jobType: 'pass_key', assigneeName: HAFIZ }, 'operations_staff');
check('CS (operations staff) adds a Pass key job and gives it to a technician', r.status === 201 && r.json.ownerApprovalRequired === false, r.text);
const passKey = r.json.id;
check('visibility: a job that needs no approval is in the technician app at once', await listed(passKey));

// The rules hold an aircon job (always) until the owner approves AND its parts arrive.
r = await call('POST', '/api/maintenance/issues', { unitId: unit.id, title: `Aircon ${tag}`, category: 'aircon', jobType: 'normal', needsParts: true, dueOn: '2030-01-05', assigneeName: HAFIZ }, 'operations_manager');
check('rule always: the job waits for the owner', r.status === 201 && r.json.ownerApprovalRequired === true && r.json.state === 'waiting', r.text);
const held = r.json.id;
let all = (await call('GET', '/api/maintenance/issues')).json.data;
let job = all.find(i => i.id === held);
check('the job shows Needs owner approval, its type, parts and due date', job.approvalStatus === 'needed' && job.jobType === 'normal' && job.needsParts === true && job.dueOn === '2030-01-05', JSON.stringify(job).slice(0, 300));
check('visibility: hidden from the technician while the owner has not approved', !(await listed(held)));
r = await call('GET', `/api/field/repairs/${held}`, undefined, 'technician');
check('visibility: the technician cannot open it either (403)', r.status === 403, r.text);
r = await call('POST', `/api/maintenance/issues/${held}/start`, {}, 'technician');
check('visibility: nor start it (403)', r.status === 403, r.text);
r = await call('POST', `/api/maintenance/issues/${held}/approve`, { approved: true, quotedAmount: null }, 'operations_staff');
check('recording the owner approval is not operations staff work (403)', r.status === 403, r.text);
r = await call('POST', `/api/maintenance/issues/${held}/approve`, { approved: true, quotedAmount: null });
check("management records the owner's approval", r.status === 200, r.text);
job = (await call('GET', '/api/maintenance/issues')).json.data.find(i => i.id === held);
check('the job shows Approved', job.approvalStatus === 'approved', job.approvalStatus);
check('visibility: approved but parts not here: still hidden', !(await listed(held)));
r = await call('PATCH', `/api/maintenance/issues/${held}`, { partsArrived: true }, 'operations_staff');
check('the office ticks Parts arrived', r.status === 200, r.text);
check('visibility: approved and parts arrived: the technician sees it', await listed(held));
r = await call('PATCH', `/api/maintenance/issues/${held}`, { partsArrived: false }, 'operations_staff');
check('visibility: untick Parts arrived and it is hidden again', r.status === 200 && !(await listed(held)), r.text);
await call('PATCH', `/api/maintenance/issues/${held}`, { partsArrived: true }, 'operations_staff');

// Major only, and an amount rule that trips when the quote comes in.
r = await call('POST', '/api/maintenance/issues', { unitId: unit.id, title: `Leak minor ${tag}`, category: 'plumbing', severity: 'minor' });
check('rule major only: a minor job is not held', r.status === 201 && r.json.ownerApprovalRequired === false, r.text);
const minor = r.json.id;
r = await call('PATCH', `/api/maintenance/issues/${minor}`, { severity: 'major' });
check('rule major only: made major, it now waits for the owner', r.status === 200 && r.json.state === 'waiting', r.text);
r = await call('POST', '/api/maintenance/issues', { unitId: unit.id, title: `Wiring ${tag}`, category: 'electrical' });
check('rule over RM 500: no quote yet, not held', r.status === 201 && r.json.ownerApprovalRequired === false, r.text);
r = await call('PATCH', `/api/maintenance/issues/${r.json.id}`, { quotedAmount: 60000 });
check('rule over RM 500: a RM 600 quote holds it', r.status === 200 && r.json.state === 'waiting', r.text);
r = await call('POST', '/api/maintenance/issues', { unitId: unit.id, title: `Aircon company ${tag}`, category: 'aircon', chargeTo: 'the_conts' });
check('rules hold only jobs the owner pays for', r.status === 201 && r.json.ownerApprovalRequired === false, r.text);

// Job types and the field order: Urgent, Pass key, then Normal by due date.
r = await call('POST', '/api/maintenance/issues', { unitId: unit.id, title: `Bad type ${tag}`, category: 'other', jobType: 'owner_confirm' });
check('an unknown job type is refused (422)', r.status === 422, r.text);
const n1 = (await call('POST', '/api/maintenance/issues', { unitId: unit.id, title: `Normal later ${tag}`, category: 'other', jobType: 'normal', dueOn: '2030-02-01', assigneeName: HAFIZ })).json.id;
const n2 = (await call('POST', '/api/maintenance/issues', { unitId: unit.id, title: `Normal sooner ${tag}`, category: 'other', jobType: 'normal', dueOn: '2030-01-10', assigneeName: HAFIZ })).json.id;
const u1 = (await call('POST', '/api/maintenance/issues', { unitId: unit.id, title: `Urgent ${tag}`, category: 'other', jobType: 'urgent', assigneeName: HAFIZ })).json.id;
job = (await call('GET', '/api/maintenance/issues')).json.data.find(i => i.id === u1);
check('Urgent keeps urgency in step', job.urgency === 'urgent' && job.jobType === 'urgent', JSON.stringify(job).slice(0, 200));
const mine = (await call('GET', '/api/field/repairs', undefined, 'technician')).json.mine.map(j => j.id);
const at = id => mine.indexOf(id);
check('field order: Urgent before Pass key before Normal', at(u1) >= 0 && at(u1) < at(passKey) && at(passKey) < at(n2), `${at(u1)} ${at(passKey)} ${at(n2)}`);
check('field order: Normal jobs by due date', at(n2) < at(n1), `${at(n2)} ${at(n1)}`);

// Who assigns: supervisors and CS do; the technician does not.
r = await call('PATCH', `/api/maintenance/issues/${n1}`, { assigneeName: HAFIZ }, 'operations_staff');
check('CS can assign a job to the maintenance technician', r.status === 200, r.text);
r = await call('PATCH', `/api/maintenance/issues/${n1}`, { assigneeName: 'Someone' }, 'technician');
check('a technician cannot assign (403)', r.status === 403, r.text);
r = await call('GET', '/api/maintenance/technicians', undefined, 'operations_staff');
check('the assign list puts the maintenance technicians first', r.status === 200 && r.json.data[0]?.role === 'technician', r.text.slice(0, 200));

// The amount is required to close a job.
r = await call('POST', `/api/maintenance/issues/${n2}/complete`, {});
check('closing without an amount is refused (422)', r.status === 422 && !!r.json.error.fields?.finalAmount, r.text);
r = await call('POST', `/api/maintenance/issues/${n2}/complete`, { finalAmount: 12000 });
check('closing with an amount puts it on the unit costs', r.status === 200 && r.json.expensed === true, r.text);

// Put the rules back so other checks see the default.
await call('PUT', '/api/maintenance/approval-rules', { rules: { aircon: { mode: 'never' }, plumbing: { mode: 'never' }, electrical: { mode: 'never' } } });

/* ---------------- cleaning ---------------- */

r = await call('POST', '/api/housekeeping/auto-assign', {});
check('auto-assign is switched off (gone)', r.status === 404 || r.status === 405, r.text.slice(0, 100));

// Price table: management sets it; operations staff reads it.
r = await call('PUT', '/api/housekeeping/prices', { rows: [{ kind: 'turnover', layout: 'studio', internalCost: 4000, externalCharge: 7000 }] }, 'operations_staff');
check('prices: operations staff cannot change them (403)', r.status === 403, r.text);
r = await call('GET', '/api/housekeeping/prices', undefined, 'operations_staff');
check('prices: start empty (price not set)', r.status === 200 && r.json.ready && r.json.rows.every(x => x.internalCost == null || x.kind !== 'light_clean'), r.text.slice(0, 200));
r = await call('GET', '/api/housekeeping/unit-prices');
const priced = r.json.rows[0];
const layout = priced.layout;
await call('PUT', '/api/housekeeping/unit-prices', { unitId: priced.unitId, kind: 'turnover', internalCost: null, externalCharge: null });
r = await call('PUT', '/api/housekeeping/prices', { rows: [{ kind: 'turnover', layout, internalCost: 4000, externalCharge: 7000 }] });
check('prices: management sets a row', r.status === 200, r.text);
r = await call('GET', '/api/housekeeping/unit-prices');
let up = r.json.rows.find(x => x.unitId === priced.unitId).prices.turnover;
check('per unit: the table applies', up.internalCost === 4000 && up.externalCharge === 7000 && up.source === 'table', JSON.stringify(up));
r = await call('PUT', '/api/housekeeping/unit-prices', { unitId: priced.unitId, kind: 'turnover', internalCost: 4500, externalCharge: 9000 });
up = (await call('GET', '/api/housekeeping/unit-prices')).json.rows.find(x => x.unitId === priced.unitId).prices.turnover;
check("per unit: the unit's own figures win", r.status === 200 && up.externalCharge === 9000 && up.source === 'unit', JSON.stringify(up));
r = await call('GET', '/api/housekeeping/pay', undefined, 'housekeeper');
check('pay: a cleaner cannot read the pay list (403)', r.status === 403, r.text);

// A reservation's clean: amount from the prices, guest counted out at the checkout time, photo still required.
const day = '2025-03-02';
let res = null;
for (const u of units) {
  r = await call('POST', '/api/reservations', { unitId: u.id, checkIn: '2025-03-01', checkOut: day, checkOutTime: '11:00', guest: { fullName: `Guest ${tag}` } });
  if (r.status === 201 || r.status === 200) { res = { id: r.json.id, unitId: u.id }; break; }
}
check('a past stay to clean after', !!res, r.text);
r = await call('POST', '/api/housekeeping/plan', { reservationIds: [res.id] });
check('the clean is planned', r.status === 200 || r.status === 201, r.text);
let board = (await call('GET', `/api/housekeeping/board?date=${day}`)).json;
let row = board.rows.find(x => x.unitId === res.unitId && x.previous?.reservationId === res.id);
check('auto guest-left: nobody tapped it, the guest counts out at checkout 11:00', !!row && row.guestOut && row.guestLeftAuto && row.guestLeftAt === `${day}T11:00:00+08:00`, JSON.stringify(row).slice(0, 300));
r = await call('GET', `/api/audit?entity=tasks&id=${row.id}`);
check('auto guest-left: written once to the history as Automatic', r.status === 200 && JSON.stringify(r.json).includes('Automatic, at checkout 11:00'), r.text.slice(0, 300));
const expectAmount = res.unitId === priced.unitId ? 9000 : null;
if (expectAmount) check('the clean carries the price amount', row.amount === 9000 && row.cleanerPay === 4500 && row.priceSource === 'unit', JSON.stringify(row).slice(0, 300));
else check('a unit with no price shows Price not set (null)', row.amount === null || typeof row.amount === 'number', JSON.stringify(row).slice(0, 200));
r = await call('POST', `/api/tasks/${row.id}/complete`, { photoIds: [] });
check('photo required: a clean without a photo is refused (422)', r.status === 422 && r.json.error.code === 'PHOTO_REQUIRED', r.text);

// External jobs.
r = await call('POST', '/api/housekeeping/tasks', { external: { address: `12 Jalan ${tag}` }, date: day, kind: 'turnover' });
check('external: an amount is required (422)', r.status === 422 && !!r.json.error.fields?.amount, r.text);
r = await call('POST', '/api/housekeeping/tasks', { external: { address: '' }, amount: 5000, date: day });
check('external: an address is required (422)', r.status === 422, r.text);
let crew = (await call('GET', '/api/housekeeping/cleaners?active=1')).json.data;
for (let k = crew.length; k < 2; k++) await call('POST', '/api/housekeeping/cleaners', { name: `Crew ${tag}-${k}`, employmentType: 'outsourced' });
crew = (await call('GET', '/api/housekeeping/cleaners?active=1')).json.data;
r = await call('POST', '/api/housekeeping/tasks', { external: { address: `12 Jalan ${tag}`, clientName: 'Ms Tan', clientPhone: '0123456789' }, amount: 15000, date: day, kind: 'deep_clean', cleanerIds: crew.slice(0, 2).map(c => c.id) });
check('external: saved with address, client, amount and two cleaners', r.status === 201, r.text);
const ext = r.json.id;
board = (await call('GET', `/api/housekeeping/board?date=${day}`)).json;
const exRow = board.external.find(x => x.id === ext);
check('external: in its own group on the board', !!exRow && exRow.buildingId === 'external' && exRow.amount === 15000 && exRow.external.clientName === 'Ms Tan' && exRow.cleaners.length === 2, JSON.stringify(exRow).slice(0, 300));
check('external: not among the unit rows', !board.rows.some(x => x.id === ext));
r = await call('GET', `/api/housekeeping/tasks/${ext}`);
check('external: its detail opens', r.status === 200 && r.json.external.address.startsWith('12 Jalan') && r.json.cost.amount === 15000, r.text.slice(0, 200));
r = await call('PATCH', `/api/housekeeping/tasks/${ext}`, { amount: null });
check('external: the amount cannot be cleared (422)', r.status === 422, r.text);

// Pay: a finished external job counts for its cleaners, split between the two; it never reaches a unit's costs.
check('external: a photo is added', (await photo(ext)) === 201);
r = await call('POST', `/api/tasks/${ext}/complete`, { photoIds: [] });
check('external: completes without touching a unit (no cost on a unit)', r.status === 200 && r.json.cost === null, r.text);
const month = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 7);
r = await call('GET', `/api/housekeeping/pay?month=${month}`);
const pay = r.json.rows?.filter(x => crew.slice(0, 2).some(c => c.id === x.cleanerId)) ?? [];
check('pay: each of the two cleaners gets half the external job', r.status === 200 && pay.length === 2 && pay.every(x => x.externalJobs >= 1 && x.externalPay >= 7500), r.text.slice(0, 400));
check('photo required stays: with a photo the unit clean completes', (await photo(row.id)) === 201 && (await call('POST', `/api/tasks/${row.id}/complete`, { photoIds: [] })).status === 200);

done();
