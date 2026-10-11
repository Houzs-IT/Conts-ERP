import { type Env, one, all, run, audit, nowIso } from './db';
import type { Session } from './auth';
import { findClash, clashResponseBody, withUnitLock } from './reservations';
import { channexConfigured } from './channex';
import { channexMappingFor, syncAvailabilityIfLinked } from './channexSync';
import { bookingNotice } from './notices';

/**
 * Booking status: which moves are allowed, who may make them, and what each one does.
 * The PATCH status endpoint and the cancel endpoint both go through applyMove, and the
 * drawer's status menu is built from movesFor, so the screen and the server never disagree.
 */

export const STATES = ['inquiry', 'pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show'] as const;
export type State = typeof STATES[number];

const LABEL: Record<State, string> = {
  inquiry: 'Inquiry', pending: 'Pending', confirmed: 'Upcoming', checked_in: 'Currently hosting',
  checked_out: 'Past', cancelled: 'Cancelled', no_show: 'No-show',
};
const BLOCK_CHANNELS = ['maintenance_block', 'owner_stay'];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 30 Dec 2026, for messages. */
export const dayLabel = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};
/** The Kuala Lumpur calendar day of an instant (or of now). */
export const mytDay = (iso?: string) => new Date((iso ? Date.parse(iso) : Date.now()) + 8 * 3600e3).toISOString().slice(0, 10);

export interface MoveContext {
  channel: string; checkIn: string; checkOut: string; today: string;
  /** Management-level user for this area (session.manage). */
  manage: boolean;
  /** Kuala Lumpur day the booking entered its current state, from the audit trail; null if unknown. */
  enteredOn: string | null;
}

export interface Move {
  to: State;
  /** What the menu says: "Check in", "Undo check-out", ... */
  label: string;
  /** One line on what happens. */
  hint: string;
  allowed: boolean;
  /** Why it cannot be done right now, when allowed is false. */
  reason?: string;
  /** Cancelled and No show need a reason and a confirm step. */
  needsReason?: boolean;
}

/** Every move the drawer may show from this state, allowed or not (with the reason). */
export function movesFor(from: State, c: MoveContext): Move[] {
  if (BLOCK_CHANNELS.includes(c.channel)) return [];
  const started = c.today >= c.checkIn;
  const ended = c.today >= c.checkOut;
  const sameDay = c.enteredOn === c.today;
  const mgmtOnly = 'Only management can do this.';
  const cancel: Move = { to: 'cancelled', label: 'Cancel reservation', hint: 'Makes the dates available again.', allowed: true, needsReason: true };
  const confirm: Move = { to: 'confirmed', label: 'Confirm', hint: 'Holds the dates.', allowed: true };

  switch (from) {
    case 'inquiry':
      return [{ to: 'pending', label: 'Mark pending', hint: 'Waiting for payment or confirmation; holds the dates.', allowed: true }, confirm, cancel];
    case 'pending':
      return [confirm, cancel];
    case 'confirmed':
      return [
        {
          to: 'checked_in', label: 'Check in', hint: 'Guest has arrived. Unit is marked occupied.',
          allowed: started && !ended,
          reason: !started ? `Check-in opens on ${dayLabel(c.checkIn)}.` : ended ? `Checkout was on ${dayLabel(c.checkOut)}.` : undefined,
        },
        {
          to: 'no_show', label: 'Mark no-show', hint: 'Guest never arrived. Releases the remaining dates.',
          allowed: started, reason: started ? undefined : `A no-show can be marked from ${dayLabel(c.checkIn)}.`, needsReason: true,
        },
        cancel,
      ];
    case 'checked_in':
      return [
        { to: 'checked_out', label: 'Check out', hint: 'Guest has left. Unit is marked dirty and a cleaning job is created.', allowed: true },
        {
          to: 'confirmed', label: 'Undo check-in', hint: 'Back to Upcoming. Unit goes back to ready.',
          allowed: c.manage && sameDay, reason: !c.manage ? mgmtOnly : !sameDay ? 'Only on the day of the check-in.' : undefined,
        },
      ];
    case 'checked_out':
      return [{
        to: 'checked_in', label: 'Undo checkout', hint: 'Back to Currently hosting. Removes the cleaning job if nobody has started it.',
        allowed: c.manage && sameDay, reason: !c.manage ? mgmtOnly : !sameDay ? 'Only on the day of the checkout.' : undefined,
      }];
    case 'cancelled':
    case 'no_show':
      return [{
        to: 'confirmed', label: 'Reinstate reservation', hint: 'Back to Upcoming. Holds the dates again if they are still free.',
        allowed: c.manage && !ended, reason: !c.manage ? mgmtOnly : ended ? 'The reservation dates have already passed.' : undefined,
      }];
  }
}

/** The day the booking entered its current state, from its last status entry in the audit trail. */
export async function enteredOn(env: Env, id: string, state: string): Promise<string | null> {
  const row = await one<{ occurred_at: string }>(env, `
    SELECT occurred_at FROM audit_log
    WHERE entity_table = 'reservations' AND entity_id = ? AND action IN ('reservation.status', 'reservation.cancel')
      AND after_state LIKE ?
    ORDER BY occurred_at DESC LIMIT 1`, id, `%"state":"${state}"%`);
  return row ? mytDay(row.occurred_at) : null;
}

export type ChannelSync = 'queued' | 'not_linked' | 'failed';

/** Opens or closes the stay's nights on the channels, if the unit is linked. Never throws. */
async function channelAvailability(env: Env, unitId: string, from: string, to: string, available: boolean): Promise<ChannelSync> {
  try {
    if (!channexConfigured(env) || !(await channexMappingFor(env, unitId))) return 'not_linked';
    await syncAvailabilityIfLinked(env, unitId, from, to, available);
    return 'queued';
  } catch {
    return 'failed';
  }
}

export interface MoveResult {
  id: string; state: State;
  /** What actually happened, so the screen can say it and nothing more. */
  effects: {
    channel: ChannelSync | null;
    readiness: string | null;
    turnoverCreated: boolean;
    tasksRemoved: number;
    /** Tasks left in place because someone already picked them up. */
    tasksKept: number;
  };
}

type Refusal = { status: number; body: unknown };
const refuse = (status: number, code: string, message: string): Refusal => ({ status, body: { error: { code, message } } });

/** Moves one booking to `to`, enforcing the map above, and applies the side effects of that move. */
export async function applyMove(env: Env, session: Session & { manage?: boolean }, id: string, to: string, reason: string | null): Promise<MoveResult | Refusal> {
  if (!(STATES as readonly string[]).includes(to)) return refuse(422, 'VALIDATION', 'Pick a valid status.');
  const cur = await one<{ id: string; unit_id: string; state: State; channel: string; check_in: string; check_out: string }>(env,
    'SELECT id, unit_id, state, channel, check_in, check_out FROM reservations WHERE id = ?', id);
  if (!cur) return refuse(404, 'NOT_FOUND', 'That reservation does not exist.');

  const target = to as State;
  const noEffects = { channel: null, readiness: null, turnoverCreated: false, tasksRemoved: 0, tasksKept: 0 };
  if (cur.state === target) return { id, state: target, effects: noEffects };

  const isBlock = BLOCK_CHANNELS.includes(cur.channel);
  // A block or owner stay has no guest lifecycle: it is either held or removed.
  if (isBlock && !(cur.state === 'confirmed' && target === 'cancelled')) {
    return refuse(409, 'ILLEGAL_TRANSITION', 'A block has no status. Remove the block or change its dates instead.');
  }
  if (!isBlock) {
    const ctx: MoveContext = {
      channel: cur.channel, checkIn: cur.check_in, checkOut: cur.check_out, today: mytDay(),
      manage: !!session.manage, enteredOn: await enteredOn(env, id, cur.state),
    };
    const move = movesFor(cur.state, ctx).find(m => m.to === target);
    if (!move) return refuse(409, 'ILLEGAL_TRANSITION', `A reservation that is ${LABEL[cur.state]} cannot be moved to ${LABEL[target]}.`);
    if (!move.allowed) return refuse(409, 'ILLEGAL_TRANSITION', move.reason ?? 'That move is not allowed right now.');
  }
  const why = reason?.trim().slice(0, 300) || null;
  if ((target === 'cancelled' || target === 'no_show') && !why) {
    return refuse(422, 'VALIDATION', target === 'cancelled' ? 'Give a reason for the cancellation.' : 'Give a reason for the no-show.');
  }
  const now = nowIso();
  // Written only if the booking is still in the state read above: two people (or a double click) moving the same booking
  // at once used to both pass and both apply their side effects. A reinstated stay takes its nights back, so it is
  // checked and written under the unit's lock (withUnitLock).
  const reinstate = target === 'confirmed' && (cur.state === 'cancelled' || cur.state === 'no_show');
  const write = async (tx: Env) => {
    if (reinstate) {
      const clash = await findClash(tx, cur.unit_id, cur.check_in, cur.check_out, id);
      if (clash) return { status: 409, body: clashResponseBody(clash) } as Refusal;
    }
    const row = await one(tx, 'UPDATE reservations SET state = ?, updated_at = ? WHERE id = ? AND state = ? RETURNING id', target, now, id, cur.state);
    return row ? null : refuse(409, 'CONFLICT', 'This reservation changed while you were looking at it. Refresh and try again.');
  };
  const refused = reinstate ? await withUnitLock(env, cur.unit_id, write) : await write(env);
  if (refused) return refused;
  const effects: MoveResult['effects'] = { ...noEffects };

  // Side effects. Each is wrapped: the status change is already saved and must not be reported as failed.
  try {
    if (target === 'checked_in' && cur.state === 'confirmed') {
      await run(env, 'UPDATE units SET readiness = ?, updated_at = ? WHERE id = ?', 'occupied', now, cur.unit_id);
      effects.readiness = 'occupied';
    }
    if (target === 'confirmed' && cur.state === 'checked_in') {
      const u = await one(env, `UPDATE units SET readiness = 'ready', updated_at = ? WHERE id = ? AND readiness = 'occupied' RETURNING id`, now, cur.unit_id);
      if (u) effects.readiness = 'ready';
    }
    if (target === 'checked_out') {
      await run(env, 'UPDATE units SET readiness = ?, updated_at = ? WHERE id = ?', 'dirty', now, cur.unit_id);
      effects.readiness = 'dirty';
      const open = await one(env, `SELECT 1 AS x FROM tasks WHERE reservation_id = ? AND kind = 'turnover' AND state != 'resolved' AND title = 'Turnover after check-out'`, id);
      if (!open) {
        const taskId = crypto.randomUUID();
        await run(env, `
          INSERT INTO tasks (id, unit_id, reservation_id, kind, state, title, due_at, requires_photo, created_at, updated_at)
          VALUES (?, ?, ?, 'turnover', 'open', 'Turnover after check-out', ?, 1, ?, ?)`,
          taskId, cur.unit_id, id, now, now, now);
        await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'housekeeping.create', entityTable: 'tasks', entityId: taskId, after: { unitId: cur.unit_id, reservationId: id, kind: 'turnover', via: 'checked_out' } });
        effects.turnoverCreated = true;
      }
    }
    if (cur.state === 'checked_out' && target === 'checked_in') {
      // vocab-ok: stored task title, matched by the SQL above
      const r = await removeUntouchedTasks(env, session, id, 'Turnover after check-out');
      effects.tasksRemoved = r.removed; effects.tasksKept = r.kept;
      const u = await one(env, `UPDATE units SET readiness = 'occupied', updated_at = ? WHERE id = ? AND readiness = 'dirty' RETURNING id`, now, cur.unit_id);
      if (u) effects.readiness = 'occupied';
    }
    if (target === 'cancelled' || target === 'no_show') {
      // vocab-ok: stored task title, matched by title in SQL
      const r = await removeUntouchedTasks(env, session, id, 'Prepare for arrival');
      effects.tasksRemoved = r.removed; effects.tasksKept = r.kept;
    }
  } catch (e) {
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'reservation.side_effect_failed', entityTable: 'reservations', entityId: id, after: { to: target, error: e instanceof Error ? e.message : String(e) } }).catch(() => {});
  }

  // The nights a cancelled or no-show stay held go back on sale; a reinstated one is held again.
  // A no-show keeps the nights already past: only from today on can still be sold.
  if (target === 'cancelled' || target === 'no_show') {
    const from = target === 'no_show' ? (mytDay() > cur.check_in ? mytDay() : cur.check_in) : cur.check_in;
    effects.channel = from < cur.check_out ? await channelAvailability(env, cur.unit_id, from, cur.check_out, true) : null;
  } else if (target === 'confirmed' && (cur.state === 'cancelled' || cur.state === 'no_show')) {
    effects.channel = await channelAvailability(env, cur.unit_id, cur.check_in, cur.check_out, false);
  }

  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'reservation.status', entityTable: 'reservations', entityId: id,
    before: { state: cur.state }, after: { state: target, ...(why ? { reason: why } : {}), ...(effects.tasksRemoved ? { tasksRemoved: effects.tasksRemoved } : {}) },
  });
  if (target === 'cancelled' || target === 'no_show' || target === 'checked_out') await bookingNotice(env, id, target, session.userId);
  return { id, state: target, effects };
}

/** Removes this booking's open tasks of one title that nobody has picked up (no cleaner, not started, no photo).
 *  A task someone is already on is kept and counted, so the screen can say so. */
async function removeUntouchedTasks(env: Env, session: Session, reservationId: string, title: string) {
  const tasks = await all<{ id: string; state: string; assignee_id: string | null; started_at: string | null }>(env,
    `SELECT id, state, assignee_id, started_at FROM tasks WHERE reservation_id = ? AND title = ? AND state != 'resolved'`, reservationId, title);
  let removed = 0, kept = 0;
  for (const t of tasks) {
    const photo = await one(env, 'SELECT 1 AS x FROM documents WHERE task_id = ? LIMIT 1', t.id);
    if (t.state !== 'open' || t.assignee_id || t.started_at || photo) { kept++; continue; }
    await run(env, 'DELETE FROM tasks WHERE id = ?', t.id);
    // vocab-ok: reason stored in the audit trail, not a screen label
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'task.remove', entityTable: 'tasks', entityId: t.id, before: { reservationId, title, state: t.state }, after: { reason: 'booking status reverted' } });
    removed++;
  }
  return { removed, kept };
}

export const isRefusal = (r: MoveResult | Refusal): r is Refusal => 'status' in r && 'body' in r;
