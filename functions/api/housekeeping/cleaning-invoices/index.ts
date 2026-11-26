import { type Env, json, fail, audit } from '../../../_lib/db';
import { requireSession, isFieldRole } from '../../../_lib/auth';
import { forwardClaims } from '../../../_lib/claimsForward';
import { type OutsideJob, type Line, billKey, billRefusal, invoiceIdsOf, jobLines, linkJobs, lumpLine, outsideJobs, outsideJobsByIds } from '../../../_lib/cleaningBilling';
import type { Session } from '../../../_lib/auth';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const thisMonth = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 7);

/** GET /api/housekeeping/cleaning-invoices?month=YYYY-MM
 *  The outside cleaning jobs: every one not billed yet, and those of the month billed, with their invoices (from the
 *  engine) and what each client has paid. Whoever may add cleaning jobs (lib/cleaningBilling). */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Cleaning invoices are made by the office.', 403);
  const m = new URL(request.url).searchParams.get('month') ?? '';
  const month = MONTH.test(m) ? m : thisMonth();
  const jobs = await outsideJobs(env, month);
  const ids = invoiceIdsOf(jobs);
  let invoices: unknown[] = [];
  if (ids.length) {
    const res = await forwardClaims(env, session, 'GET', `/cleaning-invoices?ids=${ids.join(',')}`);
    if (!res.ok) return res;
    invoices = ((await res.json<{ invoices?: unknown[] }>().catch(() => null))?.invoices ?? []);
  }
  return json({ month, jobs, invoices });
};

/** POST /api/housekeeping/cleaning-invoices { taskIds, mode: combine | each, invoiceDate?, customerName?, phone?, address?, totalSen? }
 *  combine: the jobs picked on one invoice to the bill-to typed (chew, 27 Nov 2026: free to combine, the office decides);
 *    a total typed over what the jobs add up to (a package: jobs at RM 0) makes it one lump-sum line.
 *  each: every job on an invoice of its own, to its own client at its own amount.
 *  The engine issues and books each invoice at once; each job then keeps its invoice. The same jobs sent again answer
 *  with the invoice already made. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Cleaning invoices are made by the office.', 403);
  const b = await request.json<Record<string, unknown>>().catch(() => null);
  const picked = Array.isArray(b?.taskIds) ? [...new Set((b!.taskIds as unknown[]).map(String).filter(Boolean))] : [];
  const each = b?.mode === 'each';
  const invoiceDate = typeof b?.invoiceDate === 'string' && DAY.test(b.invoiceDate) ? b.invoiceDate : undefined;
  const jobs = await outsideJobsByIds(env, picked.slice(0, 201));
  const refused = billRefusal(picked, jobs, each);
  if (refused) return fail('VALIDATION', refused, 422);

  if (each) {
    const made: unknown[] = [], failed: { taskId: string; message: string }[] = [];
    for (const j of [...jobs].sort((x, y) => x.day.localeCompare(y.day))) {
      const r = await issue(env, session, [j], { customerName: String(j.client).trim(), phone: j.phone, address: j.address, invoiceDate }, jobLines([j]), false);
      if (r instanceof Response) failed.push({ taskId: j.id, message: (await r.json<{ error?: { message?: string } }>().catch(() => null))?.error?.message ?? 'Not billed.' });
      else made.push(r);
    }
    if (!made.length) return fail('ENGINE_REFUSED', failed[0]?.message ?? 'Nothing was billed.', 424);
    return json({ invoices: made, failed }, 201);
  }

  const customerName = String(b?.customerName ?? '').trim().slice(0, 120);
  if (!customerName) return fail('VALIDATION', 'Enter who the invoice is to.', 422, { customerName: 'Enter who the invoice is to.' });
  const sum = jobs.reduce((n, j) => n + Number(j.amount ?? 0), 0);
  const total = b?.totalSen == null ? sum : Number(b.totalSen);
  if (!Number.isSafeInteger(total) || total <= 0) return fail('VALIDATION', 'Enter the invoice total.', 422, { totalSen: 'Enter the invoice total.' });
  const lump = total !== sum || jobs.some(j => !j.amount || j.amount <= 0);
  const lines = lump ? [lumpLine(jobs, total)] : jobLines(jobs);
  const r = await issue(env, session, jobs, {
    customerName, phone: String(b?.phone ?? '').trim().slice(0, 40) || null, address: String(b?.address ?? '').trim().slice(0, 300) || null, invoiceDate,
  }, lines, lump);
  if (r instanceof Response) return r;
  return json({ invoice: r }, 201);
};

async function issue(env: Env, session: Session, jobs: OutsideJob[], head: { customerName: string; phone: string | null; address: string | null; invoiceDate?: string }, lines: Line[], lump: boolean) {
  const ids = jobs.map(j => j.id);
  const res = await forwardClaims(env, session, 'POST', '/cleaning-invoices', { key: await billKey(ids), ...head, lump, lines });
  if (!res.ok) return res;
  const inv = (await res.json<{ invoice?: { id?: string; invoiceNo?: string; totalSen?: number } }>().catch(() => null))?.invoice;
  if (!inv?.id || !inv.invoiceNo) return fail('ENGINE_REFUSED', 'The finance system did not say which invoice it made. Try again.', 424);
  await linkJobs(env, { id: inv.id, invoiceNo: inv.invoiceNo }, lines);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'cleaning.invoice', entityTable: 'tasks', entityId: inv.id,
    after: { invoiceNo: inv.invoiceNo, billTo: head.customerName, jobs: ids, lump, totalSen: inv.totalSen ?? null } });
  return inv;
}
