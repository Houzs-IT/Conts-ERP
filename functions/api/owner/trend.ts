import { type Env, all, json } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { ownerFor, VISIBLE } from '../../_lib/ownerScope';

/** GET /api/owner/trend?months=8 — net payout per finalised statement, oldest first. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const url = new URL(request.url);
  const owner = await ownerFor(env, session, url);
  if (owner instanceof Response) return owner;

  const months = Math.max(1, Math.min(Number(url.searchParams.get('months') ?? 8) || 8, 24));
  const rows = await all<any>(env, `
    SELECT substr(period_start, 1, 7) AS period, net_payout FROM owner_statements
    WHERE owner_id = ? AND state IN ${VISIBLE} ORDER BY period_start DESC LIMIT ?`, owner.id, months);
  const units = await all<any>(env, `SELECT u.unit_number, p.name AS property_name FROM units u JOIN properties p ON p.id = u.property_id WHERE u.owner_id = ?`, owner.id);

  return json({
    months, unitLabel: units.length === 1 ? `${units[0].property_name} ${units[0].unit_number}` : `${units.length} units`,
    points: rows.reverse().map(r => ({ period: r.period, netPayout: Number(r.net_payout) })),
  });
};
