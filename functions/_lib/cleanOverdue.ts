import { type Env, all } from './db';
import { CLEAN_KINDS_SQL, LIVE_STAY_SQL } from './cleaning';
import { MYT_DATE } from './ops';
import { nextCheckIn, isCleanOverdue } from '../../src/lib/cleanOverdue';

/* The server side of the one overdue rule for cleaning jobs (src/lib/cleanOverdue.ts, owner 2 Nov 2026): overdue only when
   still not done at the next guest's check-in, or, with no check-in that day, after midnight at the end of the job's day. */

/** The job's Malaysian day, as every cleaning screen reads it. */
export const CLEAN_DAY_SQL = (t: string) => MYT_DATE(`COALESCE(${t}.scheduled_for, ${t}.due_at, ${t}.created_at)`);

/** The check-in time of the guest arriving at the job's unit on the job's day (null: nobody arrives), the same stay the
 *  board shows: a live booking, not the one that checked out. */
export const NEXT_STAY_TIME_SQL = (t: string) => `(SELECT n.check_in_time FROM reservations n
  WHERE n.unit_id = ${t}.unit_id AND n.check_in = ${CLEAN_DAY_SQL(t)} AND ${LIVE_STAY_SQL('n')} AND n.state != 'checked_out'
    AND n.id IS DISTINCT FROM ${t}.reservation_id ORDER BY n.check_in_time LIMIT 1)`;

/** The standard check-in time (Settings > Operations), 15:00 when unset. */
export async function standardCheckIn(env: Env): Promise<string> {
  const rows = await all<{ key: string; value: string }>(env, `SELECT key, value FROM settings WHERE key IN ('operations.checkIn','ops.check_in')`);
  return rows.find(r => r.key === 'operations.checkIn')?.value ?? rows.find(r => r.key === 'ops.check_in')?.value ?? '15:00';
}

export interface OpenClean { id: string; state: string; kind: string; due_at: string | null; day: string; checkIn: string | null }

/** Open cleaning jobs on or before `today` that are overdue at `now` by the one rule. With `ids`, only those jobs. */
export async function overdueCleans(env: Env, now: number, opts: { ids?: string[] } = {}): Promise<OpenClean[]> {
  const today = new Date(now + 8 * 3600e3).toISOString().slice(0, 10);
  const std = await standardCheckIn(env);
  const rows = await all<{ id: string; state: string; kind: string; due_at: string | null; day: string; next_guest_at: string | null; stay_time: string | null }>(env, `
    SELECT t.id, t.state, t.kind, t.due_at, ${CLEAN_DAY_SQL('t')} AS day, t.next_guest_at, ${NEXT_STAY_TIME_SQL('t')} AS stay_time
    FROM tasks t
    WHERE t.kind IN ${CLEAN_KINDS_SQL} AND t.state != 'resolved' AND ${CLEAN_DAY_SQL('t')} <= ?
      ${opts.ids ? 'AND t.id IN (SELECT jsonb_array_elements_text(?::text::jsonb))' : ''}`, today, ...(opts.ids ? [JSON.stringify(opts.ids)] : []));
  return rows
    .map(r => ({ id: r.id, state: r.state, kind: r.kind, due_at: r.due_at, day: r.day, checkIn: nextCheckIn({ day: r.day, reservationTime: r.stay_time, taskNextGuestAt: r.next_guest_at, standard: std }) }))
    .filter(r => isCleanOverdue({ day: r.day, checkIn: r.checkIn, done: false }, now));
}
