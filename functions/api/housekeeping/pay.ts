import { type Env, all, json, fail } from '../../_lib/db';
import { requireSession, isFieldRole, hasColumn } from '../../_lib/auth';
import { MYT_DATE } from '../../_lib/ops';
import { taskCleanersReady } from '../../_lib/taskCleaners';
import { hasCleanPrices, priceBook, layoutKey } from '../../_lib/cleaningPrices';
import { CLEAN_KINDS_SQL } from '../../_lib/cleaning';

/** GET /api/housekeeping/pay?month=YYYY-MM — each cleaner's pay for the cleans finished that month: on our units the
 *  internal cost of each clean (as charged, else the price table), on external jobs the job's amount. A job with several
 *  cleaners is split equally among them. Cleans with no price set are counted, not guessed. `units` is what each unit's
 *  owner is charged for its Basic and Deep cleans that month (any cleaner), with the unit's owner price as the rate. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Only the office sees cleaner pay.', 403);
  const month = new URL(request.url).searchParams.get('month') ?? new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return fail('VALIDATION', 'Pick a month.', 422, { month: 'YYYY-MM' });
  if (!(await hasCleanPrices(env))) return json({ month, ready: false, rows: [] });
  const ready = await taskCleanersReady(env);
  const layout = (await hasColumn(env, 'units', 'layout_type')) ? 'u.layout_type' : 'NULL::text';
  const jobs = await all<any>(env, `
    SELECT t.id, t.kind, t.unit_id, u.unit_number, p.name AS property_name, t.cleaner_pay, t.amount, t.cleaner_id, COALESCE(t.scheduled_for, t.due_at, t.created_at) AS day_at, u.bedrooms, ${layout} AS layout_type,
           ${ready ? '(SELECT json_agg(tc.cleaner_id)::text FROM task_cleaners tc WHERE tc.task_id = t.id AND tc.cleaner_id IS NOT NULL)' : 'NULL::text'} AS team
    FROM tasks t LEFT JOIN units u ON u.id = t.unit_id LEFT JOIN properties p ON p.id = u.property_id
    WHERE t.kind IN ${CLEAN_KINDS_SQL} AND t.state = 'resolved' AND t.completed_at IS NOT NULL AND substr(${MYT_DATE('t.completed_at')}, 1, 7) = ?`, month);
  const price = await priceBook(env, jobs.map(j => j.unit_id).filter(Boolean));
  const cleaners = await all<{ id: string; full_name: string }>(env, 'SELECT id, full_name FROM cleaners ORDER BY full_name');
  const by = new Map(cleaners.map(c => [c.id, { cleanerId: c.id, name: c.full_name, unitJobs: 0, externalJobs: 0, unitPay: 0, externalPay: 0, unpriced: 0 }]));
  const units = new Map<string, UnitCharge>();
  for (const j of jobs) {
    const kind = j.kind === 'turnover' ? 'basic' : j.kind === 'deep_clean' ? 'deep' : null;
    if (j.unit_id && kind) {
      const layoutOfUnit = layoutKey(j.layout_type, j.bedrooms);
      const charge: number | null = j.amount ?? price(j.unit_id, j.kind, layoutOfUnit, j.day_at).external;
      const unit = units.get(j.unit_id) ?? { unitId: j.unit_id, unitNumber: j.unit_number, propertyName: j.property_name, layout: layoutOfUnit, lastDay: j.day_at,
        basic: { jobs: 0, rate: null, amount: 0, unpriced: 0 }, deep: { jobs: 0, rate: null, amount: 0, unpriced: 0 } };
      if (new Date(j.day_at).getTime() > new Date(unit.lastDay).getTime()) unit.lastDay = j.day_at;
      unit[kind].jobs++;
      if (charge == null) unit[kind].unpriced++; else unit[kind].amount += Number(charge);
      units.set(j.unit_id, unit);
    }
    const team: string[] = (j.team ? JSON.parse(j.team) as string[] : []).filter(Boolean);
    if (!team.length && j.cleaner_id) team.push(j.cleaner_id);
    if (!team.length) continue;
    const ext = !j.unit_id;
    const pay: number | null = ext ? (j.cleaner_pay ?? j.amount) : (j.cleaner_pay ?? price(j.unit_id, j.kind, layoutKey(j.layout_type, j.bedrooms), j.day_at).internal);
    for (const id of team) {
      const row = by.get(id);
      if (!row) continue;
      if (ext) row.externalJobs++; else row.unitJobs++;
      if (pay == null) { row.unpriced++; continue; }
      const share = Math.round(Number(pay) / team.length);
      if (ext) row.externalPay += share; else row.unitPay += share;
    }
  }
  const rows = [...by.values()].filter(r => r.unitJobs || r.externalJobs).map(r => ({ ...r, total: r.unitPay + r.externalPay }));
  const unitRows = [...units.values()].map(({ layout, lastDay, ...u }) => ({
    ...u,
    basic: { ...u.basic, rate: price(u.unitId, 'turnover', layout, lastDay).external },
    deep: { ...u.deep, rate: price(u.unitId, 'deep_clean', layout, lastDay).external },
    total: u.basic.amount + u.deep.amount,
  })).sort((a, b) => `${a.propertyName} ${a.unitNumber}`.localeCompare(`${b.propertyName} ${b.unitNumber}`));
  return json({ month, ready: true, rows, units: unitRows });
};

interface KindCharge { jobs: number; rate: number | null; amount: number; unpriced: number }
interface UnitCharge { unitId: string; unitNumber: string; propertyName: string; layout: string; lastDay: string; basic: KindCharge; deep: KindCharge }
