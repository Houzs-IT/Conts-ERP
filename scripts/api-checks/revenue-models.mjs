// Revenue models (migration 0093): the five models in the statement engine (functions/_lib/ownerStatement.ts),
// the backfill rule (functions/_lib/revenueModel.ts modelOf), contract history, and "Paid by" (only owner-paid
// expenses reach the statement). Pure checks run with no database; with BIGDATA_PORT set (the local real-data
// database from hostplatform-import.mjs --serve) it also checks the data, inside a transaction that is rolled back.
//
// Run: node scripts/api-checks/revenue-models.mjs
//      BIGDATA_PORT=55493 node scripts/api-checks/revenue-models.mjs      (also against the local database)
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = await build({
  stdin: { contents: `export * from './functions/_lib/ownerStatement.ts'; export * from './functions/_lib/revenueModel.ts';`, resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'error',
});
const tmp = mkdtempSync(join(tmpdir(), 'rm-check-'));
writeFileSync(join(tmp, 'm.mjs'), out.outputFiles[0].text);
const M = await import(pathToFileURL(join(tmp, 'm.mjs')).href);

let fails = 0;
const check = (name, ok, more = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${more ? ` :: ${more}` : ''}`); };
const rm = sen => (sen / 100).toFixed(2);

const unit = (over = {}) => ({
  id: 'u', owner_id: 'o', owner_name: 'x', unit_number: 'A-1', unit_code: null, property_name: 'Demo', address: null, package: 'Package A', term: 'Short term',
  split_kind: 'Profit share', split_value: 75, unit_misc: 0, contract_id: 'c', model: 'management', management_fee_pct: 25, grr_amount: 0, starts_on: '2026-01-01', ends_on: null,
  minimum_guarantee: 0, guarantee_starts_on: null, guarantee_ends_on: null, contract_misc: 0, revenue_model: null, tenant_name: null, agent_fee_pct: null, ...over,
});
const stay = (ci, co, amount, id = `s${ci}`) => ({ id, unit_id: 'u', check_in: ci, check_out: co, collected_revenue: amount, channel: 'airbnb', external_ref: null, guest_name: 'Guest' });
const cost = (id, category, amount, day = '2026-09-15', description = category) => ({ id, unit_id: 'u', category, description, amount, incurred_on: day, reference: null, task_kind: null });
const month = (u, stays, costs, adj = []) => M.computeUnitMonth('2026-09', u, M.termsFor(u, 25), stays, costs, adj, 10000);
const adds = m => m.gross - m.deductions === m.net && m.payoutBeforeAdjustments + m.adjustmentsTotal === m.netPayout;

/* ---------- 1. The backfill rule: what each existing contract reads as ---------- */
console.log('1. Backfill rule (modelOf)');
check('GRR contract -> grr', M.modelOf({ contract_id: 'c', model: 'grr', minimum_guarantee: 0, package: 'Package C' }) === 'grr');
check('GRR contract on Package D stays grr (the engine always paid it as rent)', M.modelOf({ contract_id: 'c', model: 'grr', package: 'Package D' }) === 'grr');
check('contract with a monthly minimum -> management_guarantee', M.modelOf({ contract_id: 'c', model: 'management', minimum_guarantee: 280000, package: 'Package B' }) === 'management_guarantee');
check('Package D -> management_guarantee', M.modelOf({ contract_id: 'c', model: 'management', minimum_guarantee: 0, package: 'Package D' }) === 'management_guarantee');
check('profit share / management fee -> management', M.modelOf({ contract_id: 'c', model: 'management', minimum_guarantee: 0, package: 'Package A' }) === 'management');
check('a chosen model wins', M.modelOf({ contract_id: 'c', revenue_model: 'long_term', model: 'management' }) === 'long_term');
check('no contract, GRR split -> grr', M.modelOf({ contract_id: null, split_kind: 'GRR — guaranteed rent', split_value: 300000 }) === 'grr');
check('no contract, profit share -> management', M.modelOf({ contract_id: null, split_kind: 'Profit share', split_value: 75 }) === 'management');

/* ---------- 2. Existing models give the same terms with or without the stored model ---------- */
console.log('\n2. Stored revenue_model vs the rule: same terms');
for (const [what, over, stored] of [
  ['management 75/25', { model: 'management', management_fee_pct: 25 }, 'management'],
  ['Package D minimum', { model: 'management', management_fee_pct: 25, minimum_guarantee: 280000, package: 'Package D', guarantee_starts_on: '2026-09-07' }, 'management_guarantee'],
  ['GRR', { model: 'grr', grr_amount: 300000, management_fee_pct: 0 }, 'grr'],
]) {
  const a = M.termsFor(unit(over), 25), b = M.termsFor(unit({ ...over, revenue_model: stored }), 25);
  const keys = ['basis', 'model', 'ownerPct', 'fixedRent', 'guarantee', 'guaranteeFrom', 'miscCharges'];
  check(`${what}: identical`, keys.every(k => a[k] === b[k]), keys.map(k => `${k} ${a[k]}`).join(', '));
}

/* ---------- 3. Each model on one month ---------- */
console.log('\n3. One month per model (September, 30 days)');
const stays = [stay('2026-09-01', '2026-09-11', 300000), stay('2026-09-15', '2026-09-25', 400000)];
const costs = [cost('e1', 'electricity', 30000), cost('c1', 'cleaning', 8000), cost('c2', 'cleaning', 8000), cost('i1', 'sewerage', 800, '2026-09-20', 'Indah Water')];
{
  const m = month(unit({ management_fee_pct: 25, agent_fee_pct: 5 }), stays, costs);
  check('management 75/20/5: income 7,000.00, costs 468.00, owner 75% of net', m.gross === 700000 && m.deductions === 46800 && m.net === 653200 && m.payoutBeforeAdjustments === 489900 && m.operatorShare === 163300 && adds(m),
    `income ${rm(m.gross)} costs ${rm(m.deductions)} net ${rm(m.net)} owner ${rm(m.payoutBeforeAdjustments)} operator ${rm(m.operatorShare)}`);
  check('Indah Water (category sewerage) is its own report row', m.deductionGroups.find(g => g.category === 'sewerage').amount === 800);
}
{
  const m = month(unit({ revenue_model: 'management_guarantee', minimum_guarantee: 600000 }), stays, costs);
  check('management_guarantee: share 4,899.00 below the 6,000.00 minimum -> top-up 1,101.00', m.payoutBeforeAdjustments === 600000 && m.topUp === 110100 && adds(m), `payout ${rm(m.payoutBeforeAdjustments)} top-up ${rm(m.topUp)}`);
  const n = month(unit({ revenue_model: 'management', minimum_guarantee: 600000 }), stays, costs);
  check('management never applies a guarantee left on the record', n.topUp === 0 && n.guarantee === 0);
}
{
  const m = month(unit({ revenue_model: 'grr', model: 'grr', grr_amount: 300000, management_fee_pct: 0 }), stays, costs);
  check('grr: the owner gets 3,000.00 whatever the unit earned', m.payoutBeforeAdjustments === 300000 && m.lines.filter(l => l.type !== 'adjustment').length === 0, `payout ${rm(m.payoutBeforeAdjustments)}`);
}
{
  const u = unit({ revenue_model: 'master_lease', grr_amount: 250000, management_fee_pct: 0 });
  const m = month(u, stays, costs);
  check('master_lease: no statement (nothing earned, nothing deducted)', !M.hasActivity(m) && m.netPayout === 0 && m.deductions === 0 && m.gross === 0);
  const adj = [{ id: 'a1', owner_id: 'o', unit_id: 'u', kind: 'credit', amount: 5000, description: 'Water refund', occurred_on: '2026-09-03', reference: null, state: 'open', statement_id: null }];
  const w = month(u, stays, costs, adj);
  check('master_lease: an owner credit still reaches the owner', M.hasActivity(w) && w.netPayout === 5000);
}
{
  const u = unit({ revenue_model: 'long_term', grr_amount: 300000, management_fee_pct: 10, tenant_name: 'Tenant A' });
  const m = month(u, stays, costs);
  check('long_term: rent 3,000.00, owner-paid costs 468.00 off, 10% fee of the rent; bookings ignored',
    m.gross === 300000 && m.nights === 0 && m.deductions === 46800 && m.operatorShare === 30000 && m.payoutBeforeAdjustments === 300000 - 46800 - 30000 && adds(m) && M.hasActivity(m),
    `income ${rm(m.gross)} costs ${rm(m.deductions)} fee ${rm(m.operatorShare)} payout ${rm(m.payoutBeforeAdjustments)}`);
  check('long_term: one rent line names the tenant', m.lines.some(l => l.type === 'gross' && l.category === 'long_term_rent' && /Tenant A/.test(l.description)));
  const half = month({ ...u, starts_on: '2026-09-16' }, [], []);
  check('long_term: tenancy from 16 Sep -> 15 of 30 days of rent', half.gross === 150000 && half.operatorShare === 15000, `income ${rm(half.gross)}`);
  check('long_term: no miscellaneous charge even if flagged', month({ ...u, contract_misc: 1 }, [], []).deductionGroups.find(g => g.category === 'misc').amount === 0);
}

/* ---------- 4. Contract history ---------- */
console.log('\n4. Contract history (unitForMonth)');
{
  const u = unit({ contract_id: 'new', starts_on: '2026-09-01', revenue_model: 'management', management_fee_pct: 25,
    history: [
      { id: 'new', unit_id: 'u', revenue_model: 'management', model: 'management', management_fee_pct: 25, grr_amount: 0, starts_on: '2026-09-01', ends_on: null, minimum_guarantee: 0, guarantee_starts_on: null, guarantee_ends_on: null, misc_charges: 0, tenant_name: null, agent_fee_pct: null },
      { id: 'old', unit_id: 'u', revenue_model: 'grr', model: 'grr', management_fee_pct: 0, grr_amount: 280000, starts_on: '2025-09-01', ends_on: '2026-08-31', minimum_guarantee: 0, guarantee_starts_on: null, guarantee_ends_on: null, misc_charges: 0, tenant_name: null, agent_fee_pct: null },
    ] });
  const aug = M.computeMonth('2026-08', { units: [u], stays: [], costs: [], adjustments: [] }, { defaultFeePct: 25, miscMonthly: 10000 }, 'dated')[0];
  const sep = M.computeMonth('2026-09', { units: [u], stays: [], costs: [], adjustments: [] }, { defaultFeePct: 25, miscMonthly: 10000 }, 'dated')[0];
  check('August is worked out on the earlier GRR contract', aug.terms.model === 'grr' && aug.payoutBeforeAdjustments === 280000);
  check('September on the new management contract', sep.terms.model === 'management' && sep.fixedRent === 0);
  const only = M.computeMonth('2026-08', { units: [unit({ starts_on: '2026-09-01' })], stays: [], costs: [], adjustments: [] }, { defaultFeePct: 25, miscMonthly: 10000 }, 'dated')[0];
  check('with no earlier contract, the current one applies (as before 0093)', only.terms.model === 'management' && only.terms.source === 'contract');
}

/* ---------- 5. The Contract tab's rules ---------- */
console.log('\n5. Contract form rules (invalidDraft / draftColumns)');
check('owner + management + agent must add to 100', !!M.invalidDraft({ revenueModel: 'management', ownerPct: 75, managementPct: 20, agentPct: 10, startsOn: '2026-09-01' }).ownerPct);
check('75/20/5 is valid', Object.keys(M.invalidDraft({ revenueModel: 'management', ownerPct: 75, managementPct: 20, agentPct: 5, startsOn: '2026-09-01' })).length === 0);
check('a guarantee needs its monthly minimum', !!M.invalidDraft({ revenueModel: 'management_guarantee', ownerPct: 75, managementPct: 25, startsOn: '2026-09-01' }).minimumGuarantee);
check('a long-term let needs its tenant', !!M.invalidDraft({ revenueModel: 'long_term', monthlyRent: 200000, startsOn: '2026-09-01' }).tenantName);
{
  const c = M.draftColumns({ revenueModel: 'grr', monthlyRent: 300000, ownerPct: 75, minimumGuarantee: 280000, startsOn: '2026-09-01' });
  check('switching to GRR clears the share and the guarantee', c.model === 'grr' && c.minimum_guarantee === 0 && c.management_fee_pct === 0 && c.grr_amount === 300000);
  const d = M.draftColumns({ revenueModel: 'management', ownerPct: 75, managementPct: 20, agentPct: 5, monthlyRent: 300000, startsOn: '2026-09-01' });
  check('management stores the operator share 25% (agent 5%) and no rent', d.management_fee_pct === 25 && d.agent_fee_pct === 5 && d.grr_amount === 0);
}

/* ---------- 5b. Yearly guarantee (PS YGRR, staff sheet 17 Oct 2026) ---------- */
console.log('5b. Yearly guarantee');
{
  const yu = (over = {}) => unit({ revenue_model: 'management_yearly_guarantee', starts_on: '2025-10-01', minimum_guarantee_annual: 3600000, ...over });
  const y = M.yearlyFor('2026-09', '2025-10-01', null, 3600000);
  check('Sep 2026 closes the contract year Oct 2025 - Sep 2026', y && y.trueUp && y.yearFrom === '2025-10' && y.yearTo === '2026-09' && y.due === 3600000, JSON.stringify(y));
  check('Aug 2026 is inside the year, no true-up', M.yearlyFor('2026-08', '2025-10-01', null, 3600000)?.trueUp === false);
  check('a contract ending in Mar 2026 trues up in Mar, guarantee prorated 6/12', (() => { const z = M.yearlyFor('2026-03', '2025-10-01', '2026-03-31', 3600000); return z?.trueUp && z.due === 1800000; })());
  const s1 = [stay('2026-09-01', '2026-09-11', 200000)];
  const mid = M.computeUnitMonth('2026-08', yu(), M.termsFor(yu(), 25), [stay('2026-08-01', '2026-08-11', 200000)], [], [], 10000);
  check('a month inside the year: plain 75% share, no top-up', mid.topUp === 0 && mid.payoutBeforeAdjustments === 150000 && mid.guarantee === 0, `${mid.topUp} ${mid.payoutBeforeAdjustments}`);
  const short = { ...yu(), year_shares_before: 1650000 };
  const end = M.computeUnitMonth('2026-09', short, M.termsFor(short, 25), s1, [], [], 10000);
  check('year-end below the guarantee: tops up RM 36,000 - (16,500 + 1,500) = RM 18,000', end.topUp === 1800000 && end.payoutBeforeAdjustments === 150000 + 1800000 && end.guarantee === 3600000 && adds(end), `${rm(end.topUp)} ${rm(end.payoutBeforeAdjustments)}`);
  check('the top-up line names the year and the shares', end.lines.some(l => l.category === 'guarantee_top_up' && /2025-10 to 2026-09/.test(l.description)));
  const over = { ...yu(), year_shares_before: 3500000 };
  const end2 = M.computeUnitMonth('2026-09', over, M.termsFor(over, 25), s1, [], [], 10000);
  check('year-end above the guarantee: no top-up', end2.topUp === 0 && end2.payoutBeforeAdjustments === 150000);
  const unknown = M.computeUnitMonth('2026-09', yu(), M.termsFor(yu(), 25), s1, [], [], 10000);
  check('year-end with earlier months not worked out: no top-up and a warning', unknown.topUp === 0 && unknown.warnings.some(w => /Yearly guarantee/.test(w)));
  check('existing models unchanged: PS GRR still tops up monthly', (() => { const g = unit({ revenue_model: 'management_guarantee', minimum_guarantee: 300000 }); const m = month(g, s1, []); return m.topUp === 150000 && m.payoutBeforeAdjustments === 300000; })());
}

/* ---------- 6. Against the local database (optional) ---------- */
if (process.env.BIGDATA_PORT) {
  const { default: postgres } = await import('postgres');
  const db = postgres(`postgres://postgres@127.0.0.1:${process.env.BIGDATA_PORT}/postgres`, { max: 1, onnotice: () => {}, connection: { search_path: 'pos' } });
  const numbered = s => { let i = 0; return s.replace(/\?/g, () => `$${++i}`); };
  console.log('\n6. Local database');
  const rows = await db.unsafe(`SELECT c.id, c.revenue_model, c.model, c.minimum_guarantee, u.package FROM owner_contracts c LEFT JOIN units u ON u.contract_id = c.id`);
  const by = rows.reduce((m, r) => { const k = M.modelOf({ ...r, contract_id: r.id }); m[k] = (m[k] ?? 0) + 1; return m; }, {});
  console.log(`   contracts by revenue model: ${JSON.stringify(by)} (${rows.length} contracts)`);
  const sameAsRule = rows.filter(r => r.revenue_model).every(r => r.revenue_model === M.modelOf({ ...r, revenue_model: null, contract_id: r.id }));
  check('every stored revenue_model agrees with the rule', sameAsRule);
  // Paid by: a company-paid bill never reaches the statement, an owner-paid one does. Rolled back.
  const target = (await db.unsafe(`SELECT u.id FROM units u JOIN owner_contracts c ON c.id = u.contract_id WHERE c.model = 'management' ORDER BY u.id LIMIT 1`))[0];
  await db.begin(async tx => {
    const q = (s, ...a) => tx.unsafe(numbered(s), a);
    const settings = await M.statementSettings(q);
    const at = async () => M.computeMonth('2026-09', await M.loadInputs(q, '2026-09-01', '2026-10-01', { unitId: target.id }), settings, 'dated')[0];
    const before = await at();
    await q(`INSERT INTO expenses (id, unit_id, category, description, amount, incurred_on, charge_to, created_at) VALUES ('chk-co', ?, 'maintenance', 'check', 12345, '2026-09-10', 'the_conts', now()::text)`, target.id);
    const company = await at();
    await q(`INSERT INTO expenses (id, unit_id, category, description, amount, incurred_on, charge_to, created_at) VALUES ('chk-ow', ?, 'maintenance', 'check', 12345, '2026-09-10', 'owner', now()::text)`, target.id);
    const owner = await at();
    check('paid by Company: statement unchanged', company.deductions === before.deductions && company.netPayout === before.netPayout);
    check('paid by Owner: deducted on the statement', owner.deductions === before.deductions + 12345, `${rm(before.deductions)} -> ${rm(owner.deductions)}`);
    await q(`INSERT INTO expenses (id, unit_id, category, description, amount, incurred_on, charge_to, created_at) VALUES ('chk-sw', ?, 'sewerage', 'Indah Water', 800, '2026-09-10', 'owner', now()::text)`, target.id);
    check('a sewerage expense is accepted by the database (0093)', true);
    throw Object.assign(new Error('rollback'), { rollback: true });
  }).catch(e => { if (!e.rollback) throw e; });
  await db.end();
}

console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
