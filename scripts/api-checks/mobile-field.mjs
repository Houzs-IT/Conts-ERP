// The field app on the phone (11 Oct 2026): a technician sees open repair jobs, picks up only one nobody has, works only
// on their own (start, Before/After photos, claim files, a note, done with at least one After photo), reports a new
// problem, never sees or sets an amount; and a cleaner finishes a clean with proof. Every phone action is in History
// as 'field_app'. Needs a fresh local database with the demo technician (scripts/local-demo-setup.mjs) and a server:
//   API_BASE=http://localhost:8811 node scripts/api-checks/mobile-field.mjs
import { call, check, done, cookieFor } from './harness.mjs';

const BASE = process.env.API_BASE ?? 'http://localhost:8788';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
async function upload(path, role, fields = {}, name = 'photo.png', type = 'image/png') {
  const form = new FormData();
  form.append('file', new Blob([png], { type }), name);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const r = await fetch(BASE + path, { method: 'POST', headers: { cookie: cookieFor(role) }, body: form });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
}
const history = async (id) => ((await call('GET', `/api/audit?entityTable=maintenance_issues&entityId=${id}&pageSize=100`)).json?.data ?? []);

const units = await call('GET', '/api/field/units', undefined, 'technician');
check('the phone lists units by name for reporting', units.status === 200 && units.json.data.length > 0, units.text.slice(0, 300));
check('the phone unit list carries no owner or rate', !('baseRate' in units.json.data[0]) && !('ownerName' in units.json.data[0]), JSON.stringify(units.json.data[0]));
const unitId = units.json.data[0].id;

// An open job nobody has, and one a contractor has.
let r = await call('POST', '/api/maintenance/issues', { unitId, title: 'Kitchen tap dripping', category: 'plumbing', urgency: 'urgent', quotedAmount: 25000 });
check('office reports an open job with a quote', r.status === 201 && r.json.state === 'open', r.text);
const openId = r.json.id;
r = await call('POST', '/api/maintenance/issues', { unitId, title: 'Wardrobe door off its hinge', category: 'furniture', assigneeName: 'Kiara Interiors' });
check('office reports a job and gives it to a contractor', r.status === 201 && r.json.state === 'assigned', r.text);
const otherId = r.json.id;

let list = await call('GET', '/api/field/repairs', undefined, 'technician');
check('technician sees the open job to pick up', list.status === 200 && list.json.open.some(j => j.id === openId), list.text.slice(0, 400));
check('the contractor\'s job is not offered', !list.json.open.some(j => j.id === otherId), list.text.slice(0, 400));
check('no amount anywhere on the phone list', !/quotedAmount|finalAmount|contractorAmount|25000/.test(list.text), list.text.slice(0, 400));
check('technician may pick up', list.json.mayPick === true, list.text.slice(0, 200));
const hk = await call('GET', '/api/field/repairs', undefined, 'housekeeper');
check('a cleaner is not offered jobs to pick up', hk.status === 200 && hk.json.open.length === 0 && hk.json.mayPick === false, hk.text.slice(0, 200));

r = await call('GET', `/api/field/repairs/${openId}`, undefined, 'technician');
check('technician opens an unassigned job before picking it', r.status === 200 && r.json.mayPick === true && r.json.mine === false, r.text.slice(0, 300));
check('no door access before it is theirs', Array.isArray(r.json.access) && r.json.access.length === 0, JSON.stringify(r.json.access));

r = await call('POST', `/api/maintenance/issues/${openId}/start`, {}, 'technician');
check('technician cannot start a job before picking it up', r.status === 403, r.text);
r = await call('POST', `/api/field/repairs/${openId}/pick`, {}, 'housekeeper');
check('a cleaner cannot pick up a repair', r.status === 403, r.text);
r = await call('POST', `/api/field/repairs/${otherId}/pick`, {}, 'technician');
check('technician cannot pick up a job someone already has', r.status === 409, r.text);
r = await call('POST', `/api/field/repairs/${openId}/pick`, {}, 'technician');
check('technician picks up the unassigned job', r.status === 200 && r.json.state === 'assigned', r.text);
r = await call('POST', `/api/field/repairs/${openId}/pick`, {}, 'technician');
check('picking it again is refused (it is no longer unassigned)', r.status === 409, r.text);
const office = (await call('GET', '/api/maintenance/issues')).json.data.find(x => x.id === openId);
check('the office sees the technician as in-house assignee', office?.assigneeName === 'Hafiz Rahman' && office?.assigneeKind === 'in_house' && office?.state === 'assigned', JSON.stringify(office));
let h = await history(openId);
const pick = h.find(e => e.action === 'maintenance.assign');
check('the pick-up is in History, from the phone', pick?.source === 'field_app' && pick?.actorLabel === 'Hafiz Rahman', JSON.stringify(pick));

// Someone else's job: every phone action refused.
r = await call('GET', `/api/field/repairs/${otherId}`, undefined, 'technician');
check('technician cannot open someone else\'s job', r.status === 403, r.text);
r = await call('POST', `/api/maintenance/issues/${otherId}/start`, {}, 'technician');
check('technician cannot start someone else\'s job', r.status === 403, r.text);
r = await upload(`/api/maintenance/issues/${otherId}/photos`, 'technician', { kind: 'after' });
check('technician cannot add photos to someone else\'s job', r.status === 403, r.text);
r = await upload(`/api/maintenance/issues/${otherId}/documents`, 'technician', { kind: 'claim' }, 'claim.pdf', 'application/pdf');
check('technician cannot add files to someone else\'s job', r.status === 403, r.text);
r = await call('POST', `/api/field/repairs/${otherId}/note`, { note: 'hello' }, 'technician');
check('technician cannot note someone else\'s job', r.status === 403, r.text);

// Their own job.
r = await call('GET', `/api/field/repairs/${openId}`, undefined, 'technician');
check('their job opens with no amount in it', r.status === 200 && r.json.mine === true && !/quotedAmount|25000/.test(r.text), r.text.slice(0, 300));
r = await call('POST', `/api/maintenance/issues/${openId}/start`, {}, 'technician');
check('technician starts their job', r.status === 200 && !!r.json.startedAt, r.text);
r = await call('POST', `/api/maintenance/issues/${openId}/end`, {}, 'technician');
check('done is refused with no After photo', r.status === 422, r.text);
r = await upload(`/api/maintenance/issues/${openId}/photos`, 'technician', { kind: 'before' }, 'before.png');
check('technician adds a Before photo', r.status === 201, r.text);
r = await call('POST', `/api/maintenance/issues/${openId}/end`, {}, 'technician');
check('a Before photo alone does not allow done', r.status === 422, r.text);
r = await upload(`/api/maintenance/issues/${openId}/photos`, 'technician', { kind: 'after' }, 'after.png');
check('technician adds an After photo', r.status === 201, r.text);
r = await upload(`/api/maintenance/issues/${openId}/documents`, 'technician', { kind: 'claim' }, 'claim.pdf', 'application/pdf');
check('technician uploads their claim', r.status === 201, r.text);
r = await call('POST', `/api/field/repairs/${openId}/note`, { note: 'Washer replaced.' }, 'technician');
check('technician leaves a note', r.status === 201, r.text);
r = await call('POST', `/api/maintenance/issues/${openId}/end`, { note: 'Tested, no drip.' }, 'technician');
check('technician marks the repair done', r.status === 200 && !!r.json.endedAt, r.text);
r = await call('GET', `/api/field/repairs/${openId}`, undefined, 'technician');
check('the job shows Before, After, the claim and both notes',
  r.json.media.filter(m => m.stage === 'before').length === 1 && r.json.media.filter(m => m.stage === 'after').length === 1
  && r.json.files.some(f => f.kind === 'claim') && r.json.notes.length === 2 && !!r.json.job.endedAt, r.text.slice(0, 600));

// Money and closing stay in the office.
r = await call('PATCH', `/api/maintenance/issues/${openId}`, { contractorAmount: 5000 }, 'technician');
check('technician cannot enter an amount', r.status === 403, r.text);
r = await call('POST', `/api/maintenance/issues/${openId}/complete`, { finalAmount: 0 }, 'technician');
check('technician cannot close the job', r.status === 403, r.text);
r = await call('POST', `/api/maintenance/issues/${openId}/approve`, { approved: true, quotedAmount: 25000 }, 'technician');
check('technician cannot approve', r.status === 403, r.text);

h = await history(openId);
for (const a of ['maintenance.start', 'maintenance.photo', 'maintenance.document', 'maintenance.note', 'maintenance.end']) {
  const e = h.find(x => x.action === a);
  check(`History has ${a} from the phone`, e?.source === 'field_app', JSON.stringify(e));
}

// The office can still give it to someone else, and then it is no longer the technician's.
r = await call('PATCH', `/api/maintenance/issues/${openId}`, { assigneeName: 'Nurul Huda' });
check('office reassigns the picked job', r.status === 200, r.text);
r = await upload(`/api/maintenance/issues/${openId}/photos`, 'technician', { kind: 'after' });
check('after reassignment the technician is refused', r.status === 403, r.text);

// Report a new problem from the phone, with a photo.
r = await call('POST', '/api/maintenance/issues', { unitId, title: 'Bathroom light flickers', category: 'electrical', urgency: 'normal', quotedAmount: 100 }, 'technician');
check('the phone cannot put an amount on a report', r.status === 403, r.text);
r = await call('POST', '/api/maintenance/issues', { unitId, title: 'Bathroom light flickers', category: 'electrical', urgency: 'normal' }, 'technician');
check('technician reports a new problem', r.status === 201 && r.json.state === 'open', r.text);
const reported = r.json.id;
r = await upload(`/api/maintenance/issues/${reported}/photos`, 'technician', { kind: 'before' });
check('with a photo of it', r.status === 201, r.text);
const rep = (await call('GET', '/api/maintenance/issues')).json.data.find(x => x.id === reported);
check('reported by staff, not "cleaner"', rep?.source === 'staff' && rep?.reporter === 'Hafiz Rahman', JSON.stringify(rep));
h = await history(reported);
check('the report is in History from the phone', h.find(e => e.action === 'maintenance.create')?.source === 'field_app', JSON.stringify(h[0]));

// A cleaner finishes a clean with proof.
const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const HOUSEKEEPER = '11111111-1111-4111-8111-000000000005';
let roster = await call('GET', '/api/housekeeping/cleaners');
if (!(roster.json?.data ?? []).some(c => c.userId === HOUSEKEEPER)) {
  await call('POST', '/api/housekeeping/cleaners', { name: 'Nurul Huda', employmentType: 'internal', userId: HOUSEKEEPER });
  roster = await call('GET', '/api/housekeeping/cleaners');
}
const nurul = (roster.json?.data ?? []).find(c => c.userId === HOUSEKEEPER);
const made = await call('POST', '/api/housekeeping/tasks', { unitId, date: today, kind: 'turnover', title: 'Standard clean' });
const taskId = made.json?.id ?? made.json?.task?.id;
await call('POST', `/api/housekeeping/tasks/${taskId}/assign`, { cleanerId: nurul?.id, force: true });
const jobs = await call('GET', `/api/field/tasks?date=${today}`, undefined, 'housekeeper');
check('the cleaner sees today\'s clean on the phone', jobs.json?.rows?.some(j => j.id === taskId), jobs.text.slice(0, 300));
r = await call('POST', `/api/tasks/${taskId}/complete`, { photoIds: [] }, 'housekeeper');
check('the cleaner cannot complete without proof', r.status === 422, r.text);
for (const n of ['room.png', 'bath.png']) {
  r = await upload(`/api/tasks/${taskId}/photos`, 'housekeeper', {}, n);
  check(`the cleaner uploads ${n}`, r.status < 300, r.text);
}
r = await call('POST', `/api/tasks/${taskId}/complete`, { photoIds: [] }, 'housekeeper');
check('the cleaner marks the clean complete', r.status === 200, r.text);
r = await call('POST', `/api/tasks/${taskId}/complete`, { photoIds: [] }, 'technician');
check('someone else cannot complete the cleaner\'s job', r.status === 403 || r.status === 409, r.text);

done();
