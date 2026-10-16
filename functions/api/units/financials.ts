import { type Env, one, json, fail, mytToday } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { unitMonthPnl, cachedQuery } from '../../_lib/unitPnl';

/** GET /api/units/financials?unitId=&month=YYYY-MM — the unit's owner statement and The Conts' P and L for any month
 *  (the Financials tab's month picker). Money roles only, like the record's own P and L. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Unit money is visible to management, finance and operations managers.', 403);

  const url = new URL(request.url);
  const unitId = url.searchParams.get('unitId');
  if (!unitId) return fail('VALIDATION', 'A unit is required.', 422);
  const today = mytToday().slice(0, 7);
  const month = url.searchParams.get('month') ?? today;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return fail('VALIDATION', 'The month is YYYY-MM.', 422, { month: 'Pick a month.' });
  if (!(await one(env, 'SELECT 1 AS x FROM units WHERE id = ?', unitId))) return fail('NOT_FOUND', 'That unit no longer exists.', 404);

  const { pnl, companyPnl } = await unitMonthPnl(env, cachedQuery(env), unitId, month);
  return json({ generatedAt: new Date().toISOString(), month, current: month === today, closed: month < today, pnl: pnl ?? null, companyPnl: companyPnl ?? null });
};
