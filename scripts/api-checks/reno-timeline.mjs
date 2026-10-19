// Renovation project Timeline (owner, 15 Oct 2026) through a local engine's HTTP API: a new project starts with
// "Project created"; the step, the hold flag, a key pass, an Onsite visit, a 3D submission and a 2D amendment request
// each show up as a System entry, and so does moving it to Closed (Project completed); a typed note is added (Customer, Design, Supplier, Site, Sales), listed newest first
// under its type and archived; bad input and a view-only user are refused.
//
// Runs against a local engine (wrangler dev in engine/backend) with its CONTS_SSO_SECRET from engine/backend/.dev.vars,
// like renovation-project.mjs. It WRITES one project, two people and their records, named "TEST TL <run>", in whatever
// database that local engine is pointed at (it needs migration 0118). Never point it at production. Refuses any ENGINE
// that is not localhost.
//
// Run: ENGINE=http://127.0.0.1:8790 node scripts/api-checks/reno-timeline.mjs
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const ENGINE = process.env.ENGINE ?? 'http://localhost:8790';
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(ENGINE)) { console.error(`ENGINE must be a local engine, not ${ENGINE}`); process.exit(1); }
const secret = readFileSync(new URL('../../engine/backend/.dev.vars', import.meta.url), 'utf8').match(/^CONTS_SSO_SECRET\s*=\s*"?([^"\r\n]+)"?/m)?.[1];
if (!secret) { console.error('CONTS_SSO_SECRET not found in engine/backend/.dev.vars'); process.exit(1); }
const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const AREAS = ['scSales', 'scInvoices', 'scConsignment', 'scProcurement', 'scTransportPlan', 'scWarehouse', 'serviceCases', 'projects'];
const run = Date.now().toString(36).slice(-5).toUpperCase();

let fails = 0;
let passes = 0;
const check = (name, ok, extra = '') => { if (ok) passes++; else fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ' :: ' + extra}`); return ok; };
const show = (r) => `${r.status} ${JSON.stringify(r.json).slice(0, 300)}`;
const stop = (why) => { console.log(`\nstopped: ${why}\n${passes} passed, ${fails} failed`); process.exit(1); };

async function signOn(email, name, level) {
  const body = b64url(JSON.stringify({ email, name, role: 'management', access: Object.fromEntries(AREAS.map((k) => [k, k === 'projects' ? level : 'full'])), exp: Date.now() + 45_000 }));
  const r = await fetch(`${ENGINE}/api/conts-sso`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assertion: `${body}.${b64url(createHmac('sha256', secret).update(body).digest())}` }) });
  return (await r.json().catch(() => ({}))).token;
}
const token = await signOn('reno-timeline-check@theconts.test', 'Timeline check', 'full');
if (!check('sign on to the engine', !!token)) stop('no session');
const viewer = await signOn('reno-timeline-viewer@theconts.test', 'Timeline viewer', 'view');

async function call(method, path, payload, as = token) {
  const r = await fetch(ENGINE + path, {
    method,
    headers: { authorization: `Bearer ${as}`, ...(payload === undefined ? {} : { 'content-type': 'application/json' }) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json };
}
const R = '/api/renovation';
const timeline = async (id) => (await call('GET', `${R}/${id}/timeline`)).json;

/* ---------- a new project ---------- */
const types = await call('GET', `${R}/types`);
const type = types.json?.data?.find((t) => t.slug === 'full_renovation');
if (!check('the Full renovation project type exists', !!type, show(types))) stop('no project type');
let r = await call('POST', R, { name: `TEST TL ${run}`, projectTypeId: type.id, customerKind: 'customer', customerName: `TEST TL Customer ${run}`, building: 'TEST Vista', unitNo: `TL-${run}` });
if (!check('create a renovation project', r.status === 201, show(r))) stop('no project');
const id = r.json.id;
let t = await timeline(id);
check('the timeline answers, with notes switched on (migration 0118)', t?.notesReady === true, JSON.stringify(t).slice(0, 200));
check('a new project starts with "Project created"', t.entries?.some((e) => e.title === 'Project created' && e.category === 'system'), JSON.stringify(t.entries));

/* ---------- System entries from the project's own history ---------- */
const people = [];
for (const name of [`TEST TL Office ${run}`, `TEST TL Seng ${run}`]) {
  r = await call('POST', `${R}/people`, { name, roles: ['reno_pic'] });
  check(`add person ${name}`, r.status === 201, show(r));
  people.push(r.json?.id);
}
const steps = [
  ['key pass', 'POST', `${R}/${id}/key-moves`, { movedOn: '2026-10-01', fromPersonId: people[0], toPersonId: people[1] }],
  ['manual step', 'POST', `${R}/${id}/step`, { step: 'signed', reason: 'deposit paid' }],
  ['hold flag', 'POST', `${R}/${id}/hold`, { flag: 'on_hold', note: 'customer travelling' }],
  ['onsite visit', 'POST', `${R}/${id}/site-measures`, { doneOn: '2026-10-02', personIds: [people[1]], note: 'measured' }],
  ['3D submission', 'POST', `${R}/${id}/design-links`, { kind: '3d', url: 'https://example.test/3d', submittedOn: '2026-10-03', personIds: [people[1]] }],
  ['2D amendment request', 'POST', `${R}/${id}/design-notes`, { kind: '2d', notedOn: '2026-10-04', requestedByPersonId: null, requestedByText: 'Customer', note: 'Move the TV wall' }],
];
for (const [name, method, path, payload] of steps) {
  r = await call(method, path, payload);
  check(`record a ${name}`, r.status === 200 || r.status === 201, show(r));
}
t = await timeline(id);
const titles = t.entries.filter((e) => e.category === 'system').map((e) => e.title);
for (const want of [`Key passed: TEST TL Office ${run} to TEST TL Seng ${run}`, 'Step changed to Signed', 'Flag set: ON HOLD', 'Design onsite visit', '3D v1 submitted (link)', '2D amendment requested']) {
  check(`System entry "${want}"`, titles.includes(want), titles.join(' | '));
}
const key = t.entries.find((e) => e.title?.startsWith('Key passed'));
check('a key pass typed on another day shows its own date only', key?.dateOnly === true && key.at.startsWith('2026-10-01'), JSON.stringify(key));
check('every System entry says who did it', t.entries.filter((e) => e.category === 'system' && e.title !== 'Project created').every((e) => e.by), JSON.stringify(t.entries.map((e) => [e.title, e.by])));

/* ---------- typed notes ---------- */
r = await call('POST', `${R}/${id}/timeline/notes`, { type: 'system', note: 'x' });
check('a note typed System is refused (400 type_invalid)', r.status === 400 && r.json?.error === 'type_invalid', show(r));
r = await call('POST', `${R}/${id}/timeline/notes`, { type: 'site', note: '   ' });
check('an empty note is refused (400 note_required)', r.status === 400 && r.json?.error === 'note_required', show(r));
r = await call('POST', `${R}/${id}/timeline/notes`, { type: 'site', note: 'x'.repeat(2001) });
check('a note over 2000 characters is refused (400 note_too_long)', r.status === 400 && r.json?.error === 'note_too_long', show(r));
r = await call('POST', `${R}/999999999/timeline/notes`, { type: 'site', note: 'x' });
check('a note on a project that does not exist is refused (404)', r.status === 404, show(r));
if (viewer) {
  r = await call('POST', `${R}/${id}/timeline/notes`, { type: 'site', note: 'x' }, viewer);
  check('a view-only user cannot add a note (403)', r.status === 403, show(r));
  r = await call('GET', `${R}/${id}/timeline`, undefined, viewer);
  check('a view-only user can read the timeline', r.status === 200, show(r));
}
const noteIds = {};
for (const [typeKey, text] of [['customer', 'Prefers WhatsApp after 6pm'], ['design', 'Wants oak veneer'], ['supplier', 'Tiles arrive in 3 weeks'], ['site', 'Lift booked Saturday'], ['sales', 'Asked about the Airbnb package']]) {
  r = await call('POST', `${R}/${id}/timeline/notes`, { type: typeKey, note: text });
  check(`add a ${typeKey} note`, r.status === 201 && Number.isInteger(r.json?.id), show(r));
  noteIds[typeKey] = r.json?.id;
}
t = await timeline(id);
const notes = t.entries.filter((e) => e.noteId);
check('the five notes list newest first with their types', JSON.stringify(notes.map((e) => e.category)) === JSON.stringify(['sales', 'site', 'supplier', 'design', 'customer']), JSON.stringify(notes.map((e) => e.category)));
check('a note has no title (its text is the headline) and says who wrote it', notes.every((e) => e.title === null && e.by === 'Timeline check'), JSON.stringify(notes[0]));
const ats = t.entries.map((e) => e.at);
check('the whole timeline is newest first', JSON.stringify([...ats].sort().reverse()) === JSON.stringify(ats), ats.join(','));

/* ---------- completed ---------- */
r = await call('POST', `${R}/${id}/step`, { step: 'closed', reason: 'handed over and paid' });
check('move the project to Closed', r.status === 200, show(r));
t = await timeline(id);
check('Closed shows "Step changed to Closed" and "Project completed"', t.entries.some((e) => e.title === 'Step changed to Closed') && t.entries.some((e) => e.title === 'Project completed'), t.entries.map((e) => e.title).join(' | '));

/* ---------- archive ---------- */
if (viewer) {
  r = await call('POST', `${R}/timeline/notes/${noteIds.site}/archive`, {}, viewer);
  check('a view-only user cannot archive a note (403)', r.status === 403, show(r));
}
r = await call('POST', `${R}/timeline/notes/${noteIds.site}/archive`, {});
check('archive the site note', r.status === 200 && r.json?.ok === true, show(r));
r = await call('POST', `${R}/timeline/notes/${noteIds.site}/archive`, {});
check('archiving it again changes nothing', r.status === 200 && r.json?.unchanged === true, show(r));
t = await timeline(id);
check('an archived note is gone from the timeline', !t.entries.some((e) => e.noteId === noteIds.site) && t.entries.filter((e) => e.noteId).length === 4, JSON.stringify(t.entries.filter((e) => e.noteId)));

console.log(`\nproject ${id}: ${t.entries.length} timeline entries\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
