import { type Env, one, json, fail, audit } from '../../../../_lib/db';
import { requireSession } from '../../../../_lib/auth';
import { hasServicePrices, checkPriceRows, writePrices, layoutGrid } from '../../../../_lib/servicePrices';

/** POST /api/operations/service-prices/:id/prices { effectiveFrom, note?, rows: [{ layout, ownerPrice, internalCost }] }
 *  A price change from a date (the same date again replaces it). Jobs on earlier days keep the prices they had; a job
 *  already finished keeps the amounts it was charged at. Management only. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management sets prices.', 403);
  if (!(await hasServicePrices(env))) return fail('NOT_CONFIGURED', 'Service prices need a database update (migration 0127) that is not applied yet.', 501);
  const item = await one<{ id: string; code: string; by_layout: number }>(env, 'SELECT id, code, by_layout FROM service_items WHERE id = ?', String(params.id));
  if (!item) return fail('NOT_FOUND', 'That item no longer exists.', 404);
  const set = checkPriceRows(await request.json<any>().catch(() => null), !!item.by_layout, await layoutGrid(env));
  if ('error' in set) return set.error;
  await writePrices(env, item.id, set, session.userId);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'service_item.prices', entityTable: 'service_items', entityId: item.id, after: { code: item.code, ...set } });
  return json({ ok: true, effectiveFrom: set.effectiveFrom, saved: set.rows.length });
};
