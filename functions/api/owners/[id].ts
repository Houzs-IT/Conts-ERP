import { type Env, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';

/** PATCH /api/owners/:id { defaultManagementFeePct: number | null } — set or clear
 *  the owner-level default management fee. A unit's own contract fee overrides it. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can change owner fees.', 403);

  const id = String(params.id);
  const owner = await one<{ id: string; display_name: string; default_management_fee_pct: number | null }>(env, 'SELECT id, display_name, default_management_fee_pct FROM owners WHERE id = ?', id);
  if (!owner) return fail('NOT_FOUND', 'That owner no longer exists.', 404);

  const b = await request.json<any>().catch(() => null);
  if (!b || !('defaultManagementFeePct' in b)) return fail('VALIDATION', 'Provide a default management fee, or null to clear it.', 422);
  const raw = b.defaultManagementFeePct;
  let pct: number | null;
  if (raw === null || raw === '') {
    pct = null;
  } else {
    pct = Number(raw);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return fail('VALIDATION', 'The fee must be between 0 and 100.', 422, { defaultManagementFeePct: 'Enter 0 to 100, or leave blank.' });
  }

  await run(env, 'UPDATE owners SET default_management_fee_pct = ?, updated_at = ? WHERE id = ?', pct, nowIso(), id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'owner.update', entityTable: 'owners', entityId: id, before: { defaultManagementFeePct: owner.default_management_fee_pct == null ? null : Number(owner.default_management_fee_pct) }, after: { defaultManagementFeePct: pct } });
  return json({ ok: true, defaultManagementFeePct: pct });
};

/** DELETE /api/owners/:id — only when the owner has no units, contract, statements or payouts.
 *  An owner with any real history is never deleted here; reassign their units first. */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can delete owners.', 403);

  const id = String(params.id);
  const owner = await one<{ id: string; display_name: string; email: string; user_id: string | null }>(env, 'SELECT id, display_name, email, user_id FROM owners WHERE id = ?', id);
  if (!owner) return fail('NOT_FOUND', 'That owner no longer exists.', 404);

  const units = await one<{ n: number }>(env, 'SELECT COUNT(*) AS n FROM units WHERE owner_id = ?', id);
  if (Number(units?.n) > 0) return fail('HAS_UNITS', `${owner.display_name} still has ${units!.n} unit${Number(units!.n) === 1 ? '' : 's'} linked. Move them to another owner first.`, 409);

  const contracts = await one<{ n: number }>(env, 'SELECT COUNT(*) AS n FROM owner_contracts WHERE owner_id = ?', id);
  if (Number(contracts?.n) > 0) return fail('HAS_CONTRACT', `${owner.display_name} has a contract on file, so this record cannot be deleted.`, 409);

  const statements = await one<{ n: number }>(env, 'SELECT COUNT(*) AS n FROM owner_statements WHERE owner_id = ?', id);
  if (Number(statements?.n) > 0) return fail('HAS_STATEMENTS', `${owner.display_name} has statement history and cannot be deleted.`, 409);

  const payouts = await one<{ n: number }>(env, 'SELECT COUNT(*) AS n FROM payouts WHERE owner_id = ?', id);
  if (Number(payouts?.n) > 0) return fail('HAS_PAYOUTS', `${owner.display_name} has payout history and cannot be deleted.`, 409);

  const adjustments = await one<{ n: number }>(env, 'SELECT COUNT(*) AS n FROM owner_adjustments WHERE owner_id = ?', id);
  if (Number(adjustments?.n) > 0) return fail('HAS_ADJUSTMENTS', `${owner.display_name} has credits or charges on record and cannot be deleted.`, 409);

  // The login exists only for this owner's portal access, so it goes with the record.
  if (owner.user_id) await run(env, "DELETE FROM users WHERE id = ? AND role = 'owner'", owner.user_id);
  await run(env, 'DELETE FROM owners WHERE id = ?', id);

  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'owner.delete', entityTable: 'owners', entityId: id, before: { displayName: owner.display_name, email: owner.email } });
  return json({ ok: true });
};
