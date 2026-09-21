import { type Env, all, json, fail, nowIso } from '../../_lib/db';
import { requireSession, canSeeFinance } from '../../_lib/auth';
import { LOCKED_SQL } from '../../_lib/expenses';

/** GET /api/finance/expenses?category=&unitId=&from=&to= — every expense; `locked` is true once its statement is final. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!canSeeFinance(session.role)) return fail('FORBIDDEN', 'Expenses are visible to finance and management roles.', 403);

  const url = new URL(request.url);
  const category = url.searchParams.get('category'), unitId = url.searchParams.get('unitId');
  const from = url.searchParams.get('from'), to = url.searchParams.get('to');
  const args = [category, unitId, from, to].filter((v): v is string => !!v);

  const rows = await all<any>(env, `
    SELECT e.*, u.unit_number, p.name AS property_name, ${LOCKED_SQL} AS locked
    FROM expenses e JOIN units u ON u.id = e.unit_id JOIN properties p ON p.id = u.property_id
    WHERE 1 = 1 ${category ? 'AND e.category = ?' : ''} ${unitId ? 'AND e.unit_id = ?' : ''} ${from ? 'AND e.incurred_on >= ?' : ''} ${to ? 'AND e.incurred_on <= ?' : ''}
    ORDER BY e.incurred_on DESC, e.created_at DESC`, ...args);

  const sent = await all<{ p: string }>(env, `SELECT DISTINCT substr(period_start, 1, 7) AS p FROM owner_statements WHERE state IN ('finalised','sent','paid') ORDER BY p`);
  return json({
    generatedAt: nowIso(), total: rows.length, sentPeriods: sent.map(s => s.p),
    data: rows.map(r => ({
      id: r.id, unitId: r.unit_id, unitNumber: r.unit_number, propertyName: r.property_name,
      category: r.category, description: r.description, amount: Number(r.amount),
      incurredOn: r.incurred_on, reference: r.reference, chargeTo: r.charge_to, locked: !!r.locked,
    })),
  });
};
