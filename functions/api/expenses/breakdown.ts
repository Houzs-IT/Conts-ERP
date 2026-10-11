import { type Env, one, json, fail, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { todayMyt } from '../../_lib/ops';
import { unitCosts } from '../../_lib/unitCosts';
import { mayChangeAdjustments } from '../../_lib/ownerScope';

/** GET /api/expenses/breakdown?month=YYYY-MM&unitId= | &ownerId= — the month's costs on one unit, or on every unit of
 *  an owner: Cleaning, Maintenance and each kind of bill paid on the owner's behalf, what the owner pays (deducted
 *  before the operator's share) and what others paid, every expense behind them, and the owner's credits and charges
 *  for the month or still waiting for a statement (functions/_lib/unitCosts.ts). The unit's Financials tab and the
 *  owner page read it. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Unit costs are visible to finance and management roles.', 403);

  const url = new URL(request.url);
  const month = url.searchParams.get('month') || todayMyt().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return fail('VALIDATION', 'Month must look like 2026-08.', 422);
  const unitId = url.searchParams.get('unitId'), ownerId = url.searchParams.get('ownerId');
  if (!unitId === !ownerId) return fail('VALIDATION', 'Ask for one unit or one owner.', 422);
  if (unitId && !(await one(env, 'SELECT 1 AS x FROM units WHERE id = ?', unitId))) return fail('NOT_FOUND', 'That unit no longer exists.', 404);
  if (ownerId && !(await one(env, 'SELECT 1 AS x FROM owners WHERE id = ?', ownerId))) return fail('NOT_FOUND', 'That owner no longer exists.', 404);

  const data = await unitCosts(env, month, unitId ? { unitId } : { ownerId: ownerId! });
  return json({ generatedAt: nowIso(), canChangeAdjustments: mayChangeAdjustments(session), ...data });
};
