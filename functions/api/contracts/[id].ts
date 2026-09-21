import { type Env, one, run, json, fail, audit } from '../../_lib/db';
import { requireSession, canSeeFinance } from '../../_lib/auth';
import { invalidContract, normalise } from '../../_lib/contracts';

/** PATCH /api/contracts/:id — changes the terms. Statements already finalised keep the fee they were made with. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!canSeeFinance(session.role)) return fail('FORBIDDEN', 'Finance or management access is required.', 403);

  const id = String(params.id);
  const b = await request.json<any>().catch(() => null);
  if (!b) return fail('VALIDATION', 'Nothing to change.', 422);
  const fields = invalidContract(b, false);
  if (Object.keys(fields).length) return fail('VALIDATION', 'Check the contract details.', 422, fields);

  const cur = await one<any>(env, 'SELECT id, model, management_fee_pct, grr_amount, starts_on, renews_on FROM owner_contracts WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That contract no longer exists.', 404);

  const n = normalise(b);
  // A renewal must fall after the start date, whichever of the two is being changed.
  const start = n.starts ?? cur.starts_on, renews = b.renewsOn === undefined ? cur.renews_on : n.renews;
  if (renews && start && renews <= start) return fail('VALIDATION', 'Check the contract details.', 422, { renewsOn: 'Renewal must be after the start date.' });
  await run(env, `
    UPDATE owner_contracts SET model = COALESCE(?, model), management_fee_pct = COALESCE(?, management_fee_pct), grr_amount = COALESCE(?, grr_amount),
      starts_on = COALESCE(?, starts_on), renews_on = ?, ends_on = COALESCE(?, ends_on), offer_letter = COALESCE(?, offer_letter) WHERE id = ?`,
    b.model ?? null, n.fee ?? null, b.grrAmount ?? null, n.starts ?? null, b.renewsOn === undefined ? cur.renews_on : n.renews, n.ends, b.offerLetter ?? null, id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'contract.update', entityTable: 'owner_contracts', entityId: id,
    before: { model: cur.model, fee: cur.management_fee_pct, renewsOn: cur.renews_on }, after: { model: b.model ?? cur.model, fee: n.fee ?? cur.management_fee_pct, renewsOn: b.renewsOn ?? cur.renews_on } });
  return json({ ok: true });
};
