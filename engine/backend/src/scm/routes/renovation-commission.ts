// ----------------------------------------------------------------------------
// /api/scm/commission — sales commission on renovation contracts (Conts, owner 25 Nov 2026).
//
//   GET    /                      every live contract with its commission per person, the schemes, payouts, monthly sales
//   POST   /schemes               add a scheme (one per brand)   PUT /schemes/:id   change one   DELETE /schemes/:id
//   POST   /payouts               record commission paid { soDocNo, staffId, amountSen, paidOn, note }
//   POST   /payouts/:id/void      take a payout back (kept, marked voided)
//
// Management only (the `*` grant): it shows every person's pay. The math is scm/shared/renovation-commission.ts; the
// contract sum and the money collected are the Renovation projects page's own figures (acc/reno-projects.ts), so the
// two screens can never disagree about how much a contract has collected.
// ----------------------------------------------------------------------------
import { Hono, type Context } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import { hasHouzsPerm } from '../lib/houzs-perms';
import { requireActiveCompanyId } from '../lib/companyScope';
import { todayMyt } from '../lib/my-time';
import type { Env, Variables } from '../env';
import { renoProjectRows } from '../../acc/reno-projects';
import { inChunks } from '../../acc/reno-completion';
import {
  contractCommission, contractPortions, monthlySales, schemeProblems, type CommissionScheme, type CommissionStage, type CommissionTier,
  type ContractCommission, type ContractPortion,
} from '../shared/renovation-commission';

type C = Context<{ Bindings: Env; Variables: Variables }>;
type Row = Record<string, unknown>;

export const renovationCommission = new Hono<{ Bindings: Env; Variables: Variables }>();
renovationCommission.use('*', supabaseAuth);
renovationCommission.use('*', async (c, next) => {
  if (!hasHouzsPerm(c, '*')) return c.json({ error: 'forbidden', message: 'Commission is for management only.' }, 403);
  await next();
});

const who = (c: C): string => String((c.get('houzsUser') as { name?: string } | undefined)?.name ?? '');
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const day = (v: unknown): string => String(v ?? '').slice(0, 10);

const stagesOf = (raw: unknown): CommissionStage[] => (Array.isArray(raw) ? (raw as unknown[]) : []).map((x) => (x ?? {}) as Row).map((s) => ({
  label: String(s.label ?? ''),
  kind: s.kind === 'instalment' ? 'instalment' : 'collected',
  value: Math.round(Number(s.value ?? 0)),
  releaseBp: Math.round(Number(s.releaseBp ?? 0)),
}));
const tiersOf = (raw: unknown): CommissionTier[] => (Array.isArray(raw) ? (raw as unknown[]) : []).map((x) => (x ?? {}) as Row)
  .map((t) => ({ fromSen: Math.round(Number(t.fromSen ?? 0)), bp: Math.round(Number(t.bp ?? 0)) }))
  .sort((a, b) => a.fromSen - b.fromSen);

type Scheme = CommissionScheme & { active: boolean };
const schemeOf = (r: Row): Scheme => ({
  id: String(r.id), name: String(r.name ?? ''), branding: (r.branding as string | null) ?? null,
  managerStaffId: (r.manager_staff_id as string | null) ?? null, managerBp: Number(r.manager_bp ?? 0),
  companyPoolBp: Number(r.company_pool_bp ?? 0), tiers: tiersOf(r.tiers), stages: stagesOf(r.stages), active: r.active !== false,
});

renovationCommission.get('/', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  try {
    const [contracts, schemesRes, payoutsRes, staffRes] = await Promise.all([
      renoProjectRows(sb, co.companyId, todayMyt()),
      sb.from('reno_commission_schemes').select('*').eq('company_id', co.companyId).order('name'),
      sb.from('reno_commission_payouts').select('id, so_doc_no, staff_id, amount_sen, paid_on, note, created_by, created_at, voided_at, voided_by')
        .eq('company_id', co.companyId).order('paid_on', { ascending: false }),
      sb.from('staff').select('id, name, user_id, active').order('name'),
    ]);
    for (const r of [schemesRes, payoutsRes, staffRes]) if (r.error) throw new Error(r.error.message);
    const docs = contracts.map((k) => k.soDocNo);
    const [orders, instalments, vos] = await Promise.all([
      inChunks(docs, (b, f, t) => sb.from('mfg_sales_orders').select('doc_no, so_date, salesperson_id, branding').eq('company_id', co.companyId).in('doc_no', b).order('doc_no').range(f, t), 'orders'),
      inChunks(docs, (b, f, t) => sb.from('reno_doc_instalments').select('so_doc_no, seq, pct_bp').in('so_doc_no', b).order('so_doc_no').order('seq').range(f, t), 'instalments'),
      inChunks(docs, (b, f, t) => sb.from('reno_variation_orders').select('so_doc_no, vo_no, doc_date, approved_at, net_sen').eq('status', 'APPROVED').in('so_doc_no', b).order('so_doc_no').range(f, t), 'VOs'),
    ]);

    const schemes = ((schemesRes.data ?? []) as Row[]).map(schemeOf);
    const live = schemes.filter((s) => s.active);
    const schemeFor = (branding: string | null): Scheme | undefined =>
      live.find((s) => s.branding != null && s.branding === branding) ?? live.find((s) => s.branding == null);
    const staffName = new Map(((staffRes.data ?? []) as Row[]).map((s) => [String(s.id), String(s.name ?? '')]));
    const payouts = ((payoutsRes.data ?? []) as Row[]).map((p) => ({
      id: String(p.id), soDocNo: String(p.so_doc_no), staffId: String(p.staff_id), staffName: staffName.get(String(p.staff_id)) ?? '',
      amountSen: Number(p.amount_sen), paidOn: day(p.paid_on), note: String(p.note ?? ''),
      createdBy: (p.created_by as string | null) ?? null, voidedAt: (p.voided_at as string | null) ?? null,
    }));
    const paidByDoc = new Map<string, Map<string, number>>();
    for (const p of payouts) {
      if (p.voidedAt) continue;
      const m = paidByDoc.get(p.soDocNo) ?? new Map<string, number>();
      m.set(p.staffId, (m.get(p.staffId) ?? 0) + p.amountSen);
      paidByDoc.set(p.soDocNo, m);
    }
    const orderOf = new Map(orders.map((o) => [String(o.doc_no), o]));
    const plan = new Map<string, Array<{ seq: number; cumBp: number }>>();
    for (const i of instalments) {
      const list = plan.get(String(i.so_doc_no)) ?? [];
      list.push({ seq: Number(i.seq), cumBp: (list.at(-1)?.cumBp ?? 0) + Number(i.pct_bp) });
      plan.set(String(i.so_doc_no), list);
    }
    const vosOf = new Map<string, Array<{ voNo: string; date: string; netSen: number }>>();
    for (const v of vos) {
      const list = vosOf.get(String(v.so_doc_no)) ?? [];
      list.push({ voNo: String(v.vo_no ?? ''), date: day(v.doc_date) || day(v.approved_at), netSen: Number(v.net_sen ?? 0) });
      vosOf.set(String(v.so_doc_no), list);
    }

    /* Every contract split into the months it was sold in, and each salesperson's sales per month within a scheme. */
    const prepared = contracts.map((k) => {
      const o = orderOf.get(k.soDocNo);
      const spId = (o?.salesperson_id as string | null | undefined) ?? null;
      const soDate = day(o?.so_date) || todayMyt();
      const branding = (o?.branding as string | null | undefined) ?? null;
      const scheme = schemeFor(branding);
      const portions: ContractPortion[] = contractPortions(k.soDocNo, soDate, k.revisedContractSen, k.contractSen, vosOf.get(k.soDocNo) ?? []);
      return { k, spId, soDate, branding, scheme, portions };
    });
    const salesByScheme = new Map<string, Map<string, number>>();
    for (const s of live) salesByScheme.set(s.id, monthlySales(prepared.filter((p) => p.scheme?.id === s.id).map((p) => ({ salespersonId: p.spId, portions: p.portions }))));

    const rows = prepared.map(({ k, spId, soDate, branding, scheme, portions }) => {
      const problem = !spId ? 'no_salesperson' : !scheme ? 'no_scheme' : null;
      const calc: ContractCommission | null = spId && scheme
        ? contractCommission({ baseSen: k.revisedContractSen, collectedSen: k.receivedSen, instalments: plan.get(k.soDocNo) ?? [] },
          portions, scheme, spId, salesByScheme.get(scheme.id) ?? new Map(), paidByDoc.get(k.soDocNo) ?? new Map())
        : null;
      return {
        soDocNo: k.soDocNo, soDate, projectName: k.projectName, customerName: k.customerName, status: k.status, branding,
        salespersonId: spId, salespersonName: spId ? staffName.get(spId) ?? k.salesperson : null,
        schemeId: scheme?.id ?? null, schemeName: scheme?.name ?? null, problem,
        baseSen: k.revisedContractSen, collectedSen: k.receivedSen,
        collectedBp: calc?.collectedBp ?? (k.revisedContractSen > 0 ? Math.min(10_000, Math.floor((k.receivedSen * 10_000) / k.revisedContractSen)) : 0),
        releasedBp: calc?.releasedBp ?? 0, stages: calc?.stages ?? [], companyPoolSen: calc?.companyPoolSen ?? 0,
        portions: calc?.portions ?? portions.map((p) => ({ ...p, monthSalesSen: 0, salesBp: 0, managerBp: 0, salesSen: 0, managerSen: 0 })),
        shares: (calc?.shares ?? []).map((s) => ({ ...s, staffName: staffName.get(s.staffId) ?? '' })),
      };
    });
    /* Sales per person per month, for the tier each month landed on. */
    const months = [...salesByScheme].flatMap(([schemeId, m]) => [...m].map(([key, sen]) => {
      const [staffId, month] = key.split('|');
      return { schemeId, staffId, staffName: staffName.get(staffId) ?? '', month, salesSen: sen };
    })).sort((a, b) => b.month.localeCompare(a.month) || a.staffName.localeCompare(b.staffName));
    const staff = ((staffRes.data ?? []) as Row[]).filter((s) => s.user_id != null && s.active !== false).map((s) => ({ id: String(s.id), name: String(s.name ?? '') }));
    const brandings = [...new Set(orders.map((o) => String(o.branding ?? '')).filter(Boolean))].sort();
    return c.json({ rows, schemes, payouts, staff, months, brandings });
  } catch (e) {
    return c.json({ error: 'load_failed', message: e instanceof Error ? e.message : String(e) }, 500);
  }
});

/* ── Schemes ────────────────────────────────────────────────────────────── */
const bp = (v: unknown): number => Math.round(Number(v ?? 0));
function schemeBody(raw: Row): { ok: true; row: Row } | { ok: false; problems: string[] } {
  const t = { name: String(raw.name ?? '').trim(), managerBp: bp(raw.managerBp), companyPoolBp: bp(raw.companyPoolBp), tiers: tiersOf(raw.tiers), stages: stagesOf(raw.stages) };
  const problems = schemeProblems(t);
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    row: {
      name: t.name, branding: typeof raw.branding === 'string' && raw.branding.trim() ? raw.branding.trim() : null,
      manager_staff_id: typeof raw.managerStaffId === 'string' && raw.managerStaffId ? raw.managerStaffId : null,
      manager_bp: t.managerBp, company_pool_bp: t.companyPoolBp, tiers: t.tiers, stages: t.stages,
      active: raw.active !== false, updated_at: new Date().toISOString(),
    },
  };
}
const dupBrand = (msg: string): boolean => /uq_reno_commission_schemes_brand|duplicate key/i.test(msg);
const DUP = 'Another scheme in use already covers this brand. Switch that one off first.';

renovationCommission.post('/schemes', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const b = schemeBody((await c.req.json().catch(() => ({}))) as Row);
  if (!b.ok) return c.json({ error: 'invalid', message: b.problems.join(' '), problems: b.problems }, 400);
  const { data, error } = await c.get('supabase').from('reno_commission_schemes').insert({ ...b.row, company_id: co.companyId }).select('*').single();
  if (error) return c.json({ error: 'save_failed', message: dupBrand(error.message) ? DUP : error.message }, dupBrand(error.message) ? 409 : 500);
  return c.json(schemeOf(data as Row), 201);
});

renovationCommission.put('/schemes/:id', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const b = schemeBody((await c.req.json().catch(() => ({}))) as Row);
  if (!b.ok) return c.json({ error: 'invalid', message: b.problems.join(' '), problems: b.problems }, 400);
  const { data, error } = await c.get('supabase').from('reno_commission_schemes').update(b.row)
    .eq('id', c.req.param('id')).eq('company_id', co.companyId).select('*').maybeSingle();
  if (error) return c.json({ error: 'save_failed', message: dupBrand(error.message) ? DUP : error.message }, dupBrand(error.message) ? 409 : 500);
  if (!data) return c.json({ error: 'not_found', message: 'That scheme does not exist.' }, 404);
  return c.json(schemeOf(data as Row));
});

/* Deleted only while no commission has been paid; otherwise switch it off, so the payouts still read. */
renovationCommission.delete('/schemes/:id', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const id = c.req.param('id');
  const { data: s } = await sb.from('reno_commission_schemes').select('id').eq('id', id).eq('company_id', co.companyId).maybeSingle();
  if (!s) return c.json({ error: 'not_found', message: 'That scheme does not exist.' }, 404);
  const { count } = await sb.from('reno_commission_payouts').select('id', { count: 'exact', head: true }).eq('company_id', co.companyId).is('voided_at', null);
  if ((count ?? 0) > 0) return c.json({ error: 'has_payouts', message: 'Commission has been paid already. Switch the scheme off instead of deleting it.' }, 409);
  const { error } = await sb.from('reno_commission_schemes').delete().eq('id', id).eq('company_id', co.companyId);
  if (error) return c.json({ error: 'delete_failed', message: error.message }, 500);
  return c.json({ ok: true });
});

/* ── Payouts ────────────────────────────────────────────────────────────── */
renovationCommission.post('/payouts', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const raw = (await c.req.json().catch(() => ({}))) as Row;
  const soDocNo = String(raw.soDocNo ?? '').trim();
  const staffId = String(raw.staffId ?? '').trim();
  const amountSen = Math.round(Number(raw.amountSen ?? 0));
  const paidOn = String(raw.paidOn ?? '').trim();
  const problems = [
    ...(!soDocNo || !staffId ? ['Choose the order and the person.'] : []),
    ...(!(amountSen > 0) ? ['Enter an amount above zero.'] : []),
    ...(!ISO.test(paidOn) ? ['Enter the date it was paid.'] : []),
  ];
  if (problems.length > 0) return c.json({ error: 'invalid', message: problems.join(' '), problems }, 400);
  const { data: so } = await sb.from('mfg_sales_orders').select('doc_no').eq('doc_no', soDocNo).eq('company_id', co.companyId).maybeSingle();
  if (!so) return c.json({ error: 'not_found', message: `Sales order ${soDocNo} does not exist.` }, 404);
  const { data, error } = await sb.from('reno_commission_payouts').insert({
    company_id: co.companyId, so_doc_no: soDocNo, staff_id: staffId, amount_sen: amountSen, paid_on: paidOn,
    note: String(raw.note ?? '').trim().slice(0, 500), created_by: who(c),
  }).select('id').single();
  if (error) return c.json({ error: 'save_failed', message: error.message }, 500);
  return c.json({ id: (data as Row).id }, 201);
});

renovationCommission.post('/payouts/:id/void', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const { data, error } = await c.get('supabase').from('reno_commission_payouts')
    .update({ voided_at: new Date().toISOString(), voided_by: who(c) })
    .eq('id', c.req.param('id')).eq('company_id', co.companyId).is('voided_at', null).select('id').maybeSingle();
  if (error) return c.json({ error: 'save_failed', message: error.message }, 500);
  if (!data) return c.json({ error: 'not_found', message: 'That payout does not exist or was taken back already.' }, 404);
  return c.json({ ok: true });
});
