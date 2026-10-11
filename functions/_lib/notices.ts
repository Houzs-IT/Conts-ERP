import { type Env, one, all } from './db';
import { notifyUsers, taskPeople, technicianFor } from './notify';

/** The notices staff get when something happens to a booking, a clean or a repair job. Every function here
 *  is safe to await inside a handler: notifyUsers never throws, and the lookups are wrapped the same way. */

const CHANNEL: Record<string, string> = { airbnb: 'Airbnb', booking_com: 'Booking.com', agoda: 'Agoda', direct: 'Direct', owner_stay: 'Owner stay', maintenance_block: 'Block' };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "13 Sep" from 2026-09-13. Notice text is stored, so it is written out here in the app's date style. */
export const day = (d: string) => { const [, m, dd] = d.slice(0, 10).split('-').map(Number); return `${dd} ${MON[m - 1]}`; };
/** "13 Oct 14:00" in Malaysian time, from any ISO instant. */
export const when = (iso: string) => { const t = new Date(Date.parse(iso) + 8 * 3600e3).toISOString(); return `${day(t)} ${t.slice(11, 16)}`; };
const stay = (a: string, b: string) => `${day(a)} – ${day(b)} ${b.slice(0, 4)}`;

interface Booking { id: string; channel: string; check_in: string; check_out: string; guest: string | null; unit: string }

async function booking(env: Env, id: string): Promise<Booking | null> {
  try {
    return await one<Booking>(env, `
      SELECT r.id, r.channel, r.check_in, r.check_out, g.full_name AS guest, trim(coalesce(p.name, '') || ' ' || u.unit_number) AS unit
      FROM reservations r JOIN units u ON u.id = r.unit_id LEFT JOIN properties p ON p.id = u.property_id LEFT JOIN guests g ON g.id = r.guest_id
      WHERE r.id = ?`, id);
  } catch { return null; }
}

export type BookingEvent = 'created' | 'cancelled' | 'dates' | 'checked_out' | 'no_show';

/** A new booking, a cancellation, a date change, a no-show or a check-out. `by` is left out of the recipients.
 *  A check-out also tells whoever has the turnover clean that the unit can be cleaned now. */
export async function bookingNotice(env: Env, id: string, event: BookingEvent, by: string | null, extra: { from?: { checkIn: string; checkOut: string } } = {}) {
  const b = await booking(env, id);
  if (!b) return;
  // Calendar blocks and owner stays are not bookings to act on.
  if (b.channel === 'maintenance_block') return;
  const who = b.guest || (b.channel === 'owner_stay' ? 'Owner stay' : 'Guest');
  const link = `/reservations/bookings?open=${encodeURIComponent(id)}`;
  const base = { link, entityTable: 'reservations', entityId: id, except: by };
  const via = CHANNEL[b.channel] ?? b.channel;

  if (event === 'created') {
    await notifyUsers(env, 'ops', { ...base, kind: 'booking.created', title: `New reservation: ${b.unit}`, body: `${who}, ${stay(b.check_in, b.check_out)} (${via}).`, dedupeKey: `booking-created-${id}` });
  } else if (event === 'cancelled') {
    await notifyUsers(env, 'ops', { ...base, kind: 'booking.cancelled', title: `Reservation cancelled: ${b.unit}`, body: `${who}, ${stay(b.check_in, b.check_out)} (${via}). The nights are open again.`, dedupeKey: `booking-cancelled-${id}-${b.check_in}` });
  } else if (event === 'no_show') {
    await notifyUsers(env, 'ops', { ...base, kind: 'booking.no_show', title: `No-show: ${b.unit}`, body: `${who} did not arrive (${stay(b.check_in, b.check_out)}).`, dedupeKey: `booking-noshow-${id}` });
  } else if (event === 'dates') {
    const from = extra.from ? `${stay(extra.from.checkIn, extra.from.checkOut)} to ` : '';
    await notifyUsers(env, 'ops', { ...base, kind: 'booking.dates_changed', title: `Reservation dates changed: ${b.unit}`, body: `${who} moved from ${from}${stay(b.check_in, b.check_out)}.`, dedupeKey: `booking-dates-${id}-${b.check_in}-${b.check_out}` });
  } else if (event === 'checked_out') {
    let cleaners: string[] = [];
    let taskId: string | null = null;
    try {
      const t = await one<{ id: string }>(env, `SELECT id FROM tasks WHERE reservation_id = ? AND kind IN ('turnover','light_clean','deep_clean') AND state <> 'resolved' ORDER BY scheduled_for NULLS LAST, created_at LIMIT 1`, id);
      if (t) { taskId = t.id; cleaners = await taskPeople(env, t.id); }
    } catch { /* no clean found: ops are still told */ }
    const cleanLink = taskId ? `/operations/cleaning?task=${encodeURIComponent(taskId)}` : '/operations/cleaning';
    const notice = { kind: 'booking.checked_out', title: `Guest checked out: ${b.unit}`, body: `${who} has left. Cleaning can start.`, link: cleanLink, entityTable: 'reservations', entityId: id, except: by, dedupeKey: `checked-out-${id}` };
    await notifyUsers(env, { roles: ['ops'], userIds: cleaners }, notice);
  }
}

interface Task { id: string; title: string; kind: string; unit: string; scheduled_for: string | null; due_at: string | null }

async function task(env: Env, id: string): Promise<Task | null> {
  try {
    return await one<Task>(env, `
      SELECT t.id, t.title, t.kind, t.scheduled_for, t.due_at, trim(coalesce(p.name, '') || ' ' || u.unit_number) AS unit
      FROM tasks t JOIN units u ON u.id = t.unit_id LEFT JOIN properties p ON p.id = u.property_id WHERE t.id = ?`, id);
  } catch { return null; }
}

/** A clean was given to someone, finished, or ran past its time. */
export async function cleaningNotice(env: Env, id: string, event: 'assigned' | 'completed' | 'overdue', by: string | null) {
  const t = await task(env, id);
  if (!t) return;
  const link = `/operations/cleaning?task=${encodeURIComponent(id)}`;
  const when = t.scheduled_for ? ` on ${day(t.scheduled_for)}` : '';
  const base = { link, entityTable: 'tasks', entityId: id, except: by };
  if (event === 'assigned') {
    const people = await taskPeople(env, id);
    if (people.length) await notifyUsers(env, people, { ...base, kind: 'cleaning.assigned', title: `Cleaning job assigned to you: ${t.unit}`, body: `${t.title}${when}.`, dedupeKey: `clean-assigned-${id}-${people.join('-')}` });
  } else if (event === 'completed') {
    await notifyUsers(env, 'ops', { ...base, kind: 'cleaning.completed', title: `Cleaning job done: ${t.unit}`, body: `${t.title} is finished; the unit is ready.`, dedupeKey: `clean-done-${id}` });
  } else {
    const people = await taskPeople(env, id);
    await notifyUsers(env, { roles: ['ops_managers'], userIds: people }, { ...base, kind: 'cleaning.overdue', title: `Cleaning job overdue: ${t.unit}`, body: `${t.title} was due${t.due_at ? ` by ${day(t.due_at)}` : ''} and is not finished.`, dedupeKey: `clean-overdue-${id}`, except: null });
  }
}

interface Issue { id: string; title: string; unit: string; urgency: string | null; vendor_name: string | null; reported_by: string | null; quoted_amount: number | null; owner_user: string | null }

async function issue(env: Env, id: string): Promise<Issue | null> {
  try {
    return await one<Issue>(env, `
      SELECT m.id, m.title, m.urgency, m.vendor_name, m.reported_by, m.quoted_amount, o.user_id AS owner_user,
             trim(coalesce(p.name, '') || ' ' || u.unit_number) AS unit
      FROM maintenance_issues m JOIN units u ON u.id = m.unit_id LEFT JOIN properties p ON p.id = u.property_id
      LEFT JOIN owners o ON o.id = u.owner_id WHERE m.id = ?`, id);
  } catch { return null; }
}

export type RepairEvent = 'reported' | 'assigned' | 'window' | 'done' | 'overdue' | 'approval_requested' | 'approval_decided';

/** A repair job was reported, given to someone, given a time to enter the unit, finished, ran late, or needs /
 *  got the owner's approval. `detail` adds a line (the window's time, the decision). */
export async function repairNotice(env: Env, id: string, event: RepairEvent, by: string | null, detail?: string) {
  const m = await issue(env, id);
  if (!m) return;
  const link = `/operations/maintenance?id=${encodeURIComponent(id)}`;
  const base = { link, entityTable: 'maintenance_issues', entityId: id, except: by };
  const tech = await technicianFor(env, m.vendor_name);
  const urgent = m.urgency === 'urgent' ? 'Urgent maintenance job' : 'Maintenance job';
  switch (event) {
    case 'reported':
      await notifyUsers(env, 'ops', { ...base, kind: 'maintenance.reported', title: `${urgent} reported: ${m.unit}`, body: m.title, dedupeKey: `repair-reported-${id}` });
      break;
    case 'assigned':
      await notifyUsers(env, { roles: ['ops_managers'], userIds: tech }, { ...base, kind: 'maintenance.assigned', title: `Maintenance job assigned: ${m.unit}`, body: `${m.title}${m.vendor_name ? ` – ${m.vendor_name}` : ''}.`, dedupeKey: `repair-assigned-${id}-${(m.vendor_name ?? '').toLowerCase()}` });
      break;
    case 'window':
      await notifyUsers(env, { roles: ['ops'], userIds: tech }, { ...base, kind: 'maintenance.window', title: `Maintenance visit scheduled: ${m.unit}`, body: `${m.title}${detail ? `. ${detail}` : ''}.` });
      break;
    case 'done':
      await notifyUsers(env, { roles: ['ops'], userIds: [m.reported_by] }, { ...base, kind: 'maintenance.done', title: `Maintenance job done: ${m.unit}`, body: m.title, dedupeKey: `repair-done-${id}` });
      break;
    case 'overdue':
      await notifyUsers(env, { roles: ['ops_managers'], userIds: tech }, { ...base, kind: 'maintenance.overdue', title: `Maintenance job overdue: ${m.unit}`, body: `${m.title} is still open.`, dedupeKey: `repair-overdue-${id}`, except: null });
      break;
    case 'approval_requested': {
      await notifyUsers(env, 'managers', { ...base, kind: 'approval.requested', title: `Owner approval requested: ${m.unit}`, body: `${m.title}${detail ? `. ${detail}` : ''}.` });
      // The owner decides on their portal; the notice (and an email copy where mail is set up) takes them there.
      const quote = m.quoted_amount != null ? `RM ${(Number(m.quoted_amount) / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null;
      if (m.owner_user) await notifyUsers(env, [m.owner_user], { ...base, link: '/', except: null, email: true, kind: 'maintenance.owner_approval',
        title: `Repair quote to approve: ${m.unit}`, body: `${m.title}${quote ? `. Quote ${quote}` : ''}. Open your owner portal to approve it.` });
      break;
    }
    case 'approval_decided':
      await notifyUsers(env, { roles: ['ops'], userIds: tech }, { ...base, kind: 'approval.decided', title: `Maintenance job ${detail ?? 'decided'}: ${m.unit}`, body: m.title });
      break;
  }
}

/** Every active operations person, for the scheduled digest. */
export async function opsPeople(env: Env): Promise<{ id: string }[]> {
  return all<{ id: string }>(env, `SELECT id FROM users WHERE is_active = 1 AND role IN ('operations_manager','operations_staff','management')`);
}
