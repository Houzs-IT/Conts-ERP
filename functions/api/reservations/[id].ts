import { type Env, one, all, json, fail } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { FROM, COLUMNS, toRow } from '../../_lib/bookingList';
import { applyMove, isRefusal, movesFor, enteredOn, mytDay, dayLabel, type State } from '../../_lib/bookingLifecycle';

/** Per-booking money columns added by migration 0052. Read only where they exist, so this works before and after it. */
const OPTIONAL_MONEY = {
  room_revenue: 'roomRevenue', guest_cleaning_fee: 'guestCleaningFee', extra_fees: 'extraFees', sst_amount: 'sstAmount',
  tourism_tax: 'tourismTax', ota_tax: 'otaTax', payment_processing_fee: 'paymentProcessingFee',
  deposit_collected: 'depositCollected', deposit_refunded: 'depositRefunded', payout_amount: 'payoutAmount',
  payout_date: 'payoutDate', payment_method: 'paymentMethod', rate_plan: 'ratePlan', guest_nationality: 'guestNationality',
} as const;
const TEXT_FIELDS = new Set(['payout_date', 'payment_method', 'rate_plan', 'guest_nationality']);

const CHANNEL_LABEL: Record<string, string> = {
  airbnb: 'Airbnb', booking_com: 'Booking.com', agoda: 'Agoda', direct: 'Direct', maintenance_block: 'Block', owner_stay: 'Owner stay',
};
const STATE_LABEL: Record<string, string> = {
  inquiry: 'Inquiry', pending: 'Pending', confirmed: 'Confirmed', checked_in: 'Checked in',
  checked_out: 'Checked out', cancelled: 'Cancelled', no_show: 'No show',
};

interface TimelineEvent { at: string; label: string; detail?: string; actor?: string; upcoming?: boolean }

const ringgit = (sen: number) => `RM ${(sen / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const parse = (s: string | null) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

/** One audit row in words. Rows the drawer has nothing to say about return null. */
function describe(a: { action: string; actor_label: string; before_state: string | null; after_state: string | null }): Omit<TimelineEvent, 'at'> | null {
  const before = parse(a.before_state) ?? {}, after = parse(a.after_state) ?? {};
  switch (a.action) {
    case 'reservation.create': return { label: 'Booking created', actor: a.actor_label };
    case 'reservation.duplicate': return { label: 'Created as a copy of another booking', actor: a.actor_label };
    case 'reservation.status':
    case 'reservation.cancel': {
      const to = STATE_LABEL[after.state] ?? after.state;
      const from = STATE_LABEL[before.state] ?? before.state;
      const label = after.state === 'cancelled' ? 'Cancelled' : after.state === 'no_show' ? 'Marked no-show'
        : after.state === 'checked_in' && before.state === 'checked_out' ? 'Check-out undone'
        : after.state === 'confirmed' && before.state === 'checked_in' ? 'Check-in undone'
        : after.state === 'confirmed' && (before.state === 'cancelled' || before.state === 'no_show') ? 'Reinstated'
        : after.state === 'checked_in' ? 'Checked in' : after.state === 'checked_out' ? 'Checked out'
        : `Status changed from ${from} to ${to}`;
      const bits = [after.reason && after.reason !== 'operator_cancelled' ? `Reason: ${after.reason}` : null,
        after.tasksRemoved ? `${after.tasksRemoved} unstarted ${after.tasksRemoved === 1 ? 'task' : 'tasks'} removed` : null].filter(Boolean);
      return { label, actor: a.actor_label, detail: bits.join(' · ') || undefined };
    }
    case 'reservation.dates':
      return {
        label: 'Dates changed', actor: a.actor_label,
        detail: [
          before.checkIn ? `${dayLabel(before.checkIn)} – ${dayLabel(before.checkOut)} to ${dayLabel(after.checkIn)} – ${dayLabel(after.checkOut)}` : null,
          after.grossBookingValue != null ? `Total ${ringgit(before.grossBookingValue ?? 0)} to ${ringgit(after.grossBookingValue)}` : null,
        ].filter(Boolean).join(' · ') || undefined,
      };
    case 'reservation.prepare': return { label: 'Arrival prepared', detail: 'A clean was queued for the unit', actor: a.actor_label };
    default: return null;
  }
}

/** GET /api/reservations/:id — one booking in the list's row shape, plus its real money lines, a timeline
 *  built only from what was recorded, and the status moves this user may make now. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Bookings are not available to field roles.', 403);
  const id = String(params.id);

  const present = await all<{ column_name: string }>(env, `
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'reservations' AND table_schema = ANY(current_schemas(false))
      AND column_name IN (${Object.keys(OPTIONAL_MONEY).map(c => `'${c}'`).join(', ')})`);
  const extra = present.map(c => c.column_name).filter(c => c in OPTIONAL_MONEY);
  const row = await one<any>(env, `SELECT ${COLUMNS}, r.unit_id, r.notes${extra.map(c => `, r.${c} AS x_${c}`).join('')} ${FROM} WHERE r.id = ?`, id);
  if (!row) return fail('NOT_FOUND', 'That reservation does not exist.', 404);

  const lines: Record<string, number | string | null> = {};
  for (const [col, key] of Object.entries(OPTIONAL_MONEY)) {
    const v = extra.includes(col) ? row[`x_${col}`] : null;
    lines[key] = v == null || v === '' ? null : v instanceof Date ? v.toISOString() : TEXT_FIELDS.has(col) ? String(v) : Number(v);
  }

  const [auditRows, messages, notices] = await Promise.all([
    all<any>(env, `SELECT action, actor_label, before_state, after_state, occurred_at FROM audit_log
      WHERE entity_table = 'reservations' AND entity_id = ? ORDER BY occurred_at LIMIT 100`, id),
    all<any>(env, `SELECT m.direction, m.sent_at, m.is_automated FROM messages m JOIN message_threads t ON t.id = m.thread_id
      WHERE t.reservation_id = ? ORDER BY m.sent_at LIMIT 50`, id),
    all<any>(env, `SELECT template, channel, state, queued_at, sent_at FROM notification_log
      WHERE entity_table = 'reservations' AND entity_id = ? ORDER BY queued_at LIMIT 50`, id),
  ]);

  const channel = CHANNEL_LABEL[row.channel] ?? row.channel;
  const timeline: TimelineEvent[] = [];
  if (!auditRows.some(a => a.action === 'reservation.create' || a.action === 'reservation.duplicate')) {
    timeline.push({ at: row.created_at, label: 'Booking recorded', detail: row.channel === 'maintenance_block' || row.channel === 'owner_stay' ? undefined : `Source: ${channel}` });
  }
  for (const a of auditRows) {
    const d = describe(a);
    if (d) timeline.push({ at: a.occurred_at, ...d });
  }
  for (const m of messages) {
    timeline.push({ at: m.sent_at, label: m.direction === 'inbound' ? 'Message from guest' : m.is_automated ? 'Automatic message sent' : 'Message sent to guest' });
  }
  for (const n of notices) {
    timeline.push({ at: n.sent_at ?? n.queued_at, label: `${n.template.replace(/[._]/g, ' ')} by ${n.channel}`, detail: n.state === 'sent' ? 'Sent' : n.state === 'failed' ? 'Failed to send' : 'Queued, not sent yet' });
  }
  if (lines.payoutDate) timeline.push({ at: String(lines.payoutDate), label: 'Paid out to us' });
  timeline.sort((a, b) => a.at.localeCompare(b.at));

  const today = mytDay();
  if (['inquiry', 'pending', 'confirmed'].includes(row.state) && row.check_in >= today) {
    timeline.push({ at: `${row.check_in}T${row.check_in_time}:00+08:00`, label: 'Check-in due', upcoming: true });
  }
  if (['inquiry', 'pending', 'confirmed', 'checked_in'].includes(row.state) && row.check_out >= today) {
    timeline.push({ at: `${row.check_out}T${row.check_out_time}:00+08:00`, label: 'Check-out due', upcoming: true });
  }

  const moves = movesFor(row.state as State, {
    channel: row.channel, checkIn: row.check_in, checkOut: row.check_out, today,
    manage: !!session.manage, enteredOn: await enteredOn(env, id, row.state),
  });

  return json({
    ...toRow(row),
    unitId: row.unit_id,
    notes: row.notes ?? null,
    money: {
      gross: Number(row.gross_booking_value), channelFee: Number(row.channel_fee), collected: Number(row.collected_revenue),
      ...lines,
    },
    timeline,
    moves,
  });
};

/** PATCH /api/reservations/:id { state, reason? } — a status move from the allowed map (_lib/bookingLifecycle.ts).
 *  ("status" is accepted for state.) Illegal moves are refused with 409 and the reason in words. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Field roles cannot change reservations.', 403);

  const b = await request.json<any>().catch(() => null);
  const r = await applyMove(env, session, String(params.id), b?.state ?? b?.status, typeof b?.reason === 'string' ? b.reason : null);
  if (isRefusal(r)) return json(r.body, r.status);
  return json(r);
};
