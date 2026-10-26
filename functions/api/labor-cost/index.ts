import { can } from '../../_lib/access';
import { type Env, json, fail, mytToday } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { hasEmployees } from '../../_lib/hr';
import { laborCost, type LaborCostPayload } from '../../_lib/laborCost';

const isDay = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const MAX_DAYS = 366;

/**
 * GET /api/labor-cost?from&to&department — HR > Employees > Labor Cost and Department Labor: labour cost of the logged
 * hours per department, against what the cleaning and repair jobs were billed, and for one finished month the payroll
 * reconciliation. Revenue only for those who see job money (management and Finance), as Profit by job.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role) || session.role === 'owner') return fail('FORBIDDEN', 'Labour cost is kept by the office.', 403);
  if (!(await hasEmployees(env))) return fail('NOT_MIGRATED', 'Labour cost needs the employee record (migration 0162).', 503);
  const today = mytToday();
  const q = new URL(request.url).searchParams;
  const from = isDay(q.get('from')) ? String(q.get('from')) : `${today.slice(0, 7)}-01`;
  const to = isDay(q.get('to')) ? String(q.get('to')) : today;
  if (to < from) return fail('VALIDATION', 'The end date is before the start date.', 422, { to: 'Before the start.' });
  if ((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 >= MAX_DAYS) return fail('VALIDATION', 'Pick at most a year.', 422, { to: 'At most a year.' });
  const d = q.get('department');
  const department = d === 'cleaning' || d === 'maintenance' ? d : null;
  const showRevenue = session.role === 'management' || can(session, 'finance', 'view');
  const payload: LaborCostPayload = await laborCost(env, from, to, showRevenue, department);
  return json(payload);
};
