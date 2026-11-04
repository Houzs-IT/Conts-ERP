import { type Env, all, run, json, fail, audit, nowIso, transaction } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { contractTypesReady } from '../../_lib/contractTypes';

/** POST /api/contract-types/order { codes } — the whole list in its new order, renumbered in one go, so a failed move never
 *  leaves two types on the same place. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can change the contract types.', 403);
  if (!(await contractTypesReady(env))) return fail('NOT_READY', 'The contract types cannot be changed on this database yet.', 409);

  const b = await request.json<{ codes?: unknown }>().catch(() => null);
  const codes = Array.isArray(b?.codes) && b.codes.every((c): c is string => typeof c === 'string') ? b.codes : null;
  if (!codes) return fail('VALIDATION', 'Send the list of codes in order.', 422);
  const have = (await all<{ code: string }>(env, 'SELECT code FROM contract_types')).map(r => r.code);
  if (codes.length !== have.length || new Set(codes).size !== codes.length || !codes.every(c => have.includes(c)))
    return fail('CONFLICT', 'The list changed while you were ordering it. Reload and try again.', 409);

  const now = nowIso();
  await transaction(env, async tx => {
    await run(tx, `UPDATE contract_types t SET sort_order = (o.n * 10)::int, updated_at = ?
      FROM jsonb_array_elements_text(?::text::jsonb) WITH ORDINALITY AS o(code, n) WHERE t.code = o.code`, now, JSON.stringify(codes));
    await audit(tx, { actorId: session.userId, actorLabel: session.fullName, action: 'contract_type.order', entityTable: 'contract_types', entityId: 'order', after: { codes } });
  });
  return json({ ok: true });
};
