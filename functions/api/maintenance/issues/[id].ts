import { type Env, one, run, json, fail, audit, nowIso } from '../../../_lib/db';
import { requireSession, isFieldRole } from '../../../_lib/auth';
import { CATEGORIES, URGENCIES, ASSIGNEE_KINDS, CHARGE_TO, approvalThreshold, needsApproval, assigneeUserId } from '../../../_lib/maintenance';
import { repairNotice } from '../../../_lib/notices';

/** PATCH /api/maintenance/issues/:id — any of:
 *   { assigneeId | assigneeName, assigneeKind }  the technician or contractor (a NAME: outside vendors are not accounts)
 *   { category, urgency, chargeTo, title, detail, quotedAmount }
 *   { state: 'reopened' }                        a finished job back to work
 *  A quote (or a change of payer) is checked against the approval threshold: above it, a repair the owner pays waits
 *  for the owner; back under it, a job still waiting goes back to work. An approval already given stands. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Field roles cannot change maintenance jobs.', 403);

  const id = String(params.id);
  const b = await request.json<any>().catch(() => null);
  const cur = await one<any>(env, 'SELECT * FROM maintenance_issues WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That job no longer exists.', 404);
  const now = nowIso();

  if (b?.state === 'reopened') {
    if (cur.state !== 'resolved') return fail('CONFLICT', 'Only a finished job can be reopened.', 409);
    await run(env, `UPDATE maintenance_issues SET state = 'reopened', final_amount = NULL, resolved_at = NULL, updated_at = ? WHERE id = ?`, now, id);
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'maintenance.reopen', entityTable: 'maintenance_issues', entityId: id, before: { state: cur.state }, after: { state: 'reopened' } });
    return json({ ok: true, state: 'reopened' });
  }
  if (cur.state === 'resolved') return fail('CONFLICT', 'That job is finished. Reopen it to change it.', 409);

  const sets: string[] = [], args: unknown[] = [];
  const before: Record<string, unknown> = {}, after: Record<string, unknown> = {};
  const put = (col: string, key: string, v: unknown) => { sets.push(`${col} = ?`); args.push(v); before[key] = cur[col]; after[key] = v; };

  const name = typeof b?.assigneeName === 'string' ? b.assigneeName : typeof b?.assigneeId === 'string' ? b.assigneeId : undefined;
  if (name !== undefined) {
    if (!name.trim()) return fail('VALIDATION', 'Name the technician or contractor.', 422, { assigneeName: 'Enter a name.' });
    put('vendor_name', 'assignee', name.trim().slice(0, 80));
    const kind = b?.assigneeKind ?? cur.assignee_kind ?? 'contractor';
    if (!ASSIGNEE_KINDS.includes(kind)) return fail('VALIDATION', 'In-house or contractor.', 422, { assigneeKind: 'In-house or contractor.' });
    put('assignee_kind', 'assigneeKind', kind);
    const userId = await assigneeUserId(env, name.trim().slice(0, 80));
    if (userId !== undefined) put('assignee_user_id', 'assigneeUserId', userId);
  }
  if (b?.category !== undefined) {
    if (!CATEGORIES.includes(b.category)) return fail('VALIDATION', 'Pick a category.', 422, { category: 'Pick a category.' });
    put('category', 'category', b.category);
  }
  if (b?.urgency !== undefined) {
    if (!URGENCIES.includes(b.urgency)) return fail('VALIDATION', 'Normal or urgent.', 422, { urgency: 'Normal or urgent.' });
    put('urgency', 'urgency', b.urgency);
  }
  if (b?.chargeTo !== undefined) {
    if (!CHARGE_TO.includes(b.chargeTo)) return fail('VALIDATION', 'Pick who pays.', 422, { chargeTo: 'Pick who pays.' });
    put('charge_to', 'chargeTo', b.chargeTo);
  }
  if (typeof b?.title === 'string') {
    if (!b.title.trim()) return fail('VALIDATION', 'A short title is required.', 422, { title: 'Enter a short title.' });
    put('title', 'title', b.title.trim().slice(0, 160));
  }
  if (typeof b?.detail === 'string') put('detail', 'detail', b.detail.trim().slice(0, 2000) || null);
  if (b?.quotedAmount !== undefined) {
    if (!session.manage && session.role !== 'operations_manager') return fail('FORBIDDEN', 'Only operations managers, finance and management can set a quote.', 403);
    if (b.quotedAmount !== null && (!Number.isInteger(b.quotedAmount) || b.quotedAmount < 0)) return fail('VALIDATION', 'Enter the quote in sen, RM 0.00 or more.', 422, { quotedAmount: 'Enter the quote.' });
    put('quoted_amount', 'quotedAmount', b.quotedAmount);
  }
  if (!sets.length) return fail('VALIDATION', 'Nothing to change.', 422);

  // The state that follows: approval gate first, then whether someone is on it.
  const quote = b?.quotedAmount !== undefined ? b.quotedAmount : cur.quoted_amount;
  const payer = b?.chargeTo ?? cur.charge_to;
  const vendor = after.assignee ?? cur.vendor_name;
  let state = cur.state;
  if (b?.quotedAmount !== undefined || b?.chargeTo !== undefined) {
    const required = needsApproval(quote, payer, await approvalThreshold(env));
    if (required && !cur.owner_approved_at) {
      put('owner_approval_required', 'ownerApprovalRequired', 1);
      state = 'waiting';
    } else if (!required && !cur.owner_approved_at && cur.state === 'waiting') {
      put('owner_approval_required', 'ownerApprovalRequired', 0);
      state = cur.started_at ? 'in_progress' : vendor ? 'assigned' : 'open';
    }
  }
  if (state === 'open' && vendor) state = 'assigned';
  if (state !== cur.state) put('state', 'state', state);

  await run(env, `UPDATE maintenance_issues SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, ...args, now, id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: name !== undefined ? 'maintenance.assign' : 'maintenance.edit', entityTable: 'maintenance_issues', entityId: id, before, after });
  if (name !== undefined && after.assignee !== before.assignee) await repairNotice(env, id, 'assigned', session.userId);
  return json({ ok: true, state });
};
