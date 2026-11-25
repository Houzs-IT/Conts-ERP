// ----------------------------------------------------------------------------
// /api/scm/commission — sales commission on renovation contracts (Conts, owner 25 Nov 2026).
//
//   GET    /                      every live contract with its commission per person, the schemes, payouts, monthly sales
//   POST   /schemes               add a scheme (one per brand)   PUT /schemes/:id   change one   DELETE /schemes/:id
//   POST   /payouts               record commission paid { soDocNo, staffId, amountSen, paidOn, note }
//   POST   /payouts/batch         the monthly settlement: several payouts at once { paidOn, items: [{ soDocNo, staffId, amountSen }] }
//   POST   /payouts/:id/void      take a payout back (kept, marked voided)
//
// Once the month a part of a contract was sold in has ended, the GET fixes that part's people and rates in
// scm.reno_commission_locks (migration 0375), so an order claimed a year later still pays what it earned then.
//
// Who sees what (owner, 25 Nov 2026: commission is sensitive):
//   - management (the `*` grant): every order and every person; sets every scheme; records payouts.
//   - the sales manager of a scheme (Mengkeat, William): every order of that scheme; can change that scheme.
//   - everyone else: only their own share of the orders they sold, nothing about anyone else.
//   `?mine=1` answers anyone with their own share only (the My commission page), management included. The math is scm/shared/renovation-commission.ts; the
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
  contractCommission, contractPortions, monthlySales, portionKey, schemeProblems, type CommissionScheme, type CommissionStage, type CommissionTier,
  type ContractCommission, type ContractPortion, type PortionLock,
} from '../shared/renovation-commission';

type C = Context<{ Bindings: Env; Variables: Variables }>;
type Row = Record<string, unknown>;

export const renovationCommission = new Hono<{ Bindings: Env; Variables: Variables }>();
renovationCommission.use('*', supabaseAuth);

/* Management only: adding or deleting a scheme, and paying commission out. */
const adminOnly = (c: C) => (hasHouzsPerm(c, '*') ? null : c.json({ error: 'forbidden', message: 'Only management can do this.' }, 403));

/** The caller's own scm.staff id (salesperson vocabulary), from the real Houzs user id. */
async function viewerStaffId(c: C): Promise<string | null> {
  const uid = Number((c.get('houzsUser') as { id?: number } | undefined)?.id);
  if (!Number.isFinite(uid)) return null;
  const { data } = await c.get('supabase').from('staff').select('id').eq('user_id', uid).limit(1).maybeSingle();
  return data ? String((data as Row).id) : null;
}

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
  const isAdmin = hasHouzsPerm(c, '*');
  const mine = c.req.query('mine') === '1';
  const me = await viewerStaffId(c);
  if (!me && (mine || !isAdmin)) return c.json({ error: 'forbidden', message: 'Your login is not linked to a staff record, so there is no commission to show.' }, 403);
  try {
    const [contracts, schemesRes, payoutsRes, staffRes, locksRes] = await Promise.all([
      renoProjectRows(sb, co.companyId, todayMyt()),
      sb.from('reno_commission_schemes').select('*').eq('company_id', co.companyId).order('name'),
      sb.from('reno_commission_payouts').select('id, so_doc_no, staff_id, amount_sen, paid_on, note, created_by, created_at, voided_at, voided_by')
        .eq('company_id', co.companyId).order('paid_on', { ascending: false }),
      sb.from('staff').select('id, name, user_id, active').order('name'),
      sb.from('reno_commission_locks').select('so_doc_no, portion_ref, salesperson_id, manager_staff_id, month_sales_sen, sales_bp, manager_bp, locked_at')
        .eq('company_id', co.companyId).limit(100_000),
    ]);
    for (const r of [schemesRes, payoutsRes, staffRes, locksRes]) if (r.error) throw new Error(r.error.message);
    const locksByDoc = new Map<string, Map<string, PortionLock>>();
    for (const l of (locksRes.data ?? []) as Row[]) {
      const m = locksByDoc.get(String(l.so_doc_no)) ?? new Map<string, PortionLock>();
      m.set(String(l.portion_ref), {
        salespersonId: (l.salesperson_id as string | null) ?? null, managerStaffId: (l.manager_staff_id as string | null) ?? null,
        monthSalesSen: Number(l.month_sales_sen ?? 0), salesBp: Number(l.sales_bp), managerBp: Number(l.manager_bp), lockedAt: String(l.locked_at),
      });
      locksByDoc.set(String(l.so_doc_no), m);
    }
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

    const thisMonth = todayMyt().slice(0, 7);
    const lockStamp = new Date().toISOString();
    const newLocks: Row[] = [];
    const rows = prepared.map(({ k, spId, soDate, branding, scheme, portions }) => {
      const problem = !spId ? 'no_salesperson' : !scheme ? 'no_scheme' : null;
      const calc: ContractCommission | null = spId && scheme
        ? contractCommission({ baseSen: k.revisedContractSen, collectedSen: k.receivedSen, instalments: plan.get(k.soDocNo) ?? [] },
          portions, scheme, spId, salesByScheme.get(scheme.id) ?? new Map(), paidByDoc.get(k.soDocNo) ?? new Map(), locksByDoc.get(k.soDocNo))
        : null;
      /* Parts sold in a month that has ended are fixed now, at the rates just worked out. */
      if (calc && scheme) {
        for (const p of calc.portions) {
          if (p.lockedAt || p.month >= thisMonth) continue;
          newLocks.push({
            company_id: co.companyId, so_doc_no: k.soDocNo, portion_ref: portionKey(p), month: p.month, scheme_id: scheme.id,
            salesperson_id: p.salespersonId, manager_staff_id: p.managerStaffId, month_sales_sen: p.monthSalesSen,
            sales_bp: p.salesBp, manager_bp: p.managerBp, locked_at: lockStamp,
          });
          p.lockedAt = lockStamp;
        }
      }
      return {
        soDocNo: k.soDocNo, soDate, projectName: k.projectName, customerName: k.customerName, status: k.status, branding,
        salespersonId: spId, salespersonName: spId ? staffName.get(spId) ?? k.salesperson : null,
        schemeId: scheme?.id ?? null, schemeName: scheme?.name ?? null, problem,
        baseSen: k.revisedContractSen, collectedSen: k.receivedSen,
        collectedBp: calc?.collectedBp ?? (k.revisedContractSen > 0 ? Math.min(10_000, Math.floor((k.receivedSen * 10_000) / k.revisedContractSen)) : 0),
        releasedBp: calc?.releasedBp ?? 0, stages: calc?.stages ?? [], companyPoolSen: calc?.companyPoolSen ?? 0,
        portions: (calc?.portions ?? portions.map((p) => ({ ...p, monthSalesSen: 0, salesBp: 0, managerBp: 0, salesSen: 0, managerSen: 0, salespersonId: spId ?? '', managerStaffId: null, lockedAt: null })))
          .map((p) => ({ ...p, salespersonName: staffName.get(p.salespersonId) ?? '', managerName: p.managerStaffId ? staffName.get(p.managerStaffId) ?? '' : null })),
        shares: (calc?.shares ?? []).map((s) => ({ ...s, staffName: staffName.get(s.staffId) ?? '' })),
      };
    });
    if (newLocks.length > 0) {
      for (let i = 0; i < newLocks.length; i += 500) {
        const { error } = await sb.from('reno_commission_locks')
          .upsert(newLocks.slice(i, i + 500), { onConflict: 'company_id,so_doc_no,portion_ref', ignoreDuplicates: true });
        if (error) throw new Error(`Could not fix the closed months: ${error.message}`);
      }
    }
    /* Sales per person per month, for the tier each month landed on. */
    const months = [...salesByScheme].flatMap(([schemeId, m]) => [...m].map(([key, sen]) => {
      const [staffId, month] = key.split('|');
      return { schemeId, staffId, staffName: staffName.get(staffId) ?? '', month, salesSen: sen };
    })).sort((a, b) => b.month.localeCompare(a.month) || a.staffName.localeCompare(b.staffName));
    const staff = ((staffRes.data ?? []) as Row[]).filter((s) => s.user_id != null && s.active !== false).map((s) => ({ id: String(s.id), name: String(s.name ?? '') }));
    const brandings = [...new Set(orders.map((o) => String(o.branding ?? '')).filter(Boolean))].sort();
    /* What this caller may see: everything, their schemes' orders, or only their own share. */
    const managed = new Set(isAdmin && !mine ? live.map((s) => s.id) : live.filter((s) => s.managerStaffId === me).map((s) => s.id));
    const seeAll = isAdmin && !mine;
    const seesRow = (r: (typeof rows)[number]) => seeAll || (!mine && r.schemeId != null && managed.has(r.schemeId));
    const outRows = seeAll ? rows : rows.flatMap((r) => {
      if (seesRow(r)) return [r];
      const own = r.shares.filter((s) => s.staffId === me);
      if (own.length === 0) return [];
      return [{
        ...r, shares: own, companyPoolSen: 0,
        portions: r.portions.map((p) => ({
          ...p,
          ...(p.salespersonId === me ? {} : { salesBp: 0, salesSen: 0, monthSalesSen: 0, salespersonName: '' }),
          ...(p.managerStaffId === me ? {} : { managerBp: 0, managerSen: 0, managerName: null }),
        })),
      }];
    });
    const docsSeen = new Set(outRows.map((r) => r.soDocNo));
    const outPayouts = seeAll ? payouts : payouts.filter((p) => docsSeen.has(p.soDocNo) && (p.staffId === me || (!mine && rows.some((r) => r.soDocNo === p.soDocNo && seesRow(r)))));
    const outMonths = seeAll ? months : months.filter((m) => m.staffId === me || (!mine && managed.has(m.schemeId)));
    const outSchemes = seeAll ? schemes : mine ? [] : schemes.filter((s) => managed.has(s.id));
    const viewer = {
      staffId: me, isAdmin: seeAll, canPay: seeAll, canAddScheme: seeAll,
      editableSchemeIds: seeAll ? schemes.map((s) => s.id) : mine ? [] : [...managed],
    };
    return c.json({ rows: outRows, schemes: outSchemes, payouts: outPayouts, staff: seeAll || managed.size > 0 ? staff : [], months: outMonths, brandings: seeAll ? brandings : [], viewer });
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
  const denied = adminOnly(c);
  if (denied) return denied;
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
  const raw = (await c.req.json().catch(() => ({}))) as Row;
  const b = schemeBody(raw);
  if (!b.ok) return c.json({ error: 'invalid', message: b.problems.join(' '), problems: b.problems }, 400);
  const sb = c.get('supabase');
  /* A scheme's own sales manager may change it, but not hand it to someone else or move it to another brand. */
  if (!hasHouzsPerm(c, '*')) {
    const me = await viewerStaffId(c);
    const { data: cur } = await sb.from('reno_commission_schemes').select('manager_staff_id, branding').eq('id', c.req.param('id')).eq('company_id', co.companyId).maybeSingle();
    const curRow = (cur ?? null) as Row | null;
    if (!me || !curRow || curRow.manager_staff_id !== me) return c.json({ error: 'forbidden', message: 'Only management or this scheme\'s sales manager can change it.' }, 403);
    b.row.manager_staff_id = curRow.manager_staff_id;
    b.row.branding = curRow.branding;
  }
  const { data, error } = await sb.from('reno_commission_schemes').update(b.row)
    .eq('id', c.req.param('id')).eq('company_id', co.companyId).select('*').maybeSingle();
  if (error) return c.json({ error: 'save_failed', message: dupBrand(error.message) ? DUP : error.message }, dupBrand(error.message) ? 409 : 500);
  if (!data) return c.json({ error: 'not_found', message: 'That scheme does not exist.' }, 404);
  /* "Apply to closed months too": the fixed rates of this scheme's closed months are dropped, and the next read fixes
     them again at the new rates. Paid money stays paid; what is left to claim follows the new figure. */
  if (raw.relockClosedMonths === true) {
    const { error: e2 } = await sb.from('reno_commission_locks').delete().eq('company_id', co.companyId).eq('scheme_id', c.req.param('id'));
    if (e2) return c.json({ error: 'save_failed', message: `Saved, but the closed months were not recalculated: ${e2.message}` }, 500);
  }
  return c.json(schemeOf(data as Row));
});

/* Deleted only while no commission has been paid; otherwise switch it off, so the payouts still read. */
renovationCommission.delete('/schemes/:id', async (c) => {
  const denied = adminOnly(c);
  if (denied) return denied;
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
  const denied = adminOnly(c);
  if (denied) return denied;
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

/* The monthly settlement: every claim ticked is paid in one go, all or nothing. */
renovationCommission.post('/payouts/batch', async (c) => {
  const denied = adminOnly(c);
  if (denied) return denied;
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const raw = (await c.req.json().catch(() => ({}))) as Row;
  const paidOn = String(raw.paidOn ?? '').trim();
  const items = (Array.isArray(raw.items) ? (raw.items as unknown[]) : []).map((x) => (x ?? {}) as Row).map((x) => ({
    soDocNo: String(x.soDocNo ?? '').trim(), staffId: String(x.staffId ?? '').trim(), amountSen: Math.round(Number(x.amountSen ?? 0)),
  }));
  const problems = [
    ...(!ISO.test(paidOn) ? ['Enter the date it was paid.'] : []),
    ...(items.length === 0 ? ['Tick at least one claim.'] : []),
    ...(items.some((x) => !x.soDocNo || !x.staffId || !(x.amountSen > 0)) ? ['Every claim needs an order, a person and an amount above zero.'] : []),
  ];
  if (problems.length > 0) return c.json({ error: 'invalid', message: problems.join(' '), problems }, 400);
  const docs = [...new Set(items.map((x) => x.soDocNo))];
  const { data: found, error: e1 } = await sb.from('mfg_sales_orders').select('doc_no').eq('company_id', co.companyId).in('doc_no', docs);
  if (e1) return c.json({ error: 'save_failed', message: e1.message }, 500);
  const known = new Set((found as Row[]).map((r) => String(r.doc_no)));
  const missing = docs.filter((d) => !known.has(d));
  if (missing.length > 0) return c.json({ error: 'not_found', message: `Sales order ${missing.join(', ')} does not exist.` }, 404);
  const note = String(raw.note ?? '').trim().slice(0, 500) || `Commission settlement ${paidOn}`;
  const { error } = await sb.from('reno_commission_payouts').insert(items.map((x) => ({
    company_id: co.companyId, so_doc_no: x.soDocNo, staff_id: x.staffId, amount_sen: x.amountSen, paid_on: paidOn, note, created_by: who(c),
  })));
  if (error) return c.json({ error: 'save_failed', message: error.message }, 500);
  return c.json({ count: items.length, totalSen: items.reduce((t, x) => t + x.amountSen, 0) }, 201);
});

renovationCommission.post('/payouts/:id/void', async (c) => {
  const denied = adminOnly(c);
  if (denied) return denied;
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const { data, error } = await c.get('supabase').from('reno_commission_payouts')
    .update({ voided_at: new Date().toISOString(), voided_by: who(c) })
    .eq('id', c.req.param('id')).eq('company_id', co.companyId).is('voided_at', null).select('id').maybeSingle();
  if (error) return c.json({ error: 'save_failed', message: error.message }, 500);
  if (!data) return c.json({ error: 'not_found', message: 'That payout does not exist or was taken back already.' }, 404);
  return c.json({ ok: true });
});
