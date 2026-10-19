import { type Env, json, fail } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { maintenanceMoney, cleaningMoney, hasJobInvoices, PROFIT_ROLES } from '../../_lib/jobProfit';
import { mayWork } from '../../_lib/access';

/** GET /api/operations/job-money?kind=maintenance|cleaning&id= — one job's billing, its items (maintenance), the invoices
 *  submitted against it, the actual cost (invoices, else the estimate) and the profit. Office only; the amounts only for
 *  the roles that see repair money (the others get the items and invoices without totals). */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Only the office sees a job\'s billing and costs.', 403);
  const url = new URL(request.url);
  const kind = url.searchParams.get('kind'), id = url.searchParams.get('id') ?? '';
  if (kind !== 'maintenance' && kind !== 'cleaning') return fail('VALIDATION', 'Say which kind of job.', 422);
  const ready = await hasJobInvoices(env);
  const m = (await (kind === 'maintenance' ? maintenanceMoney(env, [id]) : cleaningMoney(env, [id]))).get(id);
  if (!m) return fail('NOT_FOUND', 'That job no longer exists.', 404);
  const money = !!session.manage || mayWork(session, PROFIT_ROLES);
  return json({ ready, money, ...m, ...(money ? {} : { billed: null, actual: null, estimate: null, profit: null, lines: m.lines?.map(l => ({ ...l, internalCost: null })) }) });
};
