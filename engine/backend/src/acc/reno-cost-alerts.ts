// ----------------------------------------------------------------------------
// Renovation cost alerts (finance, chew 2 Nov 2026; SOP 4.2.1 实际和预计有差;
// plan docs/superpowers/plans/2026-11-02-renovation-expected-cost-review.md
// Task 2). Finance is told only when there is something to decide: whether a
// contract's expected total cost should change.
//
//   LINE_OVER     the purchase orders linked to one contract line
//                 (purchase_order_items.so_item_id) cost more than the line's
//                 cost;
//   LINE_UNDER    they cost less, once the line is fully ordered;
//   PROJECT_OVER  cost spent + ordered but not billed is more than the
//                 expected total cost.
//
// Each only beyond the threshold: the larger of a fixed amount and a share of
// the budget (RM 500 or 5% unless the company set its own). A draft or
// cancelled PO does not count. A handed-over or cancelled contract raises
// nothing: its expected cost no longer matters.
//
// The sweep (every 30 minutes) keeps one OPEN row per line or project in
// scm.reno_cost_alerts. Finance answers a row by changing the expected cost
// (CHANGED) or keeping it (KEPT); the same thing is not raised again until the
// committed figure moves by another threshold. A row whose condition is gone
// (the PO was cancelled, say) is CLEARED. New rows are mailed to HOD only when
// the company switched that on (reno_alert_hod_notify, off by default).
// ----------------------------------------------------------------------------

import { todayMyt } from '../scm/lib/my-time';
import { paginateAll } from '../scm/lib/paginate-all';
import { inChunks } from './reno-completion';
import { renoProjectRows } from './reno-projects';

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST client, untyped throughout the acc layer */
type Db = any;
type Row = Record<string, any>;

export type AlertKind = 'LINE_OVER' | 'LINE_UNDER' | 'PROJECT_OVER';

export interface AlertSettings { minSen: number; pctBp: number; hodNotify: boolean; hodEmails: string[] }
export const DEFAULT_ALERT_SETTINGS: AlertSettings = { minSen: 50_000, pctBp: 500, hodNotify: false, hodEmails: [] };

/** The gap that must be passed: the larger of the fixed amount and the share of the budget. */
export function thresholdSen(budgetSen: number, s: Pick<AlertSettings, 'minSen' | 'pctBp'>): number {
  return Math.max(s.minSen, Math.round((Math.abs(budgetSen) * s.pctBp) / 10_000));
}

export interface AlertInput {
  projects: Array<{ soDocNo: string; expectedCostSen: number; costSpentSen: number; orderedNotBilledSen: number; handedOver: boolean }>;
  lines: Array<{ id: string; soDocNo: string; qty: number; costSen: number; description: string }>;
  /** live: on a PO that is neither draft nor cancelled. */
  poItems: Array<{ soItemId: string; qty: number; totalSen: number; live: boolean; poNumber: string }>;
}
export interface AlertCondition {
  soDocNo: string; kind: AlertKind; soItemId: string | null;
  budgetSen: number; committedSen: number; gapSen: number;
  label: string; poNumbers: string[];
}

/** What should be open now, worked out from the figures alone. */
export function alertConditions(input: AlertInput, s: Pick<AlertSettings, 'minSen' | 'pctBp'>): AlertCondition[] {
  const live = new Map(input.projects.filter((p) => !p.handedOver).map((p) => [p.soDocNo, p]));
  const out: AlertCondition[] = [];
  for (const l of input.lines) {
    if (!live.has(l.soDocNo)) continue;
    const mine = input.poItems.filter((i) => i.live && i.soItemId === l.id);
    if (mine.length === 0) continue;
    const committedSen = mine.reduce((t, i) => t + i.totalSen, 0);
    const orderedQty = mine.reduce((t, i) => t + i.qty, 0);
    const limit = thresholdSen(l.costSen, s);
    const poNumbers = [...new Set(mine.map((i) => i.poNumber).filter(Boolean))].sort();
    const base = { soDocNo: l.soDocNo, soItemId: l.id, budgetSen: l.costSen, committedSen, label: l.description, poNumbers };
    if (committedSen - l.costSen > limit) out.push({ ...base, kind: 'LINE_OVER', gapSen: committedSen - l.costSen });
    else if (orderedQty >= l.qty && l.costSen - committedSen > limit) out.push({ ...base, kind: 'LINE_UNDER', gapSen: l.costSen - committedSen });
  }
  for (const p of live.values()) {
    const committedSen = p.costSpentSen + p.orderedNotBilledSen;
    if (committedSen - p.expectedCostSen > thresholdSen(p.expectedCostSen, s)) {
      out.push({
        soDocNo: p.soDocNo, kind: 'PROJECT_OVER', soItemId: null, budgetSen: p.expectedCostSen, committedSen,
        gapSen: committedSen - p.expectedCostSen, label: '', poNumbers: [],
      });
    }
  }
  return out;
}

/** The plain words for an alert (the same words as the screen). */
export function alertLabel(kind: AlertKind, line: string): string {
  if (kind === 'LINE_OVER') return `Line over budget: ${line}`;
  if (kind === 'LINE_UNDER') return `Line under budget: ${line}`;
  return 'Project cost over the expected cost';
}

const fail = (what: string, e: { message?: string } | null | undefined): never => { throw new Error(`cost alerts: ${what}: ${e?.message ?? 'failed'}`); };

export async function loadAlertSettings(sb: Db, companyId: number): Promise<AlertSettings> {
  const { data, error } = await sb.from('acc_company_settings')
    .select('reno_alert_min_sen, reno_alert_pct_bp, reno_alert_hod_notify, reno_alert_hod_emails').eq('company_id', companyId).maybeSingle();
  if (error) fail('settings', error);
  const r = (data ?? {}) as Row;
  return {
    minSen: r.reno_alert_min_sen == null ? DEFAULT_ALERT_SETTINGS.minSen : Number(r.reno_alert_min_sen),
    pctBp: r.reno_alert_pct_bp == null ? DEFAULT_ALERT_SETTINGS.pctBp : Number(r.reno_alert_pct_bp),
    hodNotify: r.reno_alert_hod_notify === true,
    hodEmails: String(r.reno_alert_hod_emails ?? '').split(/[,;\s]+/).map((x) => x.trim()).filter((x) => x.includes('@')),
  };
}

const keyOf = (a: { so_doc_no?: unknown; soDocNo?: unknown; kind?: unknown; so_item_id?: unknown; soItemId?: unknown }): string =>
  `${String(a.so_doc_no ?? a.soDocNo)}|${String(a.kind)}|${String(a.so_item_id ?? a.soItemId ?? '')}`;

export type SendHodMail = (m: { to: string[]; subject: string; html: string }) => Promise<boolean>;
export interface SweepResult { raised: number; updated: number; cleared: number; mailed: number }

const esc = (s: string): string => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
const rm = (sen: number): string => (sen / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** One company: bring scm.reno_cost_alerts in line with the figures as at today (Malaysia). */
export async function sweepCostAlerts(sb: Db, companyId: number, opts: { today?: string; send?: SendHodMail } = {}): Promise<SweepResult> {
  const today = opts.today ?? todayMyt();
  const settings = await loadAlertSettings(sb, companyId);
  const rows = await renoProjectRows(sb, companyId, today);
  /* A handed-over contract raises nothing: its lines are not read. */
  const docs = rows.filter((r) => !r.handedOver).map((r) => r.soDocNo);
  const nameOf = new Map(rows.map((r) => [r.soDocNo, r.projectName]));

  const items = await inChunks(docs, (b, f, t) => sb.from('mfg_sales_order_items').select('id, doc_no, qty, line_cost_sen, cancelled, description')
    .eq('company_id', companyId).in('doc_no', b).order('id').range(f, t), 'contract lines');
  const liveItems = items.filter((i) => i.cancelled !== true);
  const poItems = await inChunks(liveItems.map((i) => String(i.id)), (b, f, t) => sb.from('purchase_order_items')
    .select('id, purchase_order_id, so_item_id, qty, line_total_sen').eq('company_id', companyId).in('so_item_id', b).order('id').range(f, t), 'PO lines');
  const pos = await inChunks([...new Set(poItems.map((i) => String(i.purchase_order_id)))], (b, f, t) => sb.from('purchase_orders')
    .select('id, status, po_number').eq('company_id', companyId).in('id', b).order('id').range(f, t), 'purchase orders');
  const poOf = new Map(pos.map((p) => [String(p.id), p]));

  const conditions = alertConditions({
    projects: rows.map((r) => ({ soDocNo: r.soDocNo, expectedCostSen: r.expectedCostSen, costSpentSen: r.costSpentSen, orderedNotBilledSen: r.orderedNotBilledSen, handedOver: r.handedOver })),
    lines: liveItems.map((i) => ({ id: String(i.id), soDocNo: String(i.doc_no), qty: Number(i.qty ?? 0), costSen: Number(i.line_cost_sen ?? 0), description: String(i.description ?? '') })),
    poItems: poItems.map((i) => {
      const p = poOf.get(String(i.purchase_order_id));
      const status = String(p?.status ?? '').toUpperCase();
      return { soItemId: String(i.so_item_id), qty: Number(i.qty ?? 0), totalSen: Number(i.line_total_sen ?? 0), live: !!p && status !== 'DRAFT' && status !== 'CANCELLED', poNumber: String(p?.po_number ?? '') };
    }),
  }, settings);

  /* Open rows and answered ones only: CLEARED rows are history and never decide anything, so the read does not grow with them. */
  const existing = await paginateAll((f: number, t: number) => sb.from('reno_cost_alerts')
    .select('id, so_doc_no, kind, so_item_id, status, committed_sen, budget_sen, gap_sen, resolved_at').eq('company_id', companyId)
    .in('status', ['OPEN', 'CHANGED', 'KEPT']).order('id').range(f, t));
  if (existing.error) fail('alerts', existing.error as { message?: string });
  const all = (existing.data ?? []) as Row[];
  const open = new Map(all.filter((a) => a.status === 'OPEN').map((a) => [keyOf(a), a]));
  /* The latest answer per key: what the committed figure was when finance decided. */
  const answered = new Map<string, Row>();
  for (const a of all) {
    if (a.status !== 'CHANGED' && a.status !== 'KEPT') continue;
    const k = keyOf(a);
    const was = answered.get(k);
    if (!was || String(a.resolved_at ?? '') > String(was.resolved_at ?? '')) answered.set(k, a);
  }

  const result: SweepResult = { raised: 0, updated: 0, cleared: 0, mailed: 0 };
  const now = new Date().toISOString();
  const fresh: Array<AlertCondition & { id: string }> = [];
  const seen = new Set<string>();
  for (const c of conditions) {
    const k = keyOf(c);
    seen.add(k);
    const figures = { budget_sen: c.budgetSen, committed_sen: c.committedSen, gap_sen: c.gapSen };
    const o = open.get(k);
    if (o) {
      if (Number(o.budget_sen) === c.budgetSen && Number(o.committed_sen) === c.committedSen && Number(o.gap_sen) === c.gapSen) continue;
      /* Only while still OPEN: a decision made since the read keeps its figures (the baseline for raising it again). */
      const { error } = await sb.from('reno_cost_alerts').update(figures).eq('company_id', companyId).eq('id', o.id).eq('status', 'OPEN');
      if (error) fail('update', error);
      result.updated += 1;
      continue;
    }
    /* Raised again only when it got worse by another threshold since finance answered it: further over for an
       over-budget alert, further under for a saving. Moving back towards the budget is not news. */
    const was = answered.get(k);
    if (was) {
      const worse = c.kind === 'LINE_UNDER' ? Number(was.committed_sen ?? 0) - c.committedSen : c.committedSen - Number(was.committed_sen ?? 0);
      if (worse <= thresholdSen(c.budgetSen, settings)) continue;
    }
    const { data, error } = await sb.from('reno_cost_alerts').insert({
      company_id: companyId, so_doc_no: c.soDocNo, kind: c.kind, so_item_id: c.soItemId, ...figures, status: 'OPEN', raised_at: now,
    }).select('id').single();
    /* Already open (another run raised it since the read): nothing to add, and the rest of the sweep goes on. */
    if (error && (error as { code?: string }).code === '23505') continue;
    if (error) fail('insert', error);
    fresh.push({ ...c, id: String((data as Row).id) });
    result.raised += 1;
  }
  for (const [k, o] of open) {
    if (seen.has(k)) continue;
    const { error } = await sb.from('reno_cost_alerts').update({ status: 'CLEARED', resolved_at: now }).eq('company_id', companyId).eq('id', o.id).eq('status', 'OPEN');
    if (error) fail('clear', error);
    result.cleared += 1;
  }

  if (fresh.length > 0 && settings.hodNotify && settings.hodEmails.length > 0 && opts.send) {
    const lines = fresh.map((a) => `<li><b>${esc(String(nameOf.get(a.soDocNo) ?? a.soDocNo))}</b> (${esc(a.soDocNo)}): ${esc(alertLabel(a.kind, a.label))}. `
      + `Budget RM ${rm(a.budgetSen)}, committed RM ${rm(a.committedSen)}, gap RM ${rm(a.gapSen)}${a.poNumbers.length ? ` (${esc(a.poNumbers.join(', '))})` : ''}.</li>`);
    const sent = await opts.send({
      to: settings.hodEmails,
      subject: `Renovation cost alert${fresh.length === 1 ? '' : 's'}: ${fresh.length} to review`,
      html: `<p>New cost alert${fresh.length === 1 ? '' : 's'} on renovation projects. Finance will confirm the expected cost on the Renovation Projects page.</p><ul>${lines.join('')}</ul>`,
    });
    if (sent) {
      for (const a of fresh) {
        const { error } = await sb.from('reno_cost_alerts').update({ hod_notified_at: now }).eq('company_id', companyId).eq('id', a.id);
        if (error) fail('notified', error);
      }
      result.mailed = fresh.length;
    }
  }
  return result;
}

/** The cron: every company, one at a time; a company that fails is logged and the rest go on. */
export async function sweepAllCostAlerts(sb: Db, send: SendHodMail): Promise<Array<{ companyId: number } & (SweepResult | { error: string })>> {
  const { data, error } = await sb.schema('public').from('companies').select('id');
  if (error) fail('companies', error);
  const out: Array<{ companyId: number } & (SweepResult | { error: string })> = [];
  for (const { id } of (data ?? []) as Array<{ id: number }>) {
    try {
      out.push({ companyId: Number(id), ...(await sweepCostAlerts(sb, Number(id), { send })) });
    } catch (e) {
      out.push({ companyId: Number(id), error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}
