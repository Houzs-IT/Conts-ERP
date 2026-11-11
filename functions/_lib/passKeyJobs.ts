import { type Env, all, one, run, nowIso, mytToday } from './db';
import { hasColumn } from './auth';
import { LIVE_STAY_SQL } from './cleaning';
import { rentalOnly } from './unitPurpose';
import { repairNotice } from './notices';
import { MYT_DAY } from './maintenance';

export type PassKeyScope = { from: string; to: string } | { reservationIds: string[] };

interface ScopeFilter { sql: string; args: unknown[] }

const CHECK_IN_AT = `r.check_in || 'T' || COALESCE(NULLIF(r.check_in_time, ''), '15:00') || ':00+08:00'`;
const WINDOW_END = `to_char(((${CHECK_IN_AT})::timestamptz + interval '1 hour') AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD"T"HH24:MI":00+08:00"')`;
const WINDOW_NOTE = 'Guest check-in';
const AUTO_JOB = `m.source = 'booking' AND m.job_type = 'pass_key'`;
const UNTOUCHED = `m.state = 'open' AND (m.vendor_name IS NULL OR trim(m.vendor_name) = '') AND m.started_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.maintenance_id = m.id)`;
const CHECK_IN_SOON = `m.due_on BETWEEN ${MYT_DAY(0)} AND ${MYT_DAY(1)}`;
const URGENCY_DUE = `CASE WHEN ${CHECK_IN_SOON} THEN 'urgent' ELSE 'normal' END`;
const URGENCY_STALE = `m.job_type = 'pass_key' AND m.state != 'resolved' AND m.due_on IS NOT NULL AND m.urgency IS DISTINCT FROM ${URGENCY_DUE}`;

export interface UrgencyChange { id: string; urgency: string }

export const passKeyUrgencyChanges = (env: Env): Promise<UrgencyChange[]> =>
  all<UrgencyChange>(env, `SELECT m.id, ${URGENCY_DUE} AS urgency FROM maintenance_issues m WHERE ${URGENCY_STALE}`);

export const applyPassKeyUrgency = (env: Env): Promise<UrgencyChange[]> =>
  all<UrgencyChange>(env, `
    UPDATE maintenance_issues m SET urgency = ${URGENCY_DUE}, updated_at = ?
    WHERE ${URGENCY_STALE}
    RETURNING m.id, m.urgency`, nowIso());

export const hasPassKeyJobs = (env: Env): Promise<boolean> => hasColumn(env, 'maintenance_issues', 'reservation_id').catch(() => false);

function scopeFilter(scope: PassKeyScope): ScopeFilter | null {
  if ('reservationIds' in scope) {
    const ids = scope.reservationIds.filter(Boolean);
    return ids.length ? { sql: 'r.id IN (SELECT jsonb_array_elements_text(?::text::jsonb))', args: [JSON.stringify(ids)] } : null;
  }
  return scope.to < scope.from ? null : { sql: 'r.check_in >= ? AND r.check_in <= ?', args: [scope.from, scope.to] };
}

async function logSystem(env: Env, action: string, rows: { id: string; reservation_id: string }[]): Promise<void> {
  if (!rows.length) return;
  await run(env, `
    INSERT INTO audit_log (actor_id, actor_label, action, entity_table, entity_id, after_state, source, occurred_at)
    SELECT NULL, 'System', ?, 'maintenance_issues', x->>'id', jsonb_build_object('reservationId', x->>'reservationId')::text, 'system', ?
    FROM jsonb_array_elements(?::text::jsonb) x`,
    action, nowIso(), JSON.stringify(rows.map(row => ({ id: row.id, reservationId: row.reservation_id }))));
}

async function noticeSameDay(env: Env, created: { id: string; due_on: string; starts_at: string }[]): Promise<void> {
  const today = mytToday();
  for (const { id, due_on: checkInDay, starts_at: checkInAt } of created) {
    if (checkInDay === today) await repairNotice(env, id, 'pass_key_today', null, `Check-in ${checkInAt.slice(11, 16)}`);
  }
}

export async function syncPassKeyJobs(env: Env, scope: PassKeyScope, limit = 200): Promise<number> {
  try {
    const filter = scopeFilter(scope);
    if (!filter || !(await hasPassKeyJobs(env))) return 0;
    const needsKey = `(${LIVE_STAY_SQL('r')} AND r.channel != 'owner_stay' AND r.self_check_in IS NOT TRUE
      AND p.needs_pass_key IS TRUE${await rentalOnly(env, 'u')})`;
    const stays = 'reservations r JOIN units u ON u.id = r.unit_id JOIN properties p ON p.id = u.property_id';
    const now = nowIso();

    const removed = await all<{ id: string; reservation_id: string }>(env, `
      DELETE FROM maintenance_issues m USING ${stays}
      WHERE m.reservation_id = r.id AND ${AUTO_JOB} AND ${filter.sql} AND ${UNTOUCHED} AND NOT ${needsKey}
      RETURNING m.id, m.reservation_id`, ...filter.args);
    await logSystem(env, 'maintenance.pass_key_removed', removed);

    await run(env, `
      UPDATE maintenance_issues m SET due_on = r.check_in, updated_at = ?
      FROM reservations r
      WHERE m.reservation_id = r.id AND ${AUTO_JOB} AND m.state != 'resolved' AND ${filter.sql}
        AND m.due_on IS DISTINCT FROM r.check_in`, now, ...filter.args);
    await run(env, `
      UPDATE maintenance_windows w SET starts_at = ${CHECK_IN_AT}, ends_at = ${WINDOW_END}
      FROM maintenance_issues m JOIN reservations r ON r.id = m.reservation_id
      WHERE w.issue_id = m.id AND w.created_by IS NULL AND w.note = ? AND ${AUTO_JOB} AND m.state != 'resolved'
        AND ${filter.sql} AND w.starts_at IS DISTINCT FROM ${CHECK_IN_AT}`, WINDOW_NOTE, ...filter.args);

    const created = await all<{ id: string; reservation_id: string; due_on: string; starts_at: string }>(env, `
      WITH picked AS (
        SELECT gen_random_uuid()::text AS issue_id, r.id AS reservation_id, r.unit_id, r.check_in,
               'Pass key: ' || COALESCE(NULLIF(trim(g.full_name), ''), 'guest') AS title,
               ${CHECK_IN_AT} AS starts_at, ${WINDOW_END} AS ends_at
        FROM ${stays} LEFT JOIN guests g ON g.id = r.guest_id
        WHERE ${filter.sql} AND ${needsKey} AND r.check_in >= ?
          AND NOT EXISTS (SELECT 1 FROM maintenance_issues x WHERE x.reservation_id = r.id AND x.job_type = 'pass_key')
        ORDER BY r.check_in, r.id
        LIMIT ${Math.max(1, Math.min(500, Math.floor(limit)))}
      ), made AS (
        INSERT INTO maintenance_issues (id, unit_id, reservation_id, state, title, category, urgency, source, job_type, severity, due_on,
                                        reported_at, created_at, updated_at)
        SELECT issue_id, unit_id, reservation_id, 'open', title, 'other', 'normal', 'booking', 'pass_key', 'minor', check_in, ?, ?, ?
        FROM picked
        ON CONFLICT DO NOTHING
        RETURNING id, reservation_id, due_on
      ), opened AS (
        INSERT INTO maintenance_windows (id, issue_id, starts_at, ends_at, note, created_by, created_at)
        SELECT gen_random_uuid()::text, made.id, picked.starts_at, picked.ends_at, ?, NULL, ?
        FROM made JOIN picked ON picked.issue_id = made.id
      )
      SELECT made.id, made.reservation_id, made.due_on, picked.starts_at FROM made JOIN picked ON picked.issue_id = made.id`, ...filter.args, mytToday(), now, now, now, WINDOW_NOTE, now);
    await logSystem(env, 'maintenance.pass_key_created', created);
    await applyPassKeyUrgency(env);
    await noticeSameDay(env, created);
    return created.length;
  } catch (error) {
    console.error('syncPassKeyJobs failed', error);
    return 0;
  }
}

export interface PassKeyStatus {
  buildingNeedsKey: boolean;
  selfCheckIn: boolean;
  jobId: string | null;
  jobState: string | null;
  technician: string | null;
}

interface PassKeyRow { needs_pass_key: boolean; self_check_in: boolean; job_id: string | null; job_state: string | null; vendor_name: string | null }

export async function passKeyFor(env: Env, reservationId: string): Promise<PassKeyStatus | null> {
  if (!(await hasPassKeyJobs(env))) return null;
  const row = await one<PassKeyRow>(env, `
    SELECT p.needs_pass_key, r.self_check_in, m.id AS job_id, m.state AS job_state, m.vendor_name
    FROM reservations r JOIN units u ON u.id = r.unit_id JOIN properties p ON p.id = u.property_id
    LEFT JOIN maintenance_issues m ON m.reservation_id = r.id AND m.job_type = 'pass_key'
    WHERE r.id = ?`, reservationId);
  if (!row) return null;
  const { needs_pass_key: buildingNeedsKey, self_check_in: selfCheckIn, job_id: jobId, job_state: jobState, vendor_name: technician } = row;
  return { buildingNeedsKey: buildingNeedsKey === true, selfCheckIn: selfCheckIn === true, jobId, jobState, technician: technician?.trim() || null };
}
