import { type Env, one, run, json, fail, audit, nowIso, mytToday } from '../../../_lib/db';
import { requireSession, isFieldRole } from '../../../_lib/auth';
import { MASTER_ROLES } from '../../../_lib/properties';
import { CATEGORIES, URGENCIES, CHARGE_TO, DAY, JOB_TYPES, SEVERITIES, assigneeUserId, assigneeKindFor, hasBilling, hasJobType, urgencyOf, approvalRules, ruleNeedsApproval } from '../../../_lib/maintenance';
import { isPeriodLocked } from '../../../_lib/expenses';
import { repairNotice } from '../../../_lib/notices';
import { hasServicePrices, serviceBook } from '../../../_lib/servicePrices';
import { layoutKey } from '../../../_lib/cleaningPrices';

/** The money follow-up a finished job still takes (migration 0108): when it is billed, when the payer's money came in,
 *  what the technician or contractor is owed and when accounts paid them. */
const MONEY_KEYS = ['billingDate', 'collectedAt', 'contractorAmount', 'contractorPaidAt'] as const;

/** PATCH /api/maintenance/issues/:id — any of:
 *   { assigneeName }                             the technician or contractor (a NAME: outside vendors are not accounts);
 *                                                in-house or contractor follows from whether the name is a staff account
 *   { category, urgency, chargeTo, title, detail, quotedAmount }
 *   { skuId }                                    the item from the maintenance catalog; null = Other (not on the list)
 *   { billingDate, collectedAt, contractorAmount, contractorPaidAt }   also on a finished job
 *   { jobType, severity, needsParts, partsArrived, dueOn }   job type (urgent | normal | pass_key), minor | major, whether
 *                                                it waits for parts, the "Parts arrived" tick (true / false) and the due date
 *   { state: 'reopened' }                        a finished job back to work
 *  Nothing here sends a job to the owner: that is "Send to owner for approval" (request-approval.ts) only.
 *  A new billing date on a finished job moves its expense to that day, unless either month's owner statement is final. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Cleaners and technicians cannot change maintenance jobs.', 403);

  const id = String(params.id);
  const b = await request.json<any>().catch(() => null);
  const cur = await one<any>(env, 'SELECT * FROM maintenance_issues WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That job no longer exists.', 404);
  const now = nowIso();
  const moneyRole = MASTER_ROLES.includes(session.role);

  if (b?.state === 'reopened') {
    if (cur.state !== 'resolved') return fail('CONFLICT', 'Only a finished job can be reopened.', 409);
    await run(env, `UPDATE maintenance_issues SET state = 'reopened', final_amount = NULL, resolved_at = NULL, updated_at = ? WHERE id = ?`, now, id);
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'maintenance.reopen', entityTable: 'maintenance_issues', entityId: id, before: { state: cur.state }, after: { state: 'reopened' } });
    return json({ ok: true, state: 'reopened' });
  }
  const moneyOnly = b && typeof b === 'object' && Object.keys(b).length > 0 && Object.keys(b).every(k => (MONEY_KEYS as readonly string[]).includes(k));
  if (cur.state === 'resolved' && !moneyOnly) return fail('CONFLICT', 'That job is finished. Reopen it to change it.', 409);

  const sets: string[] = [], args: unknown[] = [];
  const before: Record<string, unknown> = {}, after: Record<string, unknown> = {};
  const put = (col: string, key: string, v: unknown) => { sets.push(`${col} = ?`); args.push(v); before[key] = cur[col]; after[key] = v; };

  const name = typeof b?.assigneeName === 'string' ? b.assigneeName : typeof b?.assigneeId === 'string' ? b.assigneeId : undefined;
  if (name !== undefined) {
    if (!name.trim()) return fail('VALIDATION', 'Pick the technician or contractor.', 422, { assigneeName: 'Pick who does the job.' });
    const picked = name.trim().slice(0, 80);
    put('vendor_name', 'assignee', picked);
    put('assignee_kind', 'assigneeKind', await assigneeKindFor(env, picked));
    const userId = await assigneeUserId(env, picked);
    if (userId !== undefined) put('assignee_user_id', 'assigneeUserId', userId);
  }
  if (b?.category !== undefined) {
    if (!CATEGORIES.includes(b.category)) return fail('VALIDATION', 'Pick a category.', 422, { category: 'Pick a category.' });
    put('category', 'category', b.category);
  }
  const cols = await hasJobType(env);
  if (b?.jobType !== undefined) {
    if (!JOB_TYPES.includes(b.jobType) || (!cols && b.jobType === 'pass_key')) return fail('VALIDATION', 'Urgent, Normal or Pass key.', 422, { jobType: 'Urgent, Normal or Pass key.' });
    if (cols) put('job_type', 'jobType', b.jobType);
    put('urgency', 'urgency', urgencyOf(b.jobType));
  } else if (b?.urgency !== undefined) {
    if (!URGENCIES.includes(b.urgency)) return fail('VALIDATION', 'Normal or urgent.', 422, { urgency: 'Normal or urgent.' });
    put('urgency', 'urgency', b.urgency);
    // Urgency from an older screen moves the type with it; a Pass key job stays one unless made urgent.
    if (cols && (b.urgency === 'urgent' || cur.job_type === 'urgent')) put('job_type', 'jobType', b.urgency === 'urgent' ? 'urgent' : 'normal');
  }
  if (b?.severity !== undefined || b?.needsParts !== undefined || b?.partsArrived !== undefined || b?.dueOn !== undefined) {
    if (!cols) return fail('NOT_CONFIGURED', 'Severity, parts and due dates need a database update (migration 0126) that is not applied yet.', 501);
    if (b.severity !== undefined) {
      if (!SEVERITIES.includes(b.severity)) return fail('VALIDATION', 'Minor or major.', 422, { severity: 'Minor or major.' });
      put('severity', 'severity', b.severity);
    }
    if (b.needsParts !== undefined) {
      if (typeof b.needsParts !== 'boolean') return fail('VALIDATION', 'Say whether the job needs parts.', 422, { needsParts: 'Yes or no.' });
      put('needs_parts', 'needsParts', b.needsParts ? 1 : 0);
      if (!b.needsParts) put('parts_arrived_at', 'partsArrivedAt', null);
    }
    if (b.partsArrived !== undefined) {
      if (typeof b.partsArrived !== 'boolean') return fail('VALIDATION', 'Say whether the parts arrived.', 422, { partsArrived: 'Yes or no.' });
      if (b.partsArrived) put('needs_parts', 'needsParts', 1);
      put('parts_arrived_at', 'partsArrivedAt', b.partsArrived ? cur.parts_arrived_at ?? now : null);
    }
    if (b.dueOn !== undefined) {
      if (b.dueOn !== null && (typeof b.dueOn !== 'string' || !DAY.test(b.dueOn))) return fail('VALIDATION', 'Pick the due date.', 422, { dueOn: 'Pick the due date.' });
      put('due_on', 'dueOn', b.dueOn);
    }
  }
  if (b?.chargeTo !== undefined) {
    if (!CHARGE_TO.includes(b.chargeTo)) return fail('VALIDATION', 'Pick who pays.', 422, { chargeTo: 'Pick who pays.' });
    put('charge_to', 'chargeTo', b.chargeTo);
  }
  if (typeof b?.title === 'string') {
    if (!b.title.trim()) return fail('VALIDATION', 'A short title is required.', 422, { title: 'Enter a short title.' });
    put('title', 'title', b.title.trim().slice(0, 160));
  }
  if (b?.skuId !== undefined) {
    if (b.skuId !== null && !(await one(env, 'SELECT 1 AS x FROM maintenance_skus WHERE id = ?', String(b.skuId)))) return fail('NOT_FOUND', 'That catalog item does not exist.', 404, { skuId: 'Pick an item from the catalog, or Other.' });
    put('sku_id', 'skuId', b.skuId === null ? null : String(b.skuId));
    // A newly picked item fills a quote and an internal cost not yet set, from its prices in force today.
    if (b.skuId !== null && moneyRole && await hasServicePrices(env)) {
      const u = await one<{ layout_type: string | null; bedrooms: number | null }>(env, 'SELECT * FROM units WHERE id = ?', cur.unit_id);
      const a = (await serviceBook(env, [cur.unit_id])).amounts(String(b.skuId), cur.unit_id, layoutKey(u?.layout_type, u?.bedrooms), mytToday());
      if (cur.quoted_amount == null && b.quotedAmount === undefined && a.owner != null) put('quoted_amount', 'quotedAmount', a.owner);
      if (cur.contractor_amount == null && b.contractorAmount === undefined && a.internal != null && await hasBilling(env)) put('contractor_amount', 'contractorAmount', a.internal);
    }
  }
  if (typeof b?.detail === 'string') put('detail', 'detail', b.detail.trim().slice(0, 2000) || null);
  if (b?.quotedAmount !== undefined) {
    if (!moneyRole) return fail('FORBIDDEN', 'Only operations managers, finance and management can set a quote.', 403);
    if (b.quotedAmount !== null && (!Number.isInteger(b.quotedAmount) || b.quotedAmount < 0)) return fail('VALIDATION', 'Enter the quote in sen, RM 0.00 or more.', 422, { quotedAmount: 'Enter the quote.' });
    put('quoted_amount', 'quotedAmount', b.quotedAmount);
  }

  const money = MONEY_KEYS.filter(k => b?.[k] !== undefined);
  if (money.length) {
    if (!moneyRole) return fail('FORBIDDEN', 'Only operations managers, finance and management can record billing and payments.', 403);
    if (!(await hasBilling(env))) return fail('NOT_CONFIGURED', 'Billing dates and payments need a database update (migration 0108) that is not applied yet.', 501);
    for (const [key, col, label] of [['billingDate', 'billing_date', 'the billing date'], ['collectedAt', 'collected_at', 'the day the money came in'], ['contractorPaidAt', 'contractor_paid_at', 'the day the contractor was paid']] as const) {
      if (b?.[key] === undefined) continue;
      if (b[key] !== null && (typeof b[key] !== 'string' || !DAY.test(b[key]))) return fail('VALIDATION', `Pick ${label}.`, 422, { [key]: `Pick ${label}.` });
      put(col, key, b[key]);
    }
    if (b?.contractorAmount !== undefined) {
      if (b.contractorAmount !== null && (!Number.isInteger(b.contractorAmount) || b.contractorAmount < 0)) return fail('VALIDATION', 'Enter the amount owed, RM 0.00 or more.', 422, { contractorAmount: 'Enter the amount owed.' });
      put('contractor_amount', 'contractorAmount', b.contractorAmount);
    }
  }
  if (!sets.length) return fail('VALIDATION', 'Nothing to change.', 422);

  // A finished job's expense follows its billing date into the right month.
  let moved: { id: string; from: string; to: string } | null = null;
  if (b?.billingDate !== undefined && cur.state === 'resolved') {
    const exp = await one<{ id: string; incurred_on: string }>(env, 'SELECT id, incurred_on FROM expenses WHERE maintenance_id = ? ORDER BY created_at LIMIT 1', id);
    const to = b.billingDate ?? exp?.incurred_on;
    if (exp && to && to !== exp.incurred_on) {
      if (await isPeriodLocked(env, cur.unit_id, exp.incurred_on)) return fail('PERIOD_LOCKED', 'The owner statement this cost is on is already final, so it cannot move to another month.', 409);
      if (await isPeriodLocked(env, cur.unit_id, to)) return fail('PERIOD_LOCKED', "That month's owner statement is already final, so the cost cannot be added to it.", 409, { billingDate: 'That month is closed.' });
      moved = { id: exp.id, from: exp.incurred_on, to };
    }
  }

  // The state that follows. A job sent to the owner stops waiting only if the company or the guest now pays.
  const payer = b?.chargeTo ?? cur.charge_to;
  const vendor = after.assignee ?? cur.vendor_name;
  let state = cur.state;
  if (cur.state !== 'resolved') {
    if (cur.state === 'waiting' && !cur.owner_approved_at && payer !== 'owner') {
      put('owner_approval_required', 'ownerApprovalRequired', 0);
      state = cur.started_at ? 'in_progress' : vendor ? 'assigned' : 'open';
    }
    // Management's approval rules: a change of category, severity, quote or payer can make a job need the owner's approval
    // before anyone has started or approved it. Rules only ever add the wait; taking a job off it is the payer's change above.
    const touched = ['category', 'severity', 'quotedAmount', 'chargeTo'].some(k => k in after);
    if (cols && touched && payer === 'owner' && !cur.owner_approval_required && !cur.owner_approved_at && !cur.started_at
      && ruleNeedsApproval(await approvalRules(env), String(after.category ?? cur.category), String(after.severity ?? cur.severity), (after.quotedAmount ?? cur.quoted_amount) as number | null)) {
      put('owner_approval_required', 'ownerApprovalRequired', 1);
      state = 'waiting';
    }
    if (state === 'open' && vendor) state = 'assigned';
    if (state !== cur.state) put('state', 'state', state);
  }

  await run(env, `UPDATE maintenance_issues SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, ...args, now, id);
  if (moved) {
    await run(env, 'UPDATE expenses SET incurred_on = ? WHERE id = ?', moved.to, moved.id);
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'expense.update', entityTable: 'expenses', entityId: moved.id, before: { incurredOn: moved.from }, after: { incurredOn: moved.to, reason: 'Maintenance billing date changed' } });
  }
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: name !== undefined ? 'maintenance.assign' : 'maintenance.edit', entityTable: 'maintenance_issues', entityId: id, before, after });
  if (name !== undefined && after.assignee !== before.assignee) await repairNotice(env, id, 'assigned', session.userId);
  return json({ ok: true, state, expenseMovedTo: moved?.to ?? null });
};
