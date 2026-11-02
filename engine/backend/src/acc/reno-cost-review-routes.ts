// Conts only (not part of Houzs's code): the renovation expected-cost review (finance, chew 2 Nov 2026; SOP 4.2.1;
// plan docs/superpowers/plans/2026-11-02-renovation-expected-cost-review.md Task 3). Mounted under /accounting, behind
// the Ledger guard.
//   GET  /accounting/reno-cost-alerts?status=OPEN|ALL          the alerts, with what they are about in words
//   GET  /accounting/reno-cost-alerts/pending-count            the sidebar's red count: OPEN alerts of the company
//   POST /accounting/reno-projects/:soDocNo/expected-cost      { newExpectedSen, reason }  — needs scm.reno_estimate.change
//   POST /accounting/reno-cost-alerts/:id/keep                 { note }                    — needs scm.reno_estimate.change
//   GET  /accounting/reno-expected-cost-log?from&to&soDocNo    every decision: changes and kept alerts, newest first
//   GET|PUT /accounting/reno-alert-settings                    the threshold and the HOD email (PUT needs the post key)
import { hasHouzsPerm } from '../scm/lib/houzs-perms';
import { requireActiveCompanyId } from '../scm/lib/companyScope';
import { todayMyt } from '../scm/lib/my-time';
import { recipientList } from '../services/email';
import { alertLabel, loadAlertSettings, type AlertKind } from './reno-cost-alerts';
import { contractCompletions, inChunks } from './reno-completion';

/* eslint-disable @typescript-eslint/no-explicit-any -- Hono context and PostgREST client, untyped as in the routes they sit beside */
type Ctx = any;
type Db = any;
type Row = Record<string, any>;
export const CHANGE_KEY = 'scm.reno_estimate.change';
const who = (c: Ctx): { id: number | null; name: string } => {
  const u = c.get('houzsUser') ?? {};
  const id = Number(u.id);
  return { id: Number.isFinite(id) && u.id != null ? id : null, name: String(u.name ?? u.email ?? 'unknown') };
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function readBody(c: Ctx): Promise<Record<string, unknown> | null> {
  try { return await c.req.json(); } catch { return null; }
}

/** Project names and, for line alerts, the line's words and its PO numbers. */
async function describe(sb: Db, companyId: number, alerts: Row[]): Promise<Row[]> {
  if (alerts.length === 0) return [];
  const docs = [...new Set(alerts.map((a) => String(a.so_doc_no)))];
  const itemIds = [...new Set(alerts.map((a) => a.so_item_id).filter(Boolean).map(String))];
  const [contracts, orders, items, poItems] = await Promise.all([
    inChunks(docs, (b, f, t) => sb.from('reno_so_contracts').select('so_doc_no, project_id, customer_name').eq('company_id', companyId).in('so_doc_no', b).order('so_doc_no').range(f, t), 'contracts'),
    inChunks(docs, (b, f, t) => sb.from('mfg_sales_orders').select('doc_no, project_id').eq('company_id', companyId).in('doc_no', b).order('doc_no').range(f, t), 'orders'),
    inChunks(itemIds, (b, f, t) => sb.from('mfg_sales_order_items').select('id, description').eq('company_id', companyId).in('id', b).order('id').range(f, t), 'contract lines'),
    inChunks(itemIds, (b, f, t) => sb.from('purchase_order_items').select('id, purchase_order_id, so_item_id').eq('company_id', companyId).in('so_item_id', b).order('id').range(f, t), 'PO lines'),
  ]);
  const pos = await inChunks([...new Set(poItems.map((i) => String(i.purchase_order_id)))], (b, f, t) => sb.from('purchase_orders')
    .select('id, po_number, status').eq('company_id', companyId).in('id', b).order('id').range(f, t), 'purchase orders');
  const orderOf = new Map(orders.map((o) => [String(o.doc_no), o]));
  const contractOf = new Map(contracts.map((k) => [String(k.so_doc_no), k]));
  const projectIdOf = (doc: string): number | null => {
    const p = contractOf.get(doc)?.project_id ?? orderOf.get(doc)?.project_id;
    return p == null ? null : Number(p);
  };
  const projectIds = [...new Set(docs.map(projectIdOf).filter((p): p is number => p != null))];
  const projects = await inChunks(projectIds, (b, f, t) => sb.schema('public').from('projects').select('id, code, name').eq('company_id', companyId).in('id', b).order('id').range(f, t), 'projects');
  const projectName = new Map(projects.map((p) => [Number(p.id), String(p.name ?? p.code ?? '')]));
  const lineOf = new Map(items.map((i) => [String(i.id), String(i.description ?? '')]));
  const poOf = new Map(pos.map((p) => [String(p.id), p]));
  const posFor = new Map<string, string[]>();
  for (const i of poItems) {
    const p = poOf.get(String(i.purchase_order_id));
    if (!p || String(p.status).toUpperCase() === 'CANCELLED' || String(p.status).toUpperCase() === 'DRAFT') continue;
    const at = posFor.get(String(i.so_item_id)) ?? [];
    if (!at.includes(String(p.po_number))) at.push(String(p.po_number));
    posFor.set(String(i.so_item_id), at.sort());
  }
  return alerts.map((a) => {
    const doc = String(a.so_doc_no);
    const pid = projectIdOf(doc);
    const line = a.so_item_id ? lineOf.get(String(a.so_item_id)) ?? '' : '';
    return {
      ...a,
      project_name: (pid != null ? projectName.get(pid) : undefined) || String(contractOf.get(doc)?.customer_name ?? doc),
      line_description: line,
      what: alertLabel(a.kind as AlertKind, line),
      po_numbers: a.so_item_id ? posFor.get(String(a.so_item_id)) ?? [] : [],
    };
  });
}

export const listCostAlertsHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const all = String(c.req.query('status') ?? 'OPEN').toUpperCase() === 'ALL';
  let q = sb.from('reno_cost_alerts').select('*').eq('company_id', co.companyId);
  if (!all) q = q.eq('status', 'OPEN');
  const { data, error } = await q.order('raised_at', { ascending: false }).limit(1000);
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  try {
    return c.json({ alerts: await describe(sb, co.companyId, (data ?? []) as Row[]) });
  } catch (e) {
    return c.json({ error: 'load_failed', reason: e instanceof Error ? e.message : String(e) }, 500);
  }
};

export const pendingCostAlertsHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const { count, error } = await c.get('supabase').from('reno_cost_alerts').select('id', { count: 'exact', head: true })
    .eq('company_id', co.companyId).eq('status', 'OPEN');
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ count: count ?? 0 });
};

export const changeExpectedCostHandler = async (c: Ctx): Promise<Response> => {
  if (!hasHouzsPerm(c, CHANGE_KEY)) return c.json({ error: 'forbidden', message: "You don't have permission to change a project's expected cost." }, 403);
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const body = await readBody(c);
  if (!body) return c.json({ error: 'invalid_json' }, 400);
  const newSen = body.newExpectedSen;
  const reason = String(body.reason ?? '').trim();
  if (typeof newSen !== 'number' || !Number.isInteger(newSen) || newSen <= 0) {
    return c.json({ error: 'bad_amount', message: 'Enter the new expected cost as an amount above zero.' }, 400);
  }
  if (!reason) return c.json({ error: 'reason_required', message: 'Say why the expected cost changes.' }, 400);
  /* The expected cost the user saw: a change is made against it, so two saves at once never add up twice. */
  const sawSen = body.expectedOldSen;
  if (typeof sawSen !== 'number' || !Number.isInteger(sawSen)) return c.json({ error: 'bad_amount', message: 'Reload the page and try again.' }, 400);
  const soDocNo = String(c.req.param('soDocNo') ?? '');
  const sb = c.get('supabase');
  const today = todayMyt();
  let comp;
  try {
    [comp] = await contractCompletions(sb, co.companyId, today, [soDocNo]);
  } catch (e) {
    return c.json({ error: 'load_failed', reason: e instanceof Error ? e.message : String(e) }, 500);
  }
  if (!comp) return c.json({ error: 'not_found', message: 'No live renovation contract with that number.' }, 404);
  if (comp.handedOver || comp.status === 'CANCELLED') {
    return c.json({ error: 'closed', message: 'This project is handed over or cancelled; its expected cost can no longer change.' }, 409);
  }
  const stale = () => c.json({ error: 'stale', message: 'The expected cost has changed since you opened this. Reload the page and look again.' }, 409);
  if (comp.expectedCostSen !== sawSen) return stale();
  const by = who(c);
  /* Kept as an adjustment on top of the lines, so a later VO still moves it: new − (lines + the changes so far). */
  const adjustment = newSen - comp.expectedCostSen;
  const { data: change, error } = await sb.from('reno_expected_cost_changes').insert({
    company_id: co.companyId, so_doc_no: soDocNo, effective_on: today,
    old_expected_sen: comp.expectedCostSen, new_expected_sen: newSen, adjustment_sen: adjustment,
    reason, changed_by: by.id, changed_by_name: by.name,
  }).select('*').single();
  /* reno_expected_cost_changes_once: the same save already went through. */
  if (error && (error as { code?: string }).code === '23505') return stale();
  if (error) return c.json({ error: 'insert_failed', reason: error.message }, 500);
  const { error: aErr } = await sb.from('reno_cost_alerts').update({
    status: 'CHANGED', resolved_at: new Date().toISOString(), resolved_by: by.id, resolved_by_name: by.name, change_id: (change as Row).id,
  }).eq('company_id', co.companyId).eq('so_doc_no', soDocNo).eq('status', 'OPEN');
  if (aErr) return c.json({ error: 'update_failed', reason: aErr.message }, 500);
  return c.json({ change }, 201);
};

export const keepCostAlertHandler = async (c: Ctx): Promise<Response> => {
  if (!hasHouzsPerm(c, CHANGE_KEY)) return c.json({ error: 'forbidden', message: "You don't have permission to decide on a cost alert." }, 403);
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const body = await readBody(c);
  if (!body) return c.json({ error: 'invalid_json' }, 400);
  const note = String(body.note ?? '').trim();
  if (!note) return c.json({ error: 'reason_required', message: 'Say why the expected cost stays.' }, 400);
  const sb = c.get('supabase');
  const id = String(c.req.param('id') ?? '');
  const { data: alert, error } = await sb.from('reno_cost_alerts').select('id, status').eq('company_id', co.companyId).eq('id', id).maybeSingle();
  /* 22P02: not a uuid at all, so no such alert. */
  if (error && (error as { code?: string }).code === '22P02') return c.json({ error: 'not_found' }, 404);
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  if (!alert) return c.json({ error: 'not_found' }, 404);
  if ((alert as Row).status !== 'OPEN') return c.json({ error: 'not_open', message: 'This alert has been dealt with already.' }, 409);
  const by = who(c);
  const { data: kept, error: uErr } = await sb.from('reno_cost_alerts').update({
    status: 'KEPT', note, resolved_at: new Date().toISOString(), resolved_by: by.id, resolved_by_name: by.name,
  }).eq('company_id', co.companyId).eq('id', id).eq('status', 'OPEN').select('id').maybeSingle();
  if (uErr) return c.json({ error: 'update_failed', reason: uErr.message }, 500);
  /* Cleared or answered by someone else since the check: nothing was kept. */
  if (!kept) return c.json({ error: 'not_open', message: 'This alert has been dealt with already.' }, 409);
  return c.json({ ok: true });
};

/** One row per decision: each change (with the alerts it answered as its cause) and each kept alert. */
export const expectedCostLogHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const from = String(c.req.query('from') ?? '').trim();
  const to = String(c.req.query('to') ?? '').trim();
  const doc = String(c.req.query('soDocNo') ?? '').trim();
  if ((from && !DATE.test(from)) || (to && !DATE.test(to))) return c.json({ error: 'bad_date', message: 'Enter a date like 2026-11-30.' }, 400);
  const sb = c.get('supabase');
  let cq = sb.from('reno_expected_cost_changes').select('*').eq('company_id', co.companyId);
  let aq = sb.from('reno_cost_alerts').select('*').eq('company_id', co.companyId).in('status', ['CHANGED', 'KEPT']);
  if (doc) { cq = cq.eq('so_doc_no', doc); aq = aq.eq('so_doc_no', doc); }
  const [{ data: changes, error: cErr }, { data: answered, error: aErr }] = await Promise.all([cq.limit(5000), aq.limit(5000)]);
  if (cErr || aErr) return c.json({ error: 'load_failed', reason: (cErr ?? aErr)!.message }, 500);
  try {
    const alerts = await describe(sb, co.companyId, (answered ?? []) as Row[]);
    const causeOf = (a: Row): string => `${a.what}${a.po_numbers.length ? ` (${a.po_numbers.join(', ')})` : ''}`;
    const byChange = new Map<string, Row[]>();
    for (const a of alerts) if (a.status === 'CHANGED' && a.change_id) byChange.set(String(a.change_id), [...(byChange.get(String(a.change_id)) ?? []), a]);
    const names = new Map<string, string>(alerts.map((a) => [String(a.so_doc_no), String(a.project_name)]));
    const missing = ((changes ?? []) as Row[]).map((x) => String(x.so_doc_no)).filter((d) => !names.has(d));
    if (missing.length) for (const r of await describe(sb, co.companyId, [...new Set(missing)].map((d) => ({ so_doc_no: d, kind: 'PROJECT_OVER' })))) names.set(String(r.so_doc_no), String(r.project_name));
    const day = (v: unknown): string => String(v ?? '').slice(0, 10);
    const mytDay = (ts: unknown): string => { const t = Date.parse(String(ts ?? '')); return Number.isFinite(t) ? new Date(t + 8 * 3_600_000).toISOString().slice(0, 10) : ''; };
    const rows = [
      ...((changes ?? []) as Row[]).map((x) => ({
        id: String(x.id), date: day(x.effective_on), at: String(x.created_at ?? ''), soDocNo: String(x.so_doc_no), projectName: names.get(String(x.so_doc_no)) ?? String(x.so_doc_no),
        outcome: 'Changed' as const, oldSen: Number(x.old_expected_sen), newSen: Number(x.new_expected_sen), differenceSen: Number(x.new_expected_sen) - Number(x.old_expected_sen),
        cause: (byChange.get(String(x.id)) ?? []).map(causeOf).join('; ') || 'Manual', reason: String(x.reason ?? ''), by: String(x.changed_by_name ?? ''),
      })),
      ...alerts.filter((a) => a.status === 'KEPT').map((a) => ({
        id: String(a.id), date: mytDay(a.resolved_at), at: String(a.resolved_at ?? ''), soDocNo: String(a.so_doc_no), projectName: String(a.project_name),
        outcome: 'Kept' as const, oldSen: null, newSen: null, differenceSen: null,
        cause: causeOf(a), reason: String(a.note ?? ''), by: String(a.resolved_by_name ?? ''),
      })),
    ].filter((r) => (!from || r.date >= from) && (!to || r.date <= to))
      .sort((p, q) => q.at.localeCompare(p.at));
    return c.json({ rows });
  } catch (e) {
    return c.json({ error: 'load_failed', reason: e instanceof Error ? e.message : String(e) }, 500);
  }
};

export const getAlertSettingsHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  try {
    const s = await loadAlertSettings(c.get('supabase'), co.companyId);
    return c.json({ minSen: s.minSen, pctBp: s.pctBp, hodNotify: s.hodNotify, hodEmails: s.hodEmails.join(', ') });
  } catch (e) {
    return c.json({ error: 'load_failed', reason: e instanceof Error ? e.message : String(e) }, 500);
  }
};

export const putAlertSettingsHandler = async (c: Ctx): Promise<Response> => {
  if (!hasHouzsPerm(c, 'scm.payment_voucher.post')) return c.json({ error: 'forbidden', message: "You don't have permission to change the alert settings." }, 403);
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const body = await readBody(c);
  if (!body) return c.json({ error: 'invalid_json' }, 400);
  const minSen = body.minSen;
  const pctBp = body.pctBp;
  if (typeof minSen !== 'number' || !Number.isInteger(minSen) || minSen < 0) return c.json({ error: 'bad_amount', message: 'Enter the amount as zero or more.' }, 400);
  if (typeof pctBp !== 'number' || !Number.isInteger(pctBp) || pctBp < 0 || pctBp > 10_000) return c.json({ error: 'bad_pct', message: 'Enter a percentage from 0 to 100.' }, 400);
  const emails = recipientList(String(body.hodEmails ?? ''));
  const hodNotify = body.hodNotify === true;
  if (hodNotify && emails.length === 0) return c.json({ error: 'emails_required', message: 'Enter at least one HOD email address to switch the email on.' }, 400);
  const sb = c.get('supabase');
  const patch = { reno_alert_min_sen: minSen, reno_alert_pct_bp: pctBp, reno_alert_hod_notify: hodNotify, reno_alert_hod_emails: emails.join(', ') };
  const { data: had, error: rErr } = await sb.from('acc_company_settings').select('company_id').eq('company_id', co.companyId).maybeSingle();
  if (rErr) return c.json({ error: 'load_failed', reason: rErr.message }, 500);
  const { error } = had
    ? await sb.from('acc_company_settings').update(patch).eq('company_id', co.companyId)
    : await sb.from('acc_company_settings').insert({ company_id: co.companyId, ...patch });
  if (error) return c.json({ error: 'save_failed', reason: error.message }, 500);
  return c.json({ minSen, pctBp, hodNotify, hodEmails: patch.reno_alert_hod_emails });
};
