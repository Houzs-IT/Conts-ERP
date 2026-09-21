import { type Env, one, all, run, json, fail, audit, nowIso } from './db';
import type { Session } from './auth';
import { notify } from './notify';

export const MYT_DATE = (col: string) => `to_char((${col})::timestamptz AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD')`;

/** HH:MM in Malaysia time, or null. */
export function hhmm(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kuala_Lumpur' });
}

const fmtMin = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} m` : ''}`);

export type Sla = { state: 'on_track' | 'due' | 'overdue' | 'escalated' | 'none'; minutes: number; label: string; tone: 'success' | 'warning' | 'critical' | 'info' | 'neutral' };

/** Computed on the server so the label ages with the clock and the client never guesses. */
export function slaFor(state: string, dueAt: string | null): Sla {
  if (state === 'resolved') return { state: 'none', minutes: 0, label: 'Done', tone: 'success' };
  if (!dueAt) return { state: 'none', minutes: 0, label: 'No deadline', tone: 'neutral' };
  const minutes = Math.round((Date.parse(dueAt) - Date.now()) / 60000);
  if (minutes < -60 || state === 'overdue') return { state: 'escalated', minutes, label: `Overdue ${fmtMin(Math.abs(minutes))}`, tone: 'critical' };
  if (minutes < 0) return { state: 'overdue', minutes, label: `Overdue ${fmtMin(-minutes)}`, tone: 'critical' };
  if (minutes < 120) return { state: 'due', minutes, label: `Due in ${fmtMin(minutes)}`, tone: 'warning' };
  return { state: 'on_track', minutes, label: 'On track', tone: 'success' };
}

export const linenSet = (bedrooms: number) => (bedrooms >= 2 ? 'Set B' : 'Set A');

/** People who can be given field work, with how many open jobs they already hold today. */
export async function crew(env: Env, scope: 'housekeeping' | 'all') {
  const roles = scope === 'all' ? ['housekeeper', 'technician', 'operations_staff'] : ['housekeeper'];
  return all<{ id: string; name: string; busy: number }>(env, `
    SELECT u.id, u.full_name AS name,
           (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = u.id AND t.state NOT IN ('resolved')
              AND ${MYT_DATE('COALESCE(t.scheduled_for, t.due_at, t.created_at)')} = to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD')) AS busy
    FROM users u WHERE u.is_active = 1 AND u.role IN (${roles.map(() => '?').join(',')}) ORDER BY u.full_name`, ...roles);
}

/** Assign one task. Overlapping work is a warning (409 ASSIGNEE_BUSY) unless force. */
export async function assignTask(env: Env, session: Session, taskId: string, assigneeId: string, force: boolean): Promise<Response> {
  const task = await one<any>(env, 'SELECT id, state, assignee_id, due_at, unit_id FROM tasks WHERE id = ?', taskId);
  if (!task) return fail('NOT_FOUND', 'That task no longer exists. Refresh the list.', 404);
  if (task.state === 'resolved') return fail('CONFLICT', 'That task is already finished.', 409);

  const assignee = await one<{ id: string; full_name: string; phone: string | null }>(env,
    'SELECT id, full_name, phone FROM users WHERE id = ? AND is_active = 1', assigneeId);
  if (!assignee) return fail('NOT_FOUND', 'That person is no longer active.', 404);

  if (!force && task.due_at) {
    const clash = await all<{ id: string }>(env, `
      SELECT id FROM tasks
      WHERE assignee_id = ? AND id != ? AND state NOT IN ('resolved') AND due_at IS NOT NULL
        AND abs(extract(epoch from (due_at::timestamptz - ?::timestamptz))) < 5400`, assigneeId, taskId, task.due_at);
    if (clash.length) {
      return json({
        error: { code: 'ASSIGNEE_BUSY', message: `${assignee.full_name} has ${clash.length} overlapping ${clash.length === 1 ? 'task' : 'tasks'} around that time. Assign anyway?` },
        conflicts: clash,
      }, 409);
    }
  }

  await run(env, "UPDATE tasks SET assignee_id = ?, state = 'assigned', updated_at = ? WHERE id = ?", assigneeId, nowIso(), taskId);
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'task.assign', entityTable: 'tasks', entityId: taskId,
    before: { assigneeId: task.assignee_id, state: task.state }, after: { assigneeId, state: 'assigned' },
  });
  const unit = await one<{ unit_number: string; property_name: string }>(env, `
    SELECT u.unit_number, p.name AS property_name FROM units u JOIN properties p ON p.id = u.property_id WHERE u.id = ?`, task.unit_id);
  const delivery = await notify(env, {
    template: 'field.task_assigned', recipient: assignee.phone ?? assignee.full_name, channel: 'push',
    body: `New job: ${unit?.property_name} ${unit?.unit_number}${task.due_at ? `, due ${hhmm(task.due_at)}` : ''}.`,
    entityTable: 'tasks', entityId: taskId, urgent: true,
  });
  return json({ ok: true, assigneeName: assignee.full_name, notified: delivery.state });
}

/** A unit given as an id or as its display number (the screens send either). Property name narrows a number shared by two buildings. */
export async function resolveUnit(env: Env, ref: unknown, propertyName?: unknown): Promise<{ id: string } | 'ambiguous' | null> {
  const r = String(ref ?? '').trim();
  if (!r) return null;
  const byId = await one<{ id: string }>(env, 'SELECT id FROM units WHERE id = ?', r);
  if (byId) return byId;
  const prop = String(propertyName ?? '').trim().replace(/[%_]/g, m => '\\' + m);
  const rows = await all<{ id: string }>(env, `
    SELECT u.id FROM units u JOIN properties p ON p.id = u.property_id
    WHERE lower(u.unit_number) = lower(?) AND (? = '' OR lower(p.name) LIKE lower(?))`, r, prop, `${prop}%`);
  return rows.length === 1 ? rows[0] : rows.length > 1 ? 'ambiguous' : null;
}

/** Short display date, e.g. "14 Sep", in Malaysia time. */
export function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Kuala_Lumpur' });
}

/** A short human reference for a record id, e.g. INS-3F9A21. Ids themselves stay opaque. */
export const refOf = (prefix: string, id: string) => `${prefix}-${id.replace(/[^A-Za-z0-9]/g, '').slice(-6).toUpperCase()}`;

/** "15 Sep 16:10" in Malaysia time. */
export function stampMyt(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Kuala_Lumpur' });
  return `${date} ${hhmm(iso)}`;
}
