import { type Env, one, run, json, fail, audit, nowIso, transaction } from '../../../../_lib/db';
import { requireSession, isFieldRole, type Session } from '../../../../_lib/auth';
import { fieldOwnsRepair } from '../../../../_lib/maintenanceTemplates';
import { issueLines, linesTotal, setItemQty } from '../../../../_lib/maintenanceCost';

const money = (s: Session) => !isFieldRole(s.role) && (!!s.manage || s.role === 'operations_manager');
const qtyOk = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 999;

async function load(env: Env, session: Session, id: string) {
  const m = await one<{ id: string; state: string }>(env, 'SELECT id, state FROM maintenance_issues WHERE id = ?', id);
  if (!m) return { error: fail('NOT_FOUND', 'That job no longer exists.', 404) };
  if (!(await fieldOwnsRepair(env, session, id))) return { error: fail('FORBIDDEN', 'That job is assigned to someone else.', 403) };
  return { m };
}
const answer = async (env: Env, session: Session, id: string, status = 200) => {
  const m = money(session);
  return json({ data: await issueLines(env, id, m), total: m ? await linesTotal(env, id) : null }, status);
};

/** GET /api/maintenance/issues/:id/lines — what the job used: items from the maintenance list and "Other" lines.
 *  Prices and the total only for the roles that see repair money. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const id = String(params.id);
  const { error } = await load(env, session, id);
  if (error) return error;
  return answer(env, session, id);
};

/** POST /api/maintenance/issues/:id/lines
 *    { skuId, qty }                         how many of a list item the job used (a stocked part moves in the store)
 *    { description, qty, unitPrice }        an "Other" line for something not on the list
 *    { lineId, qty?, unitPrice?, description? }  change a line (prices: operations managers, finance, management)
 *  Field accounts: their own job, quantities only (an Other line they add has no price until the office sets one). */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const id = String(params.id);
  const { m, error } = await load(env, session, id);
  if (error) return error;
  if (m!.state === 'resolved') return fail('CONFLICT', 'That job is finished. Reopen it to change what it used.', 409);
  const b = await request.json<any>().catch(() => null);
  const actor = { id: session.userId, label: session.fullName };
  const canPrice = money(session);
  if (b?.unitPrice !== undefined && !canPrice) return fail('FORBIDDEN', 'Only operations managers, finance and management can set prices.', 403);
  if (b?.unitPrice !== undefined && (!Number.isInteger(b.unitPrice) || b.unitPrice < 0 || b.unitPrice > 100_000_000)) {
    return fail('VALIDATION', 'Enter the price in RM, 0 or more.', 422, { unitPrice: 'Enter the price, 0 or more.' });
  }

  if (typeof b?.skuId === 'string' && b.skuId) {
    if (!qtyOk(b.qty ?? b.usedQty)) return fail('VALIDATION', 'Enter how many were used, a whole number from 0 to 999.', 422, { qty: 'A whole number from 0 to 999.' });
    const res = await transaction(env, tx => setItemQty(tx, id, b.skuId, b.qty ?? b.usedQty, actor));
    if (!res.ok && 'missing' in res) return fail('NOT_FOUND', 'That item is not on the maintenance list any more.', 404, { skuId: 'Pick an item from the list.' });
    if (!res.ok) return fail('OUT_OF_STOCK', `Only ${res.left} more in the parts store. Tell the office.`, 409, { qty: `Only ${res.left} more in the store.` });
    return answer(env, session, id);
  }

  const now = nowIso();
  if (typeof b?.lineId === 'string') {
    const line = await one<any>(env, 'SELECT * FROM maintenance_issue_lines WHERE id = ? AND issue_id = ?', b.lineId, id);
    if (!line) return fail('NOT_FOUND', 'That line is not on this job.', 404);
    if (b.qty !== undefined && !qtyOk(b.qty)) return fail('VALIDATION', 'Enter a whole number from 0 to 999.', 422, { qty: 'A whole number from 0 to 999.' });
    if (line.sku_id && b.qty !== undefined && b.qty !== Number(line.qty)) {
      const res = await transaction(env, tx => setItemQty(tx, id, line.sku_id, b.qty, actor));
      if (!res.ok && 'left' in res) return fail('OUT_OF_STOCK', `Only ${res.left} more in the parts store.`, 409, { qty: `Only ${res.left} more in the store.` });
    }
    const desc = typeof b.description === 'string' && !line.sku_id ? b.description.trim().slice(0, 160) : null;
    if (typeof b.description === 'string' && !line.sku_id && !desc) return fail('VALIDATION', 'Say what it is.', 422, { description: 'Say what it is.' });
    await run(env, `UPDATE maintenance_issue_lines SET qty = CASE WHEN sku_id IS NULL THEN COALESCE(?, qty) ELSE qty END, unit_price = COALESCE(?, unit_price),
      description = COALESCE(?, description), updated_by = ?, updated_at = ? WHERE id = ?`,
      b.qty ?? null, b.unitPrice ?? null, desc, session.userId, now, line.id);
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'maintenance.line_edit', entityTable: 'maintenance_issues', entityId: id,
      before: { label: line.description, quantity: Number(line.qty), unitPrice: canPrice ? Number(line.unit_price) : undefined },
      after: { label: desc ?? line.description, quantity: b.qty ?? Number(line.qty), unitPrice: canPrice ? (b.unitPrice ?? Number(line.unit_price)) : undefined } });
    return answer(env, session, id);
  }

  const description = typeof b?.description === 'string' ? b.description.trim() : '';
  if (!description) return fail('VALIDATION', 'Pick an item from the list, or describe the other item.', 422, { description: 'Say what it is.' });
  if (description.length > 160) return fail('VALIDATION', 'Keep the description to 160 characters.', 422, { description: 'Up to 160 characters.' });
  const qty = b.qty ?? 1;
  if (!qtyOk(qty) || qty === 0) return fail('VALIDATION', 'Enter a whole number from 1 to 999.', 422, { qty: 'A whole number from 1 to 999.' });
  const uom = typeof b.uom === 'string' && /^[a-z]{1,12}$/.test(b.uom) ? b.uom : 'job';
  const lineId = crypto.randomUUID();
  await run(env, `
    INSERT INTO maintenance_issue_lines (id, issue_id, sku_id, description, uom, unit_price, planned_qty, qty, created_by, created_at, updated_by, updated_at)
    VALUES (?, ?, NULL, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
    lineId, id, description, uom, b.unitPrice ?? 0, qty, session.userId, now, session.userId, now);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'maintenance.line_add', entityTable: 'maintenance_issues', entityId: id, after: { label: description, quantity: qty, unitPrice: canPrice ? b.unitPrice ?? 0 : undefined } });
  return answer(env, session, id, 201);
};

/** DELETE /api/maintenance/issues/:id/lines?lineId= — takes a line off an open job (a stocked part goes back to the store). */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Set the quantity to 0 instead.', 403);
  const id = String(params.id);
  const { m, error } = await load(env, session, id);
  if (error) return error;
  if (m!.state === 'resolved') return fail('CONFLICT', 'That job is finished. Reopen it to change what it used.', 409);
  const lineId = new URL(request.url).searchParams.get('lineId') ?? '';
  const line = await one<any>(env, 'SELECT * FROM maintenance_issue_lines WHERE id = ? AND issue_id = ?', lineId, id);
  if (!line) return fail('NOT_FOUND', 'That line is not on this job.', 404);
  await transaction(env, async tx => {
    if (line.sku_id && Number(line.qty) > 0) await setItemQty(tx, id, line.sku_id, 0, { id: session.userId, label: session.fullName });
    await run(tx, 'DELETE FROM maintenance_issue_lines WHERE id = ?', line.id);
    await audit(tx, { actorId: session.userId, actorLabel: session.fullName, action: 'maintenance.line_remove', entityTable: 'maintenance_issues', entityId: id, before: { label: line.description, quantity: Number(line.qty) } });
  });
  return answer(env, session, id);
};
