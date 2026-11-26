import { type Env, json, fail, audit, run } from '../../../_lib/db';
import { requireSession, isFieldRole } from '../../../_lib/auth';
import { forwardClaims } from '../../../_lib/claimsForward';
import { billKey, billRefusal, invoiceIdsOf, lineOf, outsideJobs, outsideJobsByIds } from '../../../_lib/cleaningBilling';

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

/** POST /api/housekeeping/cleaning-invoices { taskIds, invoiceDate? }
 *  One invoice to one client for the outside jobs picked: one job when it is added, or a month of the client's jobs.
 *  The engine issues it and books it at once; each job then keeps the invoice. The same jobs sent again answer with
 *  that invoice. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Cleaning invoices are made by the office.', 403);
  const b = await request.json<{ taskIds?: unknown; invoiceDate?: unknown }>().catch(() => null);
  const picked = Array.isArray(b?.taskIds) ? [...new Set(b!.taskIds.map(String).filter(Boolean))] : [];
  const invoiceDate = typeof b?.invoiceDate === 'string' && DAY.test(b.invoiceDate) ? b.invoiceDate : undefined;
  const jobs = await outsideJobsByIds(env, picked.slice(0, 201));
  const refused = billRefusal(picked, jobs);
  if (refused) return fail('VALIDATION', refused, 422);

  const sorted = [...jobs].sort((x, y) => x.day.localeCompare(y.day));
  const first = sorted[0];
  const res = await forwardClaims(env, session, 'POST', '/cleaning-invoices', {
    key: await billKey(picked), customerName: String(first.client).trim(), phone: sorted.find(j => j.phone)?.phone ?? null,
    address: first.address, invoiceDate, lines: sorted.map(lineOf),
  });
  if (!res.ok) return res;
  const made = await res.json<{ invoice?: { id?: string; invoiceNo?: string; totalSen?: number } }>().catch(() => null);
  const inv = made?.invoice;
  if (!inv?.id || !inv.invoiceNo) return fail('ENGINE_REFUSED', 'The finance system did not say which invoice it made. Try again.', 424);
  await run(env, `UPDATE tasks SET cleaning_invoice_id = ?, cleaning_invoice_no = ?, updated_at = now()
                   WHERE id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) AND cleaning_invoice_id IS NULL`,
    inv.id, inv.invoiceNo, JSON.stringify(picked));
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'cleaning.invoice', entityTable: 'tasks', entityId: inv.id,
    after: { invoiceNo: inv.invoiceNo, client: first.client, jobs: picked, totalSen: inv.totalSen ?? null } });
  return json({ invoice: inv }, res.status);
};
