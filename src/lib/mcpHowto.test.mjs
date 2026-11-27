// node --test src/lib/mcpHowto.test.mjs. AI Connector process help (owner, 27 Nov 2026): how_to guides and flows,
// module_overview, glossary, explain_error, onboarding (functions/_lib/mcpHowto.ts, data in functions/_lib/howto/).
// Honesty first: every page path exists in the router, every double-quoted UI label exists in the frontend (src/ or
// the engine's engine/frontend/src), every permission names a real handler or area, every error message is real, and
// canDo follows the ERP's own access exactly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { checkGuides, labelExists, messageExists, pathExists, permissionProblem, ROOT } from './howtoCheck.mjs';

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) {
  try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; }
}`));
const H = await import('../../functions/_lib/mcpHowto.ts');
const { GUIDES, FLOWS, ONBOARDING, MODULES, GLOSSARY, ERRORS } = H;

const ORIGIN = 'https://erp.example';
/** Everything allowed / nothing allowed / exactly these permissions. */
const yes = { gate: async () => true, level: async () => 'full' };
const no = { gate: async () => false, level: async () => 'none' };
const only = (perms) => ({
  gate: async (m, p) => perms.has(`${m} ${p}`),
  level: async (a) => (['full', 'edit', 'view'].find(l => perms.has(`area:${a}:${l}`)) ?? 'none'),
});

test('guides: every page is in the router, every quoted label in the frontend, every permission real', () => {
  const bad = checkGuides(GUIDES);
  assert.deepEqual(bad, [], bad.map(b => `${b.id}: ${b.problem}`).join('\n'));
});

test('guides: 25+ guides, unique ids, related ids resolve, both companies covered', () => {
  assert.ok(GUIDES.length >= 25, `only ${GUIDES.length} guides`);
  const ids = GUIDES.map(g => g.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate guide id');
  const known = new Set([...ids, ...FLOWS.map(f => f.id)]);
  for (const g of GUIDES) for (const r of g.related) assert.ok(known.has(r), `${g.id} relates to unknown ${r}`);
  assert.ok(GUIDES.filter(g => g.companies.includes('conts')).length >= 12, 'too few The Conts guides');
  assert.ok(GUIDES.filter(g => g.companies.includes('dream_crafter')).length >= 12, 'too few Dream Crafter guides');
  // Dream Crafter's renovation side: projects, quotation, stages, VO, invoices, supplier, payment, commission.
  for (const id of ['dc-create-project', 'dc-create-quotation', 'dc-project-stages', 'dc-variation-order', 'dc-bill-instalment', 'dc-purchase-invoice', 'dc-add-supplier', 'dc-pay-supplier', 'dc-commission']) {
    assert.ok(GUIDES.some(g => g.id === id && g.companies.includes('dream_crafter')), id);
  }
});

test('guides: English only outside the search keywords', () => {
  for (const g of GUIDES) {
    const { keywords, ...rest } = g;
    void keywords;
    assert.doesNotMatch(JSON.stringify(rest), /[㐀-鿿]/, `${g.id} has non-English text`);
  }
});

test('flows and onboarding: every guide / flow id exists and each company has end-to-end flows', () => {
  const ids = new Set(GUIDES.map(g => g.id));
  for (const f of FLOWS) for (const s of f.steps) assert.ok(ids.has(s.guide), `${f.id} -> ${s.guide}`);
  const all = new Set([...ids, ...FLOWS.map(f => f.id)]);
  for (const [role, o] of Object.entries(ONBOARDING)) for (const id of o.path) assert.ok(all.has(id), `${role} -> ${id}`);
  assert.ok(FLOWS.filter(f => f.companies.includes('conts')).length >= 2);
  assert.ok(FLOWS.filter(f => f.companies.includes('dream_crafter')).length >= 2);
});

test('module_overview: sections and page names come from the real sidebar; paths exist; every section covered', () => {
  const nav = readFileSync(`${ROOT}/src/lib/navigation.ts`, 'utf8');
  for (const m of MODULES) {
    assert.ok(nav.includes(`label: '${m.section}'`) || nav.includes(`= '${m.section}'`), `section ${m.section} not in navigation.ts`);
    for (const p of m.pages) {
      assert.ok(nav.includes(`label: '${p.name}'`) || nav.includes(`label: '${p.name}',`) || labelExists(p.name), `${m.id}: menu has no "${p.name}"`);
      assert.ok(pathExists(p.path), `${m.id}: ${p.path} not in router`);
    }
  }
  for (const sec of nav.matchAll(/^\s{2}\{ label: '([A-Z ]+)', workspace: '(rental|supply)'/gm)) {
    assert.ok(MODULES.some(m => m.section === sec[1]), `sidebar section ${sec[1]} has no overview`);
  }
});

test('glossary: required terms, labels exist, pages exist', () => {
  const terms = GLOSSARY.map(e => e.term.toLowerCase());
  for (const t of ['adr', 'revpar', 'occupancy', 'channel', 'host payout', 'owner statement', 'letting', 'vo', 'defect', 'quotation', 'commission', 'project brand', 'sen vs rm']) assert.ok(terms.includes(t), `glossary misses ${t}`);
  for (const e of GLOSSARY) {
    for (const l of e.labels) assert.ok(labelExists(l), `${e.term}: label "${l}" not in the frontend`);
    if (e.page) assert.ok(pathExists(e.page), `${e.term}: ${e.page}`);
    assert.doesNotMatch(e.definition, /[㐀-鿿]/);
  }
  assert.equal(H.glossary({ term: 'OTA' }, ORIGIN).value.terms[0].term, 'Channel');
  assert.equal(H.glossary({ term: 'VO' }, ORIGIN).value.terms[0].term, 'VO');
  assert.equal(H.glossary({ term: '加减单' }, ORIGIN).value.terms[0].term, 'VO');
});

test('explain_error: every message fragment is real (in a handler or screen)', () => {
  assert.ok(ERRORS.length >= 30);
  for (const e of ERRORS) assert.ok(messageExists(e.match), `${e.id}: "${e.match}" not in the code`);
  const r = H.explainError({ text: `Error: ${ERRORS[0].match} Ali on those dates.` });
  assert.equal(r.matched, true);
  assert.equal(r.value.errors[0].message, ERRORS[0].match);
  assert.equal(H.explainError({ text: 'zzqq totally unknown wording' }).matched, false);
});

test('how_to ranking: English, Chinese and Malay questions; company resolves to the person\'s side', async () => {
  const top = async (q, side) => {
    const r = await H.howTo({ question: q }, ORIGIN, yes, side);
    return r.value.guides?.[0]?.id ?? r.value.flow?.id;
  };
  assert.equal(await top('how do I create a reservation', 'conts'), 'create-reservation');
  assert.equal(await top('客人走了', 'conts'), 'check-in-check-out');
  assert.equal(await top('bayar pemilik', 'conts'), 'owner-payout-run');
  assert.equal(await top('how to make a quotation', 'dream_crafter'), 'dc-create-quotation');
  assert.equal(await top('加减单', 'dream_crafter'), 'dc-variation-order');
  assert.equal(await top('whole renovation process', 'dream_crafter'), 'flow-renovation-project');
  // A The Conts person does not get Dream Crafter's guide silently; they are told it is the other company's.
  const other = await H.howTo({ question: 'how to make a quotation' }, ORIGIN, yes, 'conts');
  assert.equal(other.matched, false);
  assert.equal(other.value.otherCompany.id, 'dc-create-quotation');
  // Shared screens (Mail Center, claims) answer both sides.
  assert.equal(await top('reply email mail center', 'dream_crafter'), 'reply-mail-center');
  assert.equal(await top('reply email mail center', 'conts'), 'reply-mail-center');
  // company argument overrides the side; "both" side sees everything.
  assert.equal((await H.howTo({ question: 'quotation', company: 'dream_crafter' }, ORIGIN, yes, 'conts')).value.guides[0].id, 'dc-create-quotation');
  assert.equal(await top('quotation', 'both'), 'dc-create-quotation');
});

test('how_to: steps carry ?highlight= links; engine screens say so; topic id returns that guide', async () => {
  const r = await H.howTo({ topic: 'create-reservation' }, ORIGIN, yes, 'conts');
  const g = r.value.guides[0];
  assert.equal(g.id, 'create-reservation');
  assert.ok(g.erpLink.startsWith(`${ORIGIN}/reservations/bookings`));
  assert.ok(g.steps.some(s => s.link && s.link.includes('?highlight=')), 'no highlight link');
  assert.equal(H.pageLink(ORIGIN, '/operations/today', 'Guest arrived'), `${ORIGIN}/operations/today?highlight=Guest%20arrived`);
  assert.equal(H.pageLink(ORIGIN, '/hr/employees?tab=leave', 'New leave'), `${ORIGIN}/hr/employees?tab=leave&highlight=New%20leave`);
  assert.equal(H.pageLink(ORIGIN, '/owners/statements/:id'), null);
  const dc = (await H.howTo({ topic: 'dc-create-quotation' }, ORIGIN, yes, 'dream_crafter')).value.guides[0];
  assert.ok(dc.engineScreenNote, 'engine screen not marked');
  assert.ok(dc.steps.every(s => s.engineScreen));
});

test('how_to canDo follows the ERP access exactly (gate per request, level per area)', async () => {
  for (const id of ['create-reservation', 'dc-create-quotation']) {
    const denied = await H.howTo({ topic: id }, ORIGIN, no);
    assert.equal(denied.value.guides[0].canDo, false);
    assert.equal(denied.value.guides[0].note, H.NO_PERMISSION_NOTE);
    const allowed = await H.howTo({ topic: id }, ORIGIN, yes);
    assert.equal(allowed.value.guides[0].canDo, true);
    assert.equal(allowed.value.guides[0].note, undefined);
  }
  // Exactly the guide's own permissions decide.
  for (const g of GUIDES) {
    assert.equal(await H.guideCanDo(g, only(new Set(g.permission.concat(g.permissionAny?.slice(0, 1) ?? [])))), true, `${g.id} with its own permissions`);
  }
  // Area levels rank: edit satisfies view, view does not satisfy edit.
  const q = GUIDES.find(g => g.id === 'dc-create-quotation');
  assert.equal(await H.guideCanDo(q, only(new Set(['area:scSales:full']))), true);
  assert.equal(await H.guideCanDo(q, only(new Set(['area:scSales:view']))), false);
  // OR-gate: billing an instalment with Invoices at edit, or Sales order at edit; neither -> no.
  const bill = GUIDES.find(g => g.id === 'dc-bill-instalment');
  assert.equal(await H.guideCanDo(bill, only(new Set(['area:scInvoices:edit']))), true);
  assert.equal(await H.guideCanDo(bill, only(new Set(['area:scSales:edit']))), true);
  assert.equal(await H.guideCanDo(bill, only(new Set(['area:scSales:view']))), false);
  // A malformed permission never grants.
  assert.equal(await H.holds(yes, 'nonsense'), false);
  assert.match(permissionProblem('nonsense'), /neither/);
});

test('how_to: no match lists the titles and is logged as a gap, personal data stripped', async () => {
  const r = await H.howTo({ question: 'zzqq xyzzy' }, ORIGIN, yes, 'conts');
  assert.equal(r.matched, false);
  assert.ok(r.value.guides.length >= 12);
  assert.ok(r.value.guides.every(g => GUIDES.find(x => x.id === g.id).companies.includes('conts')));
  assert.equal(H.scrubQuestion('email ali@x.com about TC-SO-2611-031 call 012-345 6789'), 'email [email] about TC-[doc] call [number]');
});

test('module_overview, onboarding answer for the person\'s company; canOpen follows the area level', async () => {
  const all = await H.moduleOverview({}, ORIGIN, yes, 'dream_crafter');
  assert.ok(all.value.modules.some(m => m.id === 'projects'));
  assert.ok(!all.value.modules.some(m => m.id === 'reservations'));
  const res = await H.moduleOverview({ module: 'reservations' }, ORIGIN, no, 'conts');
  assert.equal(res.value.id, 'reservations');
  assert.ok(res.value.pages.every(p => p.canOpen === false));
  const ob = await H.onboarding({ role: 'finance' }, ORIGIN, yes, 'conts');
  assert.equal(ob.value.role, 'finance');
  assert.ok(ob.value.path.length >= 5);
  const dc = await H.onboarding({ role: 'renovation-sales' }, ORIGIN, yes, 'dream_crafter');
  assert.equal(dc.value.role, 'renovation-sales');
  assert.equal((await H.onboarding({}, ORIGIN, yes, 'dream_crafter')).value.roles.every(r => r.role.startsWith('renovation')), true);
});

test('company resolution', () => {
  assert.equal(H.resolveCompany(undefined, 'conts'), 'conts');
  assert.equal(H.resolveCompany(undefined, 'dream_crafter'), 'dream_crafter');
  assert.equal(H.resolveCompany(undefined, 'both'), '');
  assert.equal(H.resolveCompany('Dream Crafter', 'conts'), 'dream_crafter');
  assert.equal(H.resolveCompany('The Conts', 'dream_crafter'), 'conts');
  assert.equal(H.resolveCompany('all', 'conts'), '');
});

test('gap log: an unanswered help question is logged with no-guide and the scrubbed question; answered ones are not', async () => {
  const T = H;
  const miss = T.helpOutcome('how_to', { question: 'how do I zzqq for ali@x.com 012-345 6789' }, await H.howTo({ question: 'zzqq' }, ORIGIN, yes, 'conts'));
  assert.equal(miss.note, H.NO_GUIDE_NOTE);
  assert.equal(miss.target, 'how do I zzqq for [email] [number]');
  const hit = T.helpOutcome('glossary', { term: 'VO' }, H.glossary({ term: 'VO' }, ORIGIN));
  assert.equal(hit.note, '');
  assert.equal(T.askedOf({ visible_text: ['Today', 'Guest left'] }), 'Today | Guest left');
  // Every help tool is read-only and listed.
  for (const t of T.HOWTO_TOOLS) assert.equal(t.annotations.readOnlyHint, true);
  assert.deepEqual(T.HOWTO_TOOLS.map(t => t.name), ['how_to', 'module_overview', 'glossary', 'explain_error', 'onboarding']);
  assert.match(permissionProblem('PUT /api/nothing-here-at-all'), /no PUT handler/);
});
