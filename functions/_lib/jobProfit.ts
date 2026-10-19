import { type Env, all } from './db';
import { hasColumn } from './auth';
import { hasBilling } from './maintenance';
import { priceBook, layoutKey } from './cleaningPrices';

/** Billing, actual cost and profit of a job (owner, 17 Oct 2026). Billing is what the payer is charged: for an owner-paid
 *  job, the amount on the owner statement. The actual cost is the supplier's, contractor's or cleaner's invoices against
 *  the job (expenses linked by invoice_maintenance_id / invoice_task_id, paid by The Conts, never on a statement), or,
 *  until one is submitted, an estimate: the items' internal cost (maintenance) or the cleaner's pay (cleaning). The
 *  actual cost is The Conts' figure; nothing here is shown to an owner. */
/** Who sees a job's actual cost and profit: the roles that see repair amounts today. */
export const PROFIT_ROLES = ['management', 'operations_manager', 'finance_admin'];

export const hasJobInvoices = (env: Env) => hasColumn(env, 'expenses', 'invoice_task_id').catch(() => false);

export type CostSource = 'invoice' | 'estimate' | 'cleaner_pay' | null;
export interface Invoice { id: string; supplier: string | null; invoiceNo: string | null; date: string; amount: number; documentId: string | null; enteredBy: string | null }
export interface JobLine { id: string; itemId: string | null; code: string | null; name: string; qty: number; ownerPrice: number; internalCost: number | null }
export interface JobMoney {
  billed: number; billedSource: 'statement' | 'charged' | 'quote' | 'price' | 'none';
  actual: number | null; actualSource: CostSource; estimate: number | null;
  invoices: Invoice[]; profit: number | null; lines?: JobLine[];
}

const sum = (xs: number[]) => xs.reduce((n, x) => n + x, 0);

async function invoicesFor(env: Env, col: 'invoice_maintenance_id' | 'invoice_task_id', ids: string[]): Promise<Map<string, Invoice[]>> {
  const out = new Map<string, Invoice[]>();
  if (!ids.length) return out;
  const rows = await all<any>(env, `SELECT e.id, e.${col} AS job_id, e.supplier_name, e.reference, e.incurred_on, e.amount, e.receipt_document_id, u.full_name
    FROM expenses e LEFT JOIN users u ON u.id = e.created_by
    WHERE e.${col} IN (SELECT jsonb_array_elements_text(?::text::jsonb)) ORDER BY e.incurred_on, e.created_at`, JSON.stringify(ids));
  for (const r of rows) out.set(r.job_id, [...(out.get(r.job_id) ?? []), {
    id: r.id, supplier: r.supplier_name ?? null, invoiceNo: r.reference ?? null, date: String(r.incurred_on).slice(0, 10), amount: Number(r.amount),
    documentId: r.receipt_document_id ?? null, enteredBy: r.full_name ?? null,
  }]);
  return out;
}

/** Maintenance jobs: items, billing (the expense charged once finished, else the quote), actual cost and profit. */
export async function maintenanceMoney(env: Env, ids: string[]): Promise<Map<string, JobMoney>> {
  const out = new Map<string, JobMoney>();
  if (!ids.length) return out;
  const ready = await hasJobInvoices(env);
  const billing = await hasBilling(env);
  const json = JSON.stringify(ids);
  const [jobs, lines, charged, invoices] = await Promise.all([
    all<any>(env, `SELECT id, state, charge_to, quoted_amount, final_amount${billing ? ', contractor_amount' : ', NULL::int AS contractor_amount'}
      FROM maintenance_issues WHERE id IN (SELECT jsonb_array_elements_text(?::text::jsonb))`, json),
    ready ? all<any>(env, `SELECT l.*, s.code FROM maintenance_job_items l LEFT JOIN service_items s ON s.id = l.item_id
      WHERE l.issue_id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) ORDER BY l.sort_order, l.created_at`, json) : Promise.resolve([] as any[]),
    all<any>(env, `SELECT maintenance_id, SUM(amount) AS amount, bool_or(charge_to = 'owner') AS owner FROM expenses
      WHERE maintenance_id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) AND charge_to <> 'the_conts' GROUP BY maintenance_id`, json),
    ready ? invoicesFor(env, 'invoice_maintenance_id', ids) : Promise.resolve(new Map<string, Invoice[]>()),
  ]);
  const chargedAt = new Map(charged.map(c => [c.maintenance_id, c]));
  for (const j of jobs) {
    const own = lines.filter(l => l.issue_id === j.id).map(l => ({
      id: l.id, itemId: l.item_id ?? null, code: l.code ?? null, name: l.name, qty: Number(l.qty), ownerPrice: Number(l.owner_price),
      internalCost: l.internal_cost == null ? null : Number(l.internal_cost),
    }));
    const c = chargedAt.get(j.id);
    const lineTotal = own.length ? Math.round(sum(own.map(l => l.ownerPrice * l.qty))) : null;
    const billed = j.charge_to === 'the_conts' ? 0 : c ? Number(c.amount) : j.state === 'resolved' ? Number(j.final_amount ?? 0) : Number(j.quoted_amount ?? lineTotal ?? 0);
    const billedSource = j.charge_to === 'the_conts' ? 'none' : c ? (c.owner ? 'statement' : 'charged') : 'quote';
    const costs = own.filter(l => l.internalCost != null);
    const estimate = costs.length ? Math.round(sum(costs.map(l => l.internalCost! * l.qty))) : j.contractor_amount != null ? Number(j.contractor_amount) : null;
    const inv = invoices.get(j.id) ?? [];
    const actual = inv.length ? sum(inv.map(i => i.amount)) : estimate;
    out.set(j.id, { billed, billedSource, actual, actualSource: inv.length ? 'invoice' : estimate != null ? 'estimate' : null, estimate, invoices: inv,
      profit: actual == null ? null : billed - actual, lines: own });
  }
  return out;
}

/** Cleaning jobs: billing (the owner charge on the statement once charged, else the job's amount or the list price),
 *  actual cost (invoices, else the cleaner's pay) and profit. */
export async function cleaningMoney(env: Env, ids: string[]): Promise<Map<string, JobMoney>> {
  const out = new Map<string, JobMoney>();
  if (!ids.length) return out;
  const ready = await hasJobInvoices(env);
  const layout = (await hasColumn(env, 'units', 'layout_type').catch(() => false)) ? 'u.layout_type' : 'NULL::text';
  const json = JSON.stringify(ids);
  const [jobs, charged, invoices] = await Promise.all([
    all<any>(env, `SELECT t.id, t.kind, t.unit_id, t.amount, t.cleaner_pay, u.bedrooms, ${layout} AS layout_type, COALESCE(t.scheduled_for, t.due_at, t.created_at) AS day_at
      FROM tasks t LEFT JOIN units u ON u.id = t.unit_id WHERE t.id IN (SELECT jsonb_array_elements_text(?::text::jsonb))`, json),
    all<any>(env, `SELECT task_id, SUM(amount) AS amount FROM expenses WHERE task_id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) AND charge_to = 'owner' GROUP BY task_id`, json),
    ready ? invoicesFor(env, 'invoice_task_id', ids) : Promise.resolve(new Map<string, Invoice[]>()),
  ]);
  const price = await priceBook(env, jobs.map(j => j.unit_id).filter(Boolean));
  const chargedAt = new Map(charged.map(c => [c.task_id, Number(c.amount)]));
  for (const j of jobs) {
    const p = j.unit_id ? price(j.unit_id, j.kind, layoutKey(j.layout_type, j.bedrooms), j.day_at) : { external: null, internal: null };
    const c = chargedAt.get(j.id);
    const billedRaw = c ?? (j.amount != null ? Number(j.amount) : p.external);
    const billed = billedRaw ?? 0;
    const billedSource = c != null ? 'statement' : j.amount != null ? (j.unit_id ? 'quote' : 'charged') : p.external != null ? 'price' : 'none';
    const pay = j.cleaner_pay != null ? Number(j.cleaner_pay) : p.internal;
    const inv = invoices.get(j.id) ?? [];
    const actual = inv.length ? sum(inv.map(i => i.amount)) : pay;
    out.set(j.id, { billed, billedSource, actual, actualSource: inv.length ? 'invoice' : j.cleaner_pay != null ? 'cleaner_pay' : pay != null ? 'estimate' : null,
      estimate: pay, invoices: inv, profit: actual == null ? null : billed - actual });
  }
  return out;
}
