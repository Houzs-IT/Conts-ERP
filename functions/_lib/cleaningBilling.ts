import { type Env, all, one } from './db';
import { MYT_DATE } from './ops';
import { CLEAN_KINDS_SQL } from './cleaning';

/** Outside cleaning jobs billed to their client and the client's payments (chew, 26 Nov 2026: "add cleaning job 选外面
 *  地址填的时候就可以开单了，然后 collection 他们记录，这些都会自动连接我这边记账"). The invoices and payments are kept by
 *  the engine (conts/cleaning-billing.ts), which books them: the invoice Dr 300-C002 CLEANING CUSTOMER / Cr 570-0000
 *  CLEANING SERVICES INCOME at once, a payment Dr the bank / Cr 300-C002 once finance confirms it. Property OS keeps on
 *  each job the invoice it is billed on (tasks.cleaning_invoice_id / _no, migration 0393): a job is billed once. */

export const KIND_NAME: Record<string, string> = { turnover: 'Basic clean', deep_clean: 'Deep clean', light_clean: 'Light clean' };

export interface OutsideJob {
  id: string; day: string; kind: string; title: string; state: string; address: string; client: string | null; phone: string | null;
  amount: number | null; invoiceId: string | null; invoiceNo: string | null;
}

const DAY = MYT_DATE('COALESCE(t.scheduled_for, t.due_at, t.created_at)');
const COLS = `t.id, ${DAY} AS day, t.kind, t.title, t.state, t.external_address AS address, t.external_client AS client, t.external_phone AS phone,
  t.amount, t.cleaning_invoice_id AS "invoiceId", t.cleaning_invoice_no AS "invoiceNo"`;

/** Every outside job not billed yet, and the billed ones of the month (YYYY-MM), newest first. */
export async function outsideJobs(env: Env, month: string): Promise<OutsideJob[]> {
  const rows = await all<OutsideJob>(env, `
    SELECT ${COLS} FROM tasks t
     WHERE t.unit_id IS NULL AND t.external_address IS NOT NULL AND t.kind IN ${CLEAN_KINDS_SQL}
       AND (t.cleaning_invoice_id IS NULL OR substr(${DAY}, 1, 7) = ?)
     ORDER BY ${DAY} DESC, t.created_at DESC LIMIT 500`, month);
  return rows.map(r => ({ ...r, amount: r.amount == null ? null : Number(r.amount) }));
}

export async function outsideJobsByIds(env: Env, ids: string[]): Promise<OutsideJob[]> {
  if (!ids.length) return [];
  const rows = await all<OutsideJob>(env, `
    SELECT ${COLS} FROM tasks t
     WHERE t.id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) AND t.unit_id IS NULL AND t.external_address IS NOT NULL AND t.kind IN ${CLEAN_KINDS_SQL}`,
    JSON.stringify(ids));
  return rows.map(r => ({ ...r, amount: r.amount == null ? null : Number(r.amount) }));
}

/** The client a job is billed to: its name, else nobody (the job must name one first). */
export const clientKey = (j: Pick<OutsideJob, 'client'>): string => String(j.client ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** Why these jobs cannot go on one invoice, or null. */
export function billRefusal(picked: string[], jobs: OutsideJob[]): string | null {
  if (!picked.length) return 'Pick the cleaning jobs to bill.';
  if (picked.length > 200) return 'At most 200 jobs on one invoice.';
  if (jobs.length !== picked.length) return 'A job picked is not an outside cleaning job any more. Refresh and try again.';
  const billed = jobs.find(j => j.invoiceId);
  if (billed) return `The job on ${billed.day} at ${billed.address} is already billed on ${billed.invoiceNo}.`;
  const noClient = jobs.find(j => !clientKey(j));
  if (noClient) return `The job on ${noClient.day} at ${noClient.address} has no client name. Add it to the job first.`;
  const noAmount = jobs.find(j => !j.amount || j.amount <= 0);
  if (noAmount) return `The job on ${noAmount.day} at ${noAmount.address} has no amount.`;
  if (new Set(jobs.map(clientKey)).size > 1) return 'One invoice is for one client. Pick jobs of the same client.';
  return null;
}

/** The invoice line of a job: what was done, where and when. */
export const lineOf = (j: OutsideJob): { taskId: string; day: string; description: string; amountSen: number } => ({
  taskId: j.id, day: j.day, amountSen: Number(j.amount),
  description: `${KIND_NAME[j.kind] ?? 'Cleaning'}, ${j.address} (${j.day})`.slice(0, 200),
});

/** The same jobs always make the same key: a retry finds the invoice already made. */
export async function billKey(taskIds: string[]): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode([...taskIds].sort().join(','))));
  return `cln-${[...bytes.slice(0, 12)].map(b => b.toString(16).padStart(2, '0')).join('')}`;
}

/** The invoice ids the jobs are billed on. */
export const invoiceIdsOf = (jobs: OutsideJob[]): string[] => [...new Set(jobs.map(j => j.invoiceId).filter((x): x is string => !!x))];

/** Whether this job is billed on that invoice (a print or a payment asks for an invoice its job knows). */
export async function knownInvoice(env: Env, invoiceId: string): Promise<{ invoiceNo: string } | null> {
  const r = await one<{ no: string }>(env, 'SELECT cleaning_invoice_no AS no FROM tasks WHERE cleaning_invoice_id = ? LIMIT 1', invoiceId);
  return r ? { invoiceNo: r.no } : null;
}
