import { type Env, one, all, run, json, fail, audit, nowIso } from './db';
import type { Session } from './auth';
import { notify } from './notify';
import { cleaningNotice } from './notices';

export const MYT_DATE = (col: string) => `to_char((${col})::timestamptz AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD')`;

/** The cleaner's short code the cleaning workbook recorded ("Cleaner: YJ · ..."), for imported cleans with no roster cleaner. */
export const SHEET_CLEANER = (alias: string) => `NULLIF(btrim(substring(${alias}.instructions from '^Cleaner: ([^·]+)')), '')`;

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
  // The crew list follows: the roster cleaner behind this login replaces it, or the crew empties if there is none.
  const rostered = await one<{ id: string }>(env, 'SELECT id FROM cleaners WHERE user_id = ?', assigneeId);
  await run(env, 'DELETE FROM task_cleaners WHERE task_id = ?', taskId);
  if (rostered) await run(env, 'INSERT INTO task_cleaners (task_id, cleaner_id, assigned_at, assigned_by) VALUES (?, ?, ?, ?)', taskId, rostered.id, nowIso(), session.userId);
  await run(env, 'UPDATE tasks SET cleaner_id = ? WHERE id = ?', rostered?.id ?? null, taskId);
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
  await cleaningNotice(env, taskId, 'assigned', session.userId);
  return json({ ok: true, assigneeName: assignee.full_name, notified: delivery.state });
}

export interface RosterCleaner { id: string; full_name: string; employment_type: 'internal' | 'outsourced'; user_id: string | null; phone: string | null; busy: number }

/** The active cleaner roster with today's open-job load, for the assign pickers and
 *  auto-assign. `prefer` narrows to one employment dimension when the rule asks for it. */
export async function activeCleaners(env: Env, prefer: 'internal' | 'outsourced' | 'any' = 'any'): Promise<RosterCleaner[]> {
  return all<RosterCleaner>(env, `
    SELECT c.id, c.full_name, c.employment_type, c.user_id, c.phone,
           (SELECT COUNT(*) FROM tasks t
              WHERE (t.cleaner_id = c.id OR (c.user_id IS NOT NULL AND t.assignee_id = c.user_id))
                AND t.state NOT IN ('resolved')
                AND ${MYT_DATE('COALESCE(t.scheduled_for, t.due_at, t.created_at)')} = to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD')) AS busy
    FROM cleaners c
    WHERE c.is_active = 1 ${prefer === 'any' ? '' : 'AND c.employment_type = ?'}
    ORDER BY c.full_name`, ...(prefer === 'any' ? [] : [prefer]));
}

/** Assign one clean to a roster cleaner. Sets cleaner_id always, and assignee_id to
 *  the cleaner's login when it is internal staff (outsourced crews have no login, so
 *  assignee_id is cleared). Overlapping work is a 409 ASSIGNEE_BUSY unless force. */
/** `quiet`: a bulk assignment sends one notice per cleaner afterwards instead of one per clean. */
export async function assignCleaner(env: Env, session: Session, taskId: string, cleaner: RosterCleaner, force: boolean, quiet = false): Promise<Response> {
  const task = await one<any>(env, 'SELECT id, state, cleaner_id, assignee_id, due_at, unit_id FROM tasks WHERE id = ?', taskId);
  if (!task) return fail('NOT_FOUND', 'That task no longer exists. Refresh the list.', 404);
  if (task.state === 'resolved') return fail('CONFLICT', 'That task is already finished.', 409);

  if (!force && task.due_at) {
    const clash = await all<{ id: string }>(env, `
      SELECT t.id FROM tasks t
      WHERE t.id != ? AND t.state NOT IN ('resolved') AND t.due_at IS NOT NULL
        AND (t.cleaner_id = ? OR (?::text IS NOT NULL AND t.assignee_id = ?))
        AND abs(extract(epoch from (t.due_at::timestamptz - ?::timestamptz))) < 5400`,
      taskId, cleaner.id, cleaner.user_id, cleaner.user_id, task.due_at);
    if (clash.length) {
      return json({
        error: { code: 'ASSIGNEE_BUSY', message: `${cleaner.full_name} has ${clash.length} overlapping ${clash.length === 1 ? 'task' : 'tasks'} around that time. Assign anyway?` },
        conflicts: clash,
      }, 409);
    }
  }

  // One cleaner given: they become the job's whole crew, as the single-cleaner screens always meant.
  return setCleaners(env, session, taskId, [cleaner], 'replace', quiet);
}

/** The cleaners on a cleaning job, as a JSON array [{id, name}] in the order they were added. */
export const TASK_CLEANERS_JSON = (alias: string) => `COALESCE((SELECT json_agg(json_build_object('id', c.id, 'name', c.full_name) ORDER BY tc.assigned_at, c.full_name)
  FROM task_cleaners tc JOIN cleaners c ON c.id = tc.cleaner_id WHERE tc.task_id = ${alias}.id), '[]'::json)`;

/** SQL: the signed-in person is on this job (its assignee, or the login behind any of its cleaners). Takes the user id twice. */
export const ON_TASK_SQL = (alias: string) => `(${alias}.assignee_id = ? OR EXISTS (SELECT 1 FROM task_cleaners tc JOIN cleaners c ON c.id = tc.cleaner_id WHERE tc.task_id = ${alias}.id AND c.user_id = ?))`;

/** Whether this person is on the job: its assignee, or the login of any cleaner on it. */
export async function onTask(env: Env, taskId: string, userId: string): Promise<boolean> {
  const r = await one<{ ok: number }>(env, `SELECT 1 AS ok FROM tasks t WHERE t.id = ? AND ${ON_TASK_SQL('t')}`, taskId, userId, userId);
  return !!r;
}

/**
 * Put cleaners on a cleaning job: `replace` makes them the whole crew (an empty list takes everyone off), `add` keeps
 * whoever is on it. tasks.cleaner_id and assignee_id follow the crew (first cleaner, first cleaner with a login) so
 * everything that reads the single columns keeps working. Audited with the crew before and after; each newly added
 * internal cleaner with a phone gets a push unless `quiet`.
 */
export async function setCleaners(env: Env, session: Session, taskId: string, cleaners: RosterCleaner[], mode: 'replace' | 'add', quiet = false): Promise<Response> {
  const task = await one<any>(env, 'SELECT id, state, cleaner_id, assignee_id, due_at, unit_id FROM tasks WHERE id = ?', taskId);
  if (!task) return fail('NOT_FOUND', 'That cleaning job no longer exists. Refresh the list.', 404);
  if (task.state === 'resolved') return fail('CONFLICT', 'That cleaning job is already finished.', 409);
  const before = await all<{ cleaner_id: string; full_name: string }>(env, `
    SELECT tc.cleaner_id, c.full_name FROM task_cleaners tc JOIN cleaners c ON c.id = tc.cleaner_id WHERE tc.task_id = ? ORDER BY tc.assigned_at, c.full_name`, taskId);
  const had = new Set(before.map(b => b.cleaner_id));
  const want = new Set(cleaners.map(c => c.id));
  const now = nowIso();
  if (mode === 'replace') {
    const gone = before.filter(b => !want.has(b.cleaner_id)).map(b => b.cleaner_id);
    if (gone.length) await run(env, `DELETE FROM task_cleaners WHERE task_id = ? AND cleaner_id IN (${gone.map(() => '?').join(',')})`, taskId, ...gone);
  }
  const added = cleaners.filter(c => !had.has(c.id));
  for (const c of added) {
    await run(env, 'INSERT INTO task_cleaners (task_id, cleaner_id, assigned_at, assigned_by) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING', taskId, c.id, now, session.userId);
  }
  const crewNow = await all<{ id: string; full_name: string; user_id: string | null }>(env, `
    SELECT c.id, c.full_name, c.user_id FROM task_cleaners tc JOIN cleaners c ON c.id = tc.cleaner_id WHERE tc.task_id = ? ORDER BY tc.assigned_at, c.full_name`, taskId);
  const first = crewNow[0] ?? null;
  const login = crewNow.find(c => c.user_id)?.user_id ?? null;
  const state = crewNow.length ? (['open', 'reopened'].includes(task.state) ? 'assigned' : task.state) : (task.state === 'assigned' ? 'open' : task.state);
  await run(env, 'UPDATE tasks SET cleaner_id = ?, assignee_id = ?, state = ?, updated_at = ? WHERE id = ?', first?.id ?? null, login, state, now, taskId);
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'task.cleaners', entityTable: 'tasks', entityId: taskId,
    before: { cleaners: before.map(b => b.full_name).join(', ') || null, state: task.state },
    after: { cleaners: crewNow.map(c => c.full_name).join(', ') || null, state },
  });
  if (added.length) {
    const unit = await one<{ unit_number: string; property_name: string }>(env, `
      SELECT u.unit_number, p.name AS property_name FROM units u JOIN properties p ON p.id = u.property_id WHERE u.id = ?`, task.unit_id);
    for (const c of added) {
      if (quiet || c.employment_type !== 'internal' || !c.phone) continue;
      await notify(env, {
        template: 'field.task_assigned', recipient: c.phone, channel: 'push',
        body: `New cleaning job: ${unit?.property_name} ${unit?.unit_number}${task.due_at ? `, due ${hhmm(task.due_at)}` : ''}.`,
        entityTable: 'tasks', entityId: taskId, urgent: true,
      });
    }
    if (!quiet) await cleaningNotice(env, taskId, 'assigned', session.userId);
  }
  return json({ ok: true, cleaners: crewNow.map(c => ({ id: c.id, name: c.full_name })), assigneeName: crewNow.map(c => c.full_name).join(', ') });
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

/** The last `count` calendar months ending with the month of `today` (YYYY-MM-DD), oldest first, as YYYY-MM. */
export function monthsBack(today: string, count: number): string[] {
  const [y, m] = today.split('-').map(Number);
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

export const daysIn = (period: string) => { const [y, m] = period.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };

export const todayMyt = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
