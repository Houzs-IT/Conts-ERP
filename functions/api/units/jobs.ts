import { type Env, all, one, json, fail } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { taskCleanersReady, cleanerListSql, parseCleaners, rosterIdSql } from '../../_lib/taskCleaners';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** A clean in the words of the Cleaning board (STATUS_VOCAB.cleaning). */
function cleaningStatus(t: { state: string }, cleaners: number) {
  if (t.state === 'resolved') return 'done';
  if (t.state === 'in_progress') return 'cleaning';
  return cleaners ? 'waiting' : 'unassigned';
}
/** A repair in the words of the Maintenance screen (STATUS_VOCAB.maintenance, MaintenancePage statusOf). */
function repairStatus(m: any) {
  if (m.state === 'resolved') return 'done';
  if (m.owner_approval_required && !m.owner_approved_at && m.charge_to === 'owner') return 'awaiting_owner';
  if (m.state === 'in_progress' || m.started_at) return m.ended_at ? 'repair_finished' : 'in_progress';
  return m.vendor_name ? 'assigned' : 'new';
}

/**
 * GET /api/units/jobs?unitId=&from=&to= — every cleaning job and maintenance job on the unit for the unit record's
 * Jobs tab, not just the latest few the record carries. from/to (YYYY-MM-DD, Malaysian days) keep the jobs dated in
 * the range: a clean by its due (or done) day, a repair by the day it was reported. Without a range: everything.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const url = new URL(request.url);
  const unitId = url.searchParams.get('unitId');
  if (!unitId) return fail('VALIDATION', 'A unit is required.', 422);
  const from = url.searchParams.get('from') || null, to = url.searchParams.get('to') || null;
  if ((from && !ISO.test(from)) || (to && !ISO.test(to))) return fail('VALIDATION', 'Dates are YYYY-MM-DD.', 422);
  if (from && to && to < from) return fail('VALIDATION', 'The end date is before the start date.', 422, { to: 'Pick a later date.' });

  const unit = await one<{ owner_id: string }>(env, 'SELECT owner_id FROM units WHERE id = ?', unitId);
  if (!unit) return fail('NOT_FOUND', 'That unit no longer exists.', 404);
  if (session.role === 'owner') {
    const owned = await one<{ n: number }>(env, 'SELECT COUNT(*) AS n FROM owners WHERE id = ? AND user_id = ?', unit.owner_id, session.userId);
    if (!owned?.n) return fail('FORBIDDEN', 'This unit is not on your account.', 403);
  }
  const money = session.manage;
  const myt = (col: string) => `to_char((${col})::timestamptz AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD')`;
  const range = (col: string) => `${from ? ` AND ${myt(col)} >= ?` : ''}${to ? ` AND ${myt(col)} <= ?` : ''}`;
  const dates = [...(from ? [from] : []), ...(to ? [to] : [])];
  const ready = await taskCleanersReady(env);

  const [tasks, repairs] = await Promise.all([
    all<any>(env, `
      SELECT t.id, t.title, t.kind, t.state, t.assignee_id, t.due_at, t.completed_at, COALESCE(cl.full_name, a.full_name, '') AS assignee_name,
             ${cleanerListSql(ready)} AS cleaner_list, ${rosterIdSql()} AS roster_id,
             ${myt('COALESCE(t.completed_at, t.due_at, t.created_at)')} AS day
      FROM tasks t LEFT JOIN users a ON a.id = t.assignee_id LEFT JOIN cleaners cl ON cl.id = t.cleaner_id
      WHERE t.unit_id = ? AND t.kind <> 'maintenance'${range('COALESCE(t.completed_at, t.due_at, t.created_at)')}
      ORDER BY COALESCE(t.due_at, t.completed_at, t.created_at) DESC`, unitId, ...dates),
    all<any>(env, `
      SELECT id, title, detail, state, vendor_name, quoted_amount, final_amount, owner_approval_required, owner_approved_at,
             blocks_unit, charge_to, started_at, ended_at, reported_at, resolved_at
      FROM maintenance_issues WHERE unit_id = ?${range('reported_at')}
      ORDER BY reported_at DESC`, unitId, ...dates),
  ]);

  return json({
    generatedAt: new Date().toISOString(), from, to,
    cleaning: tasks.map(t => {
      // Every cleaner on the job (migration 0122), not only the first one the old columns name.
      const cleaners = parseCleaners(t.cleaner_list, { cleanerId: t.roster_id, userId: t.assignee_id, name: t.assignee_name || null });
      return {
        id: t.id, title: t.title, kind: t.kind, state: t.state, status: cleaningStatus(t, cleaners.length),
        // The day the clean is for (done day once finished), so a row always carries a date.
        day: t.day, dueAt: t.due_at, completedAt: t.completed_at,
        assigneeName: cleaners.map(c => c.name).filter(Boolean).join(', ') || null, cleaners: cleaners.map(c => c.name),
      };
    }),
    maintenance: repairs.map(m => ({
      id: m.id, title: m.title, detail: m.detail, state: m.state, status: repairStatus(m),
      vendorName: m.vendor_name, blocksUnit: !!m.blocks_unit, chargeTo: m.charge_to,
      reportedAt: m.reported_at, resolvedAt: m.resolved_at,
      ...(money ? { quotedAmount: m.quoted_amount, finalAmount: m.final_amount } : {}),
    })),
  });
};
