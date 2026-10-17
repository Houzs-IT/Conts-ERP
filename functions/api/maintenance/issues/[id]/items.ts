import { type Env, all, one, run, json, fail, audit, nowIso } from '../../../../_lib/db';
import { requireSession, isFieldRole } from '../../../../_lib/auth';
import { hasJobInvoices } from '../../../../_lib/jobProfit';
import { priceLines, linesTotal, writeLines } from '../../../../_lib/jobItems';

/** PUT /api/maintenance/issues/:id/items { items: [{ itemId, qty } | { itemId: null, name, qty, ownerPrice, internalCost? }] }
 *  The job's items (owner, 17 Oct 2026): staff pick items from Service prices with a quantity; each takes its owner price
 *  and internal cost in force today at the unit's layout. "Other" (no item) is the exception, with typed figures. The
 *  job's owner price (its quote) becomes the items' total. Replaces the list; an empty list clears it and leaves the quote
 *  as it was. Not on a finished job, nor once the owner has approved the quote (the owner agreed to that figure). */
export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'The office picks the items of a job.', 403);
  if (!(await hasJobInvoices(env))) return fail('NOT_CONFIGURED', 'Job items need a database update (migration 0127) that is not applied yet.', 501);
  const id = String(params.id);
  const job = await one<any>(env, 'SELECT id, unit_id, state, charge_to, quoted_amount, owner_approved_at FROM maintenance_issues WHERE id = ?', id);
  if (!job) return fail('NOT_FOUND', 'That job no longer exists.', 404);
  if (job.state === 'resolved') return fail('CONFLICT', 'That job is finished. Reopen it to change its items.', 409);
  if (job.owner_approved_at && job.charge_to === 'owner') return fail('CONFLICT', 'The owner already approved this quote, so its items stay as they are.', 409);
  const b = await request.json<any>().catch(() => null);
  const priced = await priceLines(env, job.unit_id, b?.items);
  if ('error' in priced) return priced.error;
  const { lines } = priced;
  const before = await all<any>(env, 'SELECT item_id, name, qty, owner_price, internal_cost FROM maintenance_job_items WHERE issue_id = ? ORDER BY sort_order', id);
  await writeLines(env, id, lines, session.userId);
  const total = lines.length ? linesTotal(lines) : null;
  if (total != null) await run(env, 'UPDATE maintenance_issues SET quoted_amount = ?, sku_id = ?, updated_at = ? WHERE id = ?', total, lines.find(l => l.item_id)?.item_id ?? null, nowIso(), id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'maintenance.items', entityTable: 'maintenance_issues', entityId: id,
    before: { items: before, quotedAmount: job.quoted_amount }, after: { items: lines, quotedAmount: total ?? job.quoted_amount } });
  return json({ ok: true, quotedAmount: total ?? job.quoted_amount, lines: lines.length });
};
