import { type Env, all, one, run, fail } from './db';
import type { Session } from './auth';
import { MYT_DATE } from './ops';
import { CLEAN_KINDS_SQL } from './cleaning';
import { forwardClaims } from './claimsForward';

/** Outside cleaning jobs billed to their client and the client's payments (chew, 26 Nov 2026: "add cleaning job 选外面
 *  地址填的时候就可以开单了，然后 collection 他们记录，这些都会自动连接我这边记账"). The invoices and payments are kept by
 *  the engine (conts/cleaning-billing.ts), which books them: the invoice Dr 300-C002 CLEANING CUSTOMER / Cr 570-0000
 *  CLEANING SERVICES INCOME at once, a payment Dr the bank / Cr 300-C002 once finance confirms it.
 *
 *  27 Nov 2026 (chew): the office combines any jobs it picks on one invoice (the bill-to is theirs to type) or bills each
 *  job on its own; a combined invoice whose total is typed over is one lump-sum line (a package: the jobs carry RM 0).
 *  The invoice follows its jobs: a job added, re-priced or deleted rewrites it (reviseInvoice) and the engine books the
 *  new total. Each job keeps the invoice it is on and what it is billed at (tasks.cleaning_invoice_id / _no /
 *  cleaning_billed_sen, migrations 0393 / 0395); a lump sum is shared evenly for Profit by job. */

export const KIND_NAME: Record<string, string> = { turnover: 'Basic clean', deep_clean: 'Deep clean', light_clean: 'Light clean' };
export const LUMP_LABEL = 'Cleaning services';

export interface OutsideJob {
  id: string; day: string; kind: string; title: string; state: string; address: string; client: string | null; phone: string | null;
  amount: number | null; invoiceId: string | null; invoiceNo: string | null; billedSen: number | null;
}
export interface Line { taskIds: string[]; day: string; description: string; amountSen: number }
export interface EngineInvoice { id: string; invoiceNo: string; status: string; lump: boolean; totalSen: number; recordedSen: number; lines: { taskIds: string[]; description: string; amountSen: number }[] }

const DAY = MYT_DATE('COALESCE(t.scheduled_for, t.due_at, t.created_at)');
const COLS = `t.id, ${DAY} AS day, t.kind, t.title, t.state, t.external_address AS address, t.external_client AS client, t.external_phone AS phone,
  t.amount, t.cleaning_invoice_id AS "invoiceId", t.cleaning_invoice_no AS "invoiceNo", t.cleaning_billed_sen AS "billedSen"`;
const OUTSIDE = `t.unit_id IS NULL AND t.external_address IS NOT NULL AND t.kind IN ${CLEAN_KINDS_SQL}`;
const shape = (rows: OutsideJob[]) => rows.map(r => ({ ...r, amount: r.amount == null ? null : Number(r.amount), billedSen: r.billedSen == null ? null : Number(r.billedSen) }));

/** Every outside job not billed yet, and the billed ones of the month (YYYY-MM), newest first. */
export async function outsideJobs(env: Env, month: string): Promise<OutsideJob[]> {
  return shape(await all<OutsideJob>(env, `
    SELECT ${COLS} FROM tasks t WHERE ${OUTSIDE} AND (t.cleaning_invoice_id IS NULL OR substr(${DAY}, 1, 7) = ?)
     ORDER BY ${DAY} DESC, t.created_at DESC LIMIT 500`, month));
}

export async function outsideJobsByIds(env: Env, ids: string[]): Promise<OutsideJob[]> {
  if (!ids.length) return [];
  return shape(await all<OutsideJob>(env, `SELECT ${COLS} FROM tasks t WHERE t.id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) AND ${OUTSIDE}`, JSON.stringify(ids)));
}

async function jobsOnInvoice(env: Env, invoiceId: string): Promise<OutsideJob[]> {
  return shape(await all<OutsideJob>(env, `SELECT ${COLS} FROM tasks t WHERE t.cleaning_invoice_id = ? ORDER BY ${DAY}, t.created_at`, invoiceId));
}

const dm = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
const byDay = (jobs: OutsideJob[]) => [...jobs].sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id));

/** One line per job, at its amount. */
export const jobLines = (jobs: OutsideJob[]): Line[] => byDay(jobs).map(j => ({
  taskIds: [j.id], day: j.day, amountSen: Number(j.amount ?? 0), description: `${KIND_NAME[j.kind] ?? 'Cleaning'}, ${j.address} (${dm(j.day)})`.slice(0, 200),
}));

/** One lump-sum line for all the jobs: their days and places, one figure. */
export function lumpLine(jobs: OutsideJob[], totalSen: number, label = LUMP_LABEL): Line {
  const sorted = byDay(jobs);
  const places = [...new Set(sorted.map(j => j.address))];
  const n = sorted.length;
  return {
    taskIds: sorted.map(j => j.id), day: sorted[0].day, amountSen: totalSen,
    description: `${label}, ${n} ${n === 1 ? 'job' : 'jobs'}: ${sorted.map(j => dm(j.day)).join(', ')}; ${places.join('; ')}`.slice(0, 1000),
  };
}
/** The label a lump-sum line was made with ("Cleaning services, 4 jobs: …" -> "Cleaning services"). */
export const lumpLabelOf = (description: string): string => /^(.*), \d+ jobs?: /.exec(description)?.[1]?.trim() || LUMP_LABEL;

/** What each job is billed at: its own line, or an even share of the lump sum with the odd sen on the first. */
export function shares(lines: Line[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of lines) {
    const n = l.taskIds.length, each = Math.floor(l.amountSen / n);
    l.taskIds.forEach((id, i) => out.set(id, each + (i === 0 ? l.amountSen - each * n : 0)));
  }
  return out;
}

/** The client a job is billed to. */
export const clientKey = (j: Pick<OutsideJob, 'client'>): string => String(j.client ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** Why these jobs cannot be billed, or null. `each`: every job on an invoice of its own, so each needs its client and an amount. */
export function billRefusal(picked: string[], jobs: OutsideJob[], each: boolean): string | null {
  if (!picked.length) return 'Pick the cleaning jobs to bill.';
  if (picked.length > 200) return 'At most 200 jobs at a time.';
  if (jobs.length !== picked.length) return 'A job picked is not an outside cleaning job any more. Refresh and try again.';
  const billed = jobs.find(j => j.invoiceId);
  if (billed) return `The job on ${billed.day} at ${billed.address} is already billed on ${billed.invoiceNo}.`;
  if (each) {
    const noClient = jobs.find(j => !clientKey(j));
    if (noClient) return `The job on ${noClient.day} at ${noClient.address} has no client name. Add it to the job, or bill the jobs together.`;
    const noAmount = jobs.find(j => !j.amount || j.amount <= 0);
    if (noAmount) return `The job on ${noAmount.day} at ${noAmount.address} is RM 0.00: bill it together with others and type the total.`;
  }
  return null;
}

/** The same jobs always make the same key: a retry finds the invoice already made. */
export async function billKey(taskIds: string[]): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode([...taskIds].sort().join(','))));
  return `cln-${[...bytes.slice(0, 12)].map(b => b.toString(16).padStart(2, '0')).join('')}`;
}

export const invoiceIdsOf = (jobs: OutsideJob[]): string[] => [...new Set(jobs.map(j => j.invoiceId).filter((x): x is string => !!x))];

/** Whether a job is billed on that invoice (a print or a payment asks for an invoice its jobs know). */
export async function knownInvoice(env: Env, invoiceId: string): Promise<{ invoiceNo: string } | null> {
  const r = await one<{ no: string }>(env, 'SELECT cleaning_invoice_no AS no FROM tasks WHERE cleaning_invoice_id = ? LIMIT 1', invoiceId);
  return r ? { invoiceNo: r.no } : null;
}

/** Each job on the invoice keeps it and what it is billed at; jobs taken off it are cleared. */
export async function linkJobs(env: Env, invoice: { id: string; invoiceNo: string }, lines: Line[], removed: string[] = []): Promise<void> {
  const billed = shares(lines);
  if (billed.size) {
    await run(env, `UPDATE tasks t SET cleaning_invoice_id = ?, cleaning_invoice_no = ?, cleaning_billed_sen = (x.value)::int, updated_at = now()
                     FROM jsonb_each_text(?::text::jsonb) x WHERE t.id = x.key`, invoice.id, invoice.invoiceNo, JSON.stringify(Object.fromEntries(billed)));
  }
  if (removed.length) {
    await run(env, `UPDATE tasks SET cleaning_invoice_id = NULL, cleaning_invoice_no = NULL, cleaning_billed_sen = NULL, updated_at = now()
                     WHERE id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) AND cleaning_invoice_id = ?`, JSON.stringify(removed), invoice.id);
  }
}

export async function engineInvoice(env: Env, session: Session, id: string): Promise<EngineInvoice | Response> {
  const res = await forwardClaims(env, session, 'GET', `/cleaning-invoices?ids=${encodeURIComponent(id)}`);
  if (!res.ok) return res;
  const inv = ((await res.json<{ invoices?: EngineInvoice[] }>().catch(() => null))?.invoices ?? [])[0];
  return inv ?? fail('NOT_FOUND', 'The finance system has no such invoice.', 404);
}

export type Change = { add?: OutsideJob; remove?: string[]; amount?: { id: string; sen: number }; totalSen?: number };

/** The invoice as its jobs now are: a job added, taken off or re-priced, or a lump sum's total changed. The engine books
 *  the new total; no job left cancels it. Answers null when done, else the refusal to show. */
export async function reviseInvoice(env: Env, session: Session, invoiceId: string, change: Change): Promise<Response | null> {
  const inv = await engineInvoice(env, session, invoiceId);
  if (inv instanceof Response) return inv;
  const removed = new Set(change.remove ?? []);
  let jobs = (await jobsOnInvoice(env, invoiceId)).filter(j => !removed.has(j.id));
  if (change.add) jobs = [...jobs.filter(j => j.id !== change.add!.id), change.add];
  if (change.amount) jobs = jobs.map(j => (j.id === change.amount!.id ? { ...j, amount: change.amount!.sen } : j));
  let lines: Line[] = [];
  if (jobs.length) {
    if (inv.lump) {
      const total = change.totalSen ?? inv.totalSen;
      lines = [lumpLine(jobs, total, lumpLabelOf(inv.lines[0]?.description ?? ''))];
    } else {
      if (change.totalSen != null) return refusal(`${inv.invoiceNo} lists each job at its own amount: change the job's amount instead.`);
      const free = jobs.find(j => !j.amount || j.amount <= 0);
      if (free) return refusal(`The job on ${free.day} at ${free.address} would be RM 0.00 on ${inv.invoiceNo}, which lists each job at its own amount.`);
      lines = jobLines(jobs);
    }
  }
  const res = await forwardClaims(env, session, 'POST', `/cleaning-invoices/${encodeURIComponent(invoiceId)}/revise`, { lump: inv.lump, lines });
  if (!res.ok) return res;
  await linkJobs(env, { id: inv.id, invoiceNo: inv.invoiceNo }, lines, [...removed]);
  return null;
}

/** Takes billed jobs off their invoices before they are deleted. Answers, per job, why it stays when its invoice refused. */
export async function detachJobs(env: Env, session: Session, jobs: { id: string; invoiceId: string }[]): Promise<Map<string, string>> {
  const kept = new Map<string, string>();
  const byInvoice = new Map<string, string[]>();
  for (const j of jobs) byInvoice.set(j.invoiceId, [...(byInvoice.get(j.invoiceId) ?? []), j.id]);
  for (const [invoiceId, ids] of byInvoice) {
    const refused = await reviseInvoice(env, session, invoiceId, { remove: ids });
    if (refused) {
      const why = await refused.json<{ error?: { message?: string } }>().catch(() => null);
      ids.forEach(id => kept.set(id, why?.error?.message ?? 'its invoice could not be changed'));
    }
  }
  return kept;
}

const refusal = (message: string): Response => fail('CONFLICT', message, 409);
