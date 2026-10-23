import { type Env, all, json, fail } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { can } from '../../_lib/access';
import { maintenanceMoney, cleaningMoney } from '../../_lib/jobProfit';
import { MYT_DATE, SHEET_CLEANER } from '../../_lib/ops';

/** GET /api/operations/job-profit?kind=maintenance|cleaning&month=YYYY-MM — Profit by job: every job finished in the month
 *  (Malaysia), with its unit, category, who did it, what was billed, the actual cost (invoices, else the estimate) and
 *  the profit, and the month's totals. The screen filters by building, unit, category and who did it. For the roles
 *  that see repair money. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage && !can(session, 'finance', 'view')) return fail('FORBIDDEN', 'Only managers and finance see profit by job.', 403);
  const url = new URL(request.url);
  const kind = url.searchParams.get('kind') === 'cleaning' ? 'cleaning' : 'maintenance';
  const month = url.searchParams.get('month') ?? new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return fail('VALIDATION', 'Pick a month.', 422, { month: 'YYYY-MM' });

  const jobs = kind === 'maintenance'
    ? await all<any>(env, `
      SELECT m.id, m.title, m.category, m.charge_to, m.vendor_name AS who, ${MYT_DATE('m.resolved_at')} AS day, u.id AS unit_id, u.unit_number, p.id AS building_id, p.name AS building
      FROM maintenance_issues m JOIN units u ON u.id = m.unit_id JOIN properties p ON p.id = u.property_id
      WHERE m.state = 'resolved' AND m.resolved_at IS NOT NULL AND substr(${MYT_DATE('m.resolved_at')}, 1, 7) = ? ORDER BY m.resolved_at`, month)
    : await all<any>(env, `
      SELECT t.id, t.title, t.kind AS category, 'owner' AS charge_to, COALESCE(cl.full_name, a.full_name, ${SHEET_CLEANER('t')}) AS who, ${MYT_DATE('t.completed_at')} AS day,
             u.id AS unit_id, COALESCE(u.unit_number, t.external_address) AS unit_number, COALESCE(p.id, 'external') AS building_id, COALESCE(p.name, 'External') AS building
      FROM tasks t LEFT JOIN units u ON u.id = t.unit_id LEFT JOIN properties p ON p.id = u.property_id
      LEFT JOIN cleaners cl ON cl.id = t.cleaner_id LEFT JOIN users a ON a.id = t.assignee_id
      WHERE t.kind IN ('turnover','deep_clean','light_clean') AND t.state = 'resolved' AND t.completed_at IS NOT NULL
        AND substr(${MYT_DATE('t.completed_at')}, 1, 7) = ? ORDER BY t.completed_at`, month);
  const money = kind === 'maintenance' ? await maintenanceMoney(env, jobs.map(j => j.id)) : await cleaningMoney(env, jobs.map(j => j.id));
  const rows = jobs.map(j => {
    const m = money.get(j.id)!;
    return {
      id: j.id, title: j.title, category: j.category, chargeTo: j.charge_to, who: j.who ?? null, day: j.day,
      unitId: j.unit_id ?? null, unitNumber: j.unit_number, buildingId: j.building_id, building: j.building,
      billed: m.billed, billedSource: m.billedSource, actual: m.actual, actualSource: m.actualSource, invoices: m.invoices.length, profit: m.profit,
    };
  });
  const total = (k: 'billed' | 'actual' | 'profit') => rows.reduce((n, r) => n + (r[k] ?? 0), 0);
  return json({ kind, month, rows, totals: { jobs: rows.length, billed: total('billed'), actual: total('actual'), profit: total('profit'),
    estimated: rows.filter(r => r.actualSource !== 'invoice').length, unknown: rows.filter(r => r.actual == null).length } });
};
