// Maintenance job templates and the technician's phone app (11 Oct 2026): who may change templates, the checks on
// every field, a job opened from a template (checklist and parts copied, technician by ACCOUNT), archive instead of
// delete once used, and the technician's own repairs on the phone (today / upcoming / overdue / history, start,
// checklist, parts used with the store, proof required to mark done), with another technician refused.
// Needs one account per role in the database it runs against (ids from the environment, defaults are the local
// test accounts): CHECK_USER_ID (management), OPS_MGR_ID, OPS_STAFF_ID, TECH_ID, TECH2_ID, CLEANER_ID.
// Run: API_BASE=http://localhost:8809 SESSION_SECRET=<the server's> node scripts/api-checks/maintenance-templates.mjs
import { callAsUser, check, done } from './harness.mjs';

const who = (userId, role, fullName) => ({ userId, role, fullName, email: `${userId}@local.test` });
const MGMT = who(process.env.CHECK_USER_ID ?? 'dev-admin', 'management', 'Check management');
const OPS = who(process.env.OPS_MGR_ID ?? 'local-opsmgr', 'operations_manager', 'Local Ops Manager');
const STAFF = who(process.env.OPS_STAFF_ID ?? 'local-opsstaff', 'operations_staff', 'Local Ops Staff');
const TECH = who(process.env.TECH_ID ?? 'local-tech', 'technician', 'Local Technician');
const TECH2 = who(process.env.TECH2_ID ?? 'local-tech2', 'technician', 'Second Technician');
const CLEANER = who(process.env.CLEANER_ID ?? 'local-cleaner', 'housekeeper', 'Local Cleaner');
const as = (u) => (m, p, b) => callAsUser(u, m, p, b);
const mg = as(MGMT), ops = as(OPS), staff = as(STAFF), tech = as(TECH), tech2 = as(TECH2), cleaner = as(CLEANER);
const myt = (d = 0, hm = '10:00') => `${new Date(Date.now() + 8 * 3600e3 + d * 864e5).toISOString().slice(0, 10)}T${hm}`;
const tag = Date.now().toString(36).toUpperCase();

// 1. Reading: everyone who reports repairs; only management and operations managers may change.
let r = await mg('GET', '/api/maintenance/templates');
check('management lists templates', r.status === 200 && r.json.canEdit === true, r.text.slice(0, 200));
const starters = ['Aircon service', 'Aircon not cold', 'Leaking tap', 'Blocked sink / toilet', 'Water heater not working', 'Lightbulb / socket',
  'Door lock / access card', 'Wi-Fi down', 'Furniture repair', 'Appliance repair (fridge/washer/TV)', 'Pest control', 'Wall touch-up / paint'];
const names = (r.json?.data ?? []).map(t => t.name);
check('the 12 starter templates are there', starters.every(n => names.includes(n)), names.join(', '));
const leaking = r.json?.data?.find(t => t.name === 'Leaking tap');
check('starter has a checklist and no invented price or parts', leaking?.steps.length >= 3 && leaking.estimatedCost === null && leaking.parts.length === 0, JSON.stringify(leaking));
r = await staff('GET', '/api/maintenance/templates');
check('operations staff read, cannot edit', r.status === 200 && r.json.canEdit === false, r.text.slice(0, 200));
r = await staff('POST', '/api/maintenance/templates', { name: `Staff ${tag}`, category: 'other', urgency: 'normal' });
check('operations staff create refused (403)', r.status === 403, r.text);
r = await cleaner('GET', '/api/maintenance/templates');
check('cleaner reads templates for reporting, no costs', r.status === 200 && r.json.canEdit === false && r.json.data.every(t => t.estimatedCost === null), r.text.slice(0, 200));
r = await tech('POST', '/api/maintenance/templates', { name: `Tech ${tag}`, category: 'other' });
check('technician create refused (403)', r.status === 403, r.text);

// 2. A stocked catalog part to put on the template.
r = await mg('POST', '/api/maintenance/skus', { code: `TPL-${tag}`, name: `Tap washer ${tag}`, category: 'plumbing', unitLabel: 'unit', defaultPrice: 500, trackStock: true, stockOnHand: 2 });
check('stocked part added', r.status === 201, r.text);
r = await mg('GET', '/api/maintenance/skus');
const sku = r.json?.data?.find(s => s.code === `TPL-${tag}`);

// 3. Field checks on create (operations manager).
const good = { name: `Tap check ${tag}`, category: 'plumbing', urgency: 'urgent', assigneeKind: 'in_house', technicianId: TECH.userId,
  estimatedCost: 12550, blocksUnit: false, instructions: 'Turn the water off first.', steps: ['Turn off water', 'Replace washer', 'Test'], parts: [{ skuId: sku?.id, qty: 1 }] };
for (const [label, body, field] of [
  ['blank name', { ...good, name: '  ' }, 'name'],
  ['cost with cents as a decimal', { ...good, estimatedCost: 125.5 }, 'estimatedCost'],
  ['negative cost', { ...good, estimatedCost: -1 }, 'estimatedCost'],
  ['cost as text', { ...good, estimatedCost: '12550' }, 'estimatedCost'],
  ['unknown category', { ...good, category: 'roof' }, 'category'],
  ['a step twice', { ...good, steps: ['Test', 'test'] }, 'steps'],
  ['part quantity 0', { ...good, parts: [{ skuId: sku?.id, qty: 0 }] }, 'parts'],
  ['part quantity 1.5', { ...good, parts: [{ skuId: sku?.id, qty: 1.5 }] }, 'parts'],
  ['unknown part', { ...good, parts: [{ skuId: 'nope', qty: 1 }] }, 'parts'],
  ['a cleaner as the technician', { ...good, technicianId: CLEANER.userId }, 'technicianId'],
]) {
  r = await ops('POST', '/api/maintenance/templates', body);
  check(`refused: ${label} (422 on ${field})`, r.status === 422 && !!r.json?.error?.fields?.[field], r.text);
}
r = await ops('POST', '/api/maintenance/templates', good);
check('operations manager creates a template', r.status === 201, r.text); const tplId = r.json?.id;
r = await ops('POST', '/api/maintenance/templates', { ...good, name: good.name.toUpperCase() });
check('same name (any case) refused (409)', r.status === 409, r.text);
r = await ops('GET', `/api/maintenance/templates/${tplId}`);
check('saved as typed', r.json?.data?.estimatedCost === 12550 && r.json.data.technicianName === TECH.fullName && r.json.data.steps.length === 3 && r.json.data.parts[0]?.qty === 1, r.text.slice(0, 300));
r = await ops('PATCH', `/api/maintenance/templates/${tplId}`, { ...good, steps: [...good.steps, 'Photo after'], estimatedCost: null });
check('edit (cost cleared, step added)', r.status === 200, r.text);
r = await ops('GET', `/api/maintenance/templates/${tplId}`);
check('edit saved', r.json?.data?.estimatedCost === null && r.json.data.steps.length === 4, r.text.slice(0, 300));
r = await mg('GET', `/api/audit?entityTable=maintenance_templates&entityId=${tplId}`);
check('create and edit are on the history', r.status === 200 && ['maintenance_template.create', 'maintenance_template.edit'].every(a => r.json.data.some(x => x.action === a)), r.text.slice(0, 300));

// 4. Duplicate; an unused copy can be deleted.
r = await ops('POST', `/api/maintenance/templates/${tplId}/duplicate`, {});
check('duplicate', r.status === 201 && r.json.name === `${good.name} (copy)`, r.text); const copyId = r.json?.id;
r = await ops('POST', `/api/maintenance/templates/${tplId}/duplicate`, {});
check('second duplicate is "(copy 2)"', r.status === 201 && r.json.name === `${good.name} (copy 2)`, r.text);
await ops('DELETE', `/api/maintenance/templates/${r.json?.id}`);
r = await ops('DELETE', `/api/maintenance/templates/${copyId}`);
check('unused copy deleted', r.status === 200, r.text);

// 5. A job from the template, given to the technician's account.
r = await mg('GET', '/api/units');
const unit = (r.json?.data ?? []).find(u => u.readiness === 'ready') ?? r.json?.data?.[0];
r = await ops('POST', '/api/maintenance/issues', { unitId: unit.id, title: `Leaking tap ${tag}`, category: 'plumbing', urgency: 'urgent', chargeTo: 'the_conts', templateId: tplId, assigneeUserId: TECH.userId });
check('job opened from the template', r.status === 201 && r.json.state === 'assigned', r.text); const jobId = r.json?.id;
r = await ops('GET', '/api/maintenance/issues');
const job = r.json?.data?.find(i => i.id === jobId);
check('job carries the template, the account and the checklist', job?.templateId === tplId && job.assigneeId === TECH.userId && job.assigneeKind === 'in_house' && job.assigneeName === TECH.fullName && job.checklist.total === 4, JSON.stringify(job));
r = await ops('GET', `/api/maintenance/issues/${jobId}/parts`);
check('planned parts copied', r.json?.data?.[0]?.plannedQty === 1 && r.json.data[0].usedQty === 0, r.text);
r = await ops('PATCH', `/api/maintenance/templates/${tplId}`, { ...good, steps: ['Only one step now'] });
r = await ops('GET', `/api/maintenance/issues/${jobId}/checklist`);
check('editing the template later leaves the job alone', r.json?.data?.length === 4, r.text.slice(0, 200));
r = await ops('POST', '/api/maintenance/issues', { unitId: unit.id, title: 'x', assigneeUserId: CLEANER.userId });
check('a cleaner cannot be the technician (422)', r.status === 422, r.text);

// 6. Used template: archive, not delete.
r = await ops('DELETE', `/api/maintenance/templates/${tplId}`);
check('used template delete refused (409 IN_USE)', r.status === 409 && r.json.error.code === 'IN_USE', r.text);
r = await ops('PATCH', `/api/maintenance/templates/${tplId}`, { archived: true });
check('archived', r.status === 200, r.text);
r = await ops('GET', '/api/maintenance/templates');
check('archived template left off the picker', !r.json.data.some(t => t.id === tplId), '');
r = await ops('GET', '/api/maintenance/templates?archived=1');
check('archived list shows it', r.json.data.some(t => t.id === tplId && t.archived), '');
r = await ops('POST', '/api/maintenance/issues', { unitId: unit.id, title: 'From archived', templateId: tplId });
check('no new job from an archived template (404)', r.status === 404, r.text);
r = await staff('PATCH', `/api/maintenance/templates/${tplId}`, { archived: false });
check('operations staff restore refused (403)', r.status === 403, r.text);
r = await ops('PATCH', `/api/maintenance/templates/${tplId}`, { archived: false });
check('restored', r.status === 200, r.text);

// 7. The technician's phone.
r = await tech('GET', '/api/field/maintenance');
let mine = r.json?.rows?.find(x => x.id === jobId);
check('technician sees the job (matched by account)', r.status === 200 && mine?.bucket === 'today' && mine.checklist.total === 4, r.text.slice(0, 300));
check('no money on the phone', !/quote|finalAmount|amount|chargeTo|threshold/i.test(JSON.stringify(r.json)), JSON.stringify(mine));
r = await tech2('GET', '/api/field/maintenance');
check('another technician does not see it', r.status === 200 && !r.json.rows.some(x => x.id === jobId), '');
for (const [m, p, b] of [['GET', `/api/field/maintenance/${jobId}`], ['POST', `/api/maintenance/issues/${jobId}/start`, {}], ['POST', `/api/maintenance/issues/${jobId}/checklist`, { label: 'x' }], ['POST', `/api/maintenance/issues/${jobId}/parts`, { skuId: sku?.id, usedQty: 1 }], ['GET', `/api/audit?entityTable=maintenance_issues&entityId=${jobId}`]]) {
  r = await tech2(m, p, b);
  check(`other technician refused: ${m} ${p.replace(jobId, ':id')} (403)`, r.status === 403, r.text);
}
r = await tech('GET', `/api/audit?entityTable=maintenance_issues&entityId=${jobId}`);
check('technician reads the history of their own repair', r.status === 200, r.text);
r = await cleaner('GET', '/api/field/maintenance');
check('a cleaner has no repairs listed', r.status === 200 && r.json.rows.length === 0, r.text.slice(0, 200));
r = await cleaner('GET', '/api/field/tasks?date=today');
check('a cleaner still gets cleaning', r.status === 200 && Array.isArray(r.json.rows), r.text.slice(0, 200));

// Windows decide the bucket.
r = await ops('POST', `/api/maintenance/issues/${jobId}/windows`, { startsAt: myt(2, '11:30'), endsAt: myt(2, '14:00') });
check('window in two days added', r.status === 201, r.text);
r = await tech('GET', '/api/field/maintenance');
mine = r.json.rows.find(x => x.id === jobId);
check('bucket: upcoming', mine?.bucket === 'upcoming' && mine.nextWindow?.startsAt.startsWith(myt(2).slice(0, 10)), JSON.stringify(mine?.nextWindow));
const wid = mine?.windows?.[0]?.id;
await ops('DELETE', `/api/maintenance/issues/${jobId}/windows/${wid}`);
r = await ops('POST', `/api/maintenance/issues/${jobId}/windows`, { startsAt: myt(-2, '11:30'), endsAt: myt(-2, '14:00') });
r = await tech('GET', '/api/field/maintenance');
check('bucket: overdue once every window is over', r.json.rows.find(x => x.id === jobId)?.bucket === 'overdue', '');

// Work on the phone.
r = await tech('GET', `/api/field/maintenance/${jobId}`);
check('detail: checklist, parts, catalog, no prices', r.status === 200 && r.json.checklist.length === 4 && r.json.parts.length === 1 && r.json.catalog.some(c => c.id === sku?.id) && !/price|amount/i.test(r.text), r.text.slice(0, 300));
r = await tech('POST', `/api/maintenance/issues/${jobId}/start`, {});
check('technician starts', r.status === 200, r.text);
const first = (await tech('GET', `/api/maintenance/issues/${jobId}/checklist`)).json.data[0];
r = await tech('POST', `/api/maintenance/issues/${jobId}/checklist`, { key: first.key, done: true });
check('ticks a step', r.status === 200 && r.json.data[0].done && r.json.data[0].doneBy === TECH.fullName, r.text.slice(0, 200));
r = await tech('POST', `/api/maintenance/issues/${jobId}/checklist`, { label: 'Replaced the hose too' });
check('adds a step', r.status === 201 && r.json.data.length === 5, r.text.slice(0, 200));
for (const [label, q] of [['1.5', 1.5], ['-1', -1], ['"2"', '2'], ['1000', 1000]]) {
  r = await tech('POST', `/api/maintenance/issues/${jobId}/parts`, { skuId: sku?.id, usedQty: q });
  check(`parts used ${label} refused (422)`, r.status === 422, r.text);
}
r = await tech('POST', `/api/maintenance/issues/${jobId}/parts`, { skuId: sku?.id, usedQty: 1 });
check('records 1 part used', r.status === 200 && r.json.data[0].usedQty === 1 && r.json.data[0].stockOnHand === 1, r.text);
r = await tech('POST', `/api/maintenance/issues/${jobId}/parts`, { skuId: sku?.id, usedQty: 3 });
check('more than the store holds refused (409)', r.status === 409 && r.json.error.code === 'OUT_OF_STOCK', r.text);
r = await tech('POST', `/api/maintenance/issues/${jobId}/parts`, { skuId: sku?.id, usedQty: 0 });
check('back to 0 returns it to the store', r.status === 200 && r.json.data[0].stockOnHand === 2, r.text);
r = await tech('POST', `/api/maintenance/issues/${jobId}/end`, { note: 'Washer replaced, no more drip.' });
check('mark done without a photo or video refused (409 PROOF_REQUIRED)', r.status === 409 && r.json.error.code === 'PROOF_REQUIRED', r.text);
r = await tech('PATCH', `/api/maintenance/issues/${jobId}`, { quotedAmount: 1 });
check('technician cannot change the job or its money (403)', r.status === 403, r.text);
r = await tech('POST', `/api/maintenance/issues/${jobId}/complete`, { finalAmount: 0 });
check('technician cannot close the job (403)', r.status === 403, r.text);

// The office finishes; the job moves to the technician's history.
r = await ops('POST', `/api/maintenance/issues/${jobId}/end`, { note: 'Done by the office.' });
check('office marks the work done', r.status === 200, r.text);
r = await tech('GET', '/api/field/maintenance');
check('no longer on the to-do list', !r.json.rows.some(x => x.id === jobId), '');
r = await tech('GET', '/api/field/maintenance?view=history');
check('in the history with the note', r.json.rows.some(x => x.id === jobId && x.doneNote === 'Done by the office.'), r.text.slice(0, 200));
r = await ops('POST', `/api/maintenance/issues/${jobId}/complete`, { finalAmount: 0, chargeTo: 'the_conts' });
check('office closes the job', r.status === 200, r.text);

// 8. Handing a job to a contractor takes it off the technician's phone.
r = await ops('POST', '/api/maintenance/issues', { unitId: unit.id, title: `Wi-Fi ${tag}`, assigneeUserId: TECH.userId, chargeTo: 'the_conts' });
const job2 = r.json?.id;
r = await ops('PATCH', `/api/maintenance/issues/${job2}`, { assigneeName: 'AquaFix Sdn Bhd', assigneeKind: 'contractor' });
check('given to a contractor', r.status === 200, r.text);
r = await tech('GET', '/api/field/maintenance');
check('off the technician\'s phone', !r.json.rows.some(x => x.id === job2), '');
r = await ops('GET', '/api/maintenance/technicians');
check('technician picker lists accounts and contractor names', r.status === 200 && r.json.data.some(t => t.id === TECH.userId) && r.json.contractors.includes('AquaFix Sdn Bhd'), r.text.slice(0, 200));
r = await ops('PATCH', `/api/maintenance/issues/${job2}`, { assigneeUserId: TECH2.userId });
r = await tech2('GET', '/api/field/maintenance');
check('reassigned to the second technician by account', r.json.rows.some(x => x.id === job2), '');
await ops('POST', `/api/maintenance/issues/${job2}/complete`, { finalAmount: 0, chargeTo: 'the_conts' });

done();
