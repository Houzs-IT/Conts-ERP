// Booking lifecycle: the allowed status moves (functions/_lib/bookingLifecycle.ts) are enforced by the server,
// their side effects are right and undone cleanly, and the drawer's detail read carries only real figures.
// It creates its own bookings, so run it against a throwaway database only:
//   API_BASE=http://127.0.0.1:8801 API_EMAIL=dev@local.test API_PASSWORD=LocalTest1 [SESSION_SECRET=<.dev.vars value>] \
//     node scripts/api-checks/booking-lifecycle.mjs
// It also signs a session for the seeded operations_staff user (harness USERS; SESSION_SECRET as in harness.mjs) to
// check the management-only moves are refused to other roles, and skips those checks when that user is not here.
import { cookieFor } from './harness.mjs';

const BASE = process.env.API_BASE ?? 'http://127.0.0.1:8801';
let fails = 0;
const check = (name, ok, extra = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ' :: ' + String(extra).slice(0, 400)}`); };

const login = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: process.env.API_EMAIL ?? 'dev@local.test', password: process.env.API_PASSWORD ?? 'LocalTest1' }) });
const cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
check('signed in', login.ok && cookie.includes('='), login.status);

/** The middleware reads the live role from users, so the non-management checks need a real user who is not
 *  management; null when the seeded one is missing or the server does not take the harness secret. */
async function staffCookie() {
  const c = cookieFor('operations_staff');
  const r = await fetch(BASE + '/api/auth/session', { headers: { cookie: c } });
  const role = r.ok ? (await r.json()).user?.role : null;
  return role === 'operations_staff' ? c : null;
}
async function call(method, path, body, as = cookie) {
  const r = await fetch(BASE + path, { method, headers: { cookie: as, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status, json: j, text: t };
}

const MYT = (offset = 0) => new Date(Date.now() + 8 * 3600e3 + offset * 864e5).toISOString().slice(0, 10);
const units = (await call('GET', '/api/units')).json?.data ?? [];
check('units listed', units.length > 0);

/** Creates a direct booking on the first unit free for [from, to). */
async function book(from, to, extra = {}) {
  for (const u of units) {
    const r = await call('POST', '/api/reservations', { unitId: u.id, channel: 'direct', guest: { fullName: 'Lifecycle Check' }, checkIn: from, checkOut: to, guestsCount: 2, grossBookingValue: 40000, ...extra });
    if (r.status === 201) return { id: r.json.id, unitId: u.id, effects: r.json.effects };
    if (r.status !== 409) return { error: r.text };
  }
  return { error: 'no free unit' };
}
const detail = async id => (await call('GET', `/api/reservations/${id}`)).json;
const move = (id, state, reason, as) => call('PATCH', `/api/reservations/${id}`, { state, ...(reason ? { reason } : {}) }, as);

/* ---------- a future stay ---------- */
const future = await book(MYT(200), MYT(203));
check('create future direct booking', !!future.id, future.error);
check('create says what happened on the channels', ['queued', 'not_linked', 'failed'].includes(future.effects?.channel), JSON.stringify(future.effects));
let d = await detail(future.id);
check('detail: confirmed, money is the real gross only', d.state === 'confirmed' && d.money.gross === 40000 && d.money.channelFee === 0 && d.money.collected === 0, JSON.stringify(d.money));
check('detail: no invented lines (cleaning / tourism tax null unless stored)', d.money.guestCleaningFee == null || typeof d.money.guestCleaningFee === 'number');
check('detail: timeline from records (created by a person, check-in due)', d.timeline.some(e => e.label === 'Reservation created' && e.actor) && d.timeline.some(e => e.label === 'Check-in due' && e.upcoming) && !d.timeline.some(e => /access code|smart lock|payment received/i.test(e.label)), JSON.stringify(d.timeline));
const ci = d.moves.find(m => m.to === 'checked_in');
check('detail: Check in listed but closed until the day, with the reason', ci && !ci.allowed && /Check-in opens on \d{1,2} [A-Z][a-z]{2} \d{4}/.test(ci.reason), JSON.stringify(d.moves));
check('detail: confirmed offers only check in / no-show / cancel', JSON.stringify(d.moves.map(m => m.to).sort()) === JSON.stringify(['cancelled', 'checked_in', 'no_show']), JSON.stringify(d.moves.map(m => m.to)));

let r = await move(future.id, 'checked_in');
check('illegal: check in before the day -> 409', r.status === 409 && r.json.error.code === 'ILLEGAL_TRANSITION', r.text);
r = await move(future.id, 'checked_out');
check('illegal: confirmed -> checked out -> 409 with words', r.status === 409 && /Upcoming cannot be moved to Past/.test(r.json.error.message), r.text);
r = await move(future.id, 'no_show', 'x');
check('illegal: no-show before the check-in day -> 409', r.status === 409, r.text);
r = await move(future.id, 'cancelled');
check('cancel needs a reason -> 422', r.status === 422, r.text);
r = await move(future.id, 'bogus');
check('unknown status -> 422', r.status === 422, r.text);
r = await call('POST', `/api/reservations/${future.id}/cancel`, { reason: 'Guest changed plans' });
check('cancel with reason -> cancelled, channels reported honestly', r.status === 200 && r.json.state === 'cancelled' && ['queued', 'not_linked', 'failed'].includes(r.json.effects.channel), r.text);
d = await detail(future.id);
check('cancelled: timeline shows the reason', d.timeline.some(e => e.label === 'Cancelled' && /Guest changed plans/.test(e.detail ?? '')), JSON.stringify(d.timeline));
check('cancelled: only Reinstate is offered', d.moves.length === 1 && d.moves[0].to === 'confirmed', JSON.stringify(d.moves));
r = await move(future.id, 'checked_out');
check('illegal: cancelled -> checked out -> 409', r.status === 409, r.text);
r = await call('PATCH', `/api/reservations/${future.id}/dates`, { checkIn: MYT(201), checkOut: MYT(204), confirm: true });
check('dates of a cancelled booking cannot change -> 409', r.status === 409, r.text);
const staff = await staffCookie();
if (staff) {
  r = await move(future.id, 'confirmed', undefined, staff);
  check('reinstate refused to a non-management role', r.status === 409 && /Only management/.test(r.json?.error?.message ?? ''), r.text);
} else console.log('skip non-management checks (the seeded operations_staff user is not signed in on this server)');
r = await move(future.id, 'confirmed');
check('management reinstates a cancelled booking (clash checked)', r.status === 200 && r.json.state === 'confirmed', r.text);

/* ---------- date change: price and wording ---------- */
r = await call('PATCH', `/api/reservations/${future.id}/dates`, { checkIn: MYT(200), checkOut: MYT(204) });
check('dates need confirm 428, no "notified" claim, no raw ISO', r.status === 428 && !/notif/i.test(r.json.error.message) && !/\d{4}-\d{2}-\d{2}/.test(r.json.error.message), r.text);
r = await call('PATCH', `/api/reservations/${future.id}/dates`, { checkIn: MYT(200), checkOut: MYT(204), confirm: true, grossBookingValue: 53333 });
check('direct booking: dates and new total saved together', r.status === 200 && r.json.grossBookingValue === 53333, r.text);
d = await detail(future.id);
check('timeline: date change shows old and new dates and total', d.timeline.some(e => e.label === 'Dates changed' && /RM 400\.00 to RM 533\.33/.test(e.detail ?? '')), JSON.stringify(d.timeline));

/* ---------- a stay that starts today ---------- */
const today = await book(MYT(0), MYT(2));
check('create stay starting today', !!today.id, today.error);
if (today.id) {
  d = await detail(today.id);
  check('today: Check in is open', d.moves.find(m => m.to === 'checked_in')?.allowed === true, JSON.stringify(d.moves));
  r = await move(today.id, 'checked_in');
  check('check in -> unit occupied', r.status === 200 && r.json.effects.readiness === 'occupied', r.text);
  r = await move(today.id, 'cancelled', 'x');
  check('illegal: checked in -> cancelled -> 409', r.status === 409, r.text);
  r = await move(today.id, 'checked_out');
  // The turnover is made when the stay is booked (ensureTurnovers), so check-out finds it rather than making a second.
  const cleans = ((await call('GET', `/api/housekeeping/board?date=${MYT(2)}`)).json?.rows ?? []).filter(x => x.unitId === today.unitId);
  check('check out -> dirty + exactly one turnover', r.status === 200 && r.json.effects.readiness === 'dirty' && cleans.length === 1, `${r.text} cleans=${cleans.length}`);
  d = await detail(today.id);
  check('checked out: management may undo the same day', d.moves.length === 1 && d.moves[0].to === 'checked_in' && d.moves[0].allowed, JSON.stringify(d.moves));
  if (staff) {
    r = await move(today.id, 'checked_in', undefined, staff);
    check('undo check-out refused to a non-management role', r.status === 409, r.text);
  }
  r = await move(today.id, 'checked_in');
  check('undo check-out removes the untouched turnover task', r.status === 200 && r.json.effects.tasksRemoved === 1 && r.json.effects.tasksKept === 0, r.text);
  r = await move(today.id, 'checked_out');
  check('check out again creates exactly one new turnover', r.status === 200 && r.json.effects.turnoverCreated === true, r.text);
  r = await move(today.id, 'checked_in');
  check('second undo removes it again (no orphan)', r.status === 200 && r.json.effects.tasksRemoved === 1, r.text);
  r = await move(today.id, 'confirmed');
  check('undo check-in the same day (management)', r.status === 200 && r.json.state === 'confirmed', r.text);
  r = await move(today.id, 'no_show');
  check('no-show needs a reason -> 422', r.status === 422, r.text);
  r = await move(today.id, 'no_show', 'Did not arrive by midnight');
  check('no-show from the check-in day', r.status === 200 && r.json.state === 'no_show', r.text);
}

/* ---------- blocks ---------- */
let blockId = null;
for (const u of units) {
  r = await call('POST', '/api/blocks', { unitId: u.id, from: MYT(300), to: MYT(302), reason: 'Lifecycle check' });
  if (r.status === 201) { blockId = r.json.id; break; }
}
check('block created, channels reported honestly', !!blockId && ['queued', 'not_linked', 'failed'].includes(r.json.effects.channel), r.text);
r = await move(blockId, 'checked_in');
check('illegal: a block has no status -> 409', r.status === 409 && /block has no status/.test(r.json.error.message), r.text);
d = await detail(blockId);
check('block detail: no moves, no money', d.moves.length === 0 && d.money.gross === 0, JSON.stringify(d.moves));
r = await call('POST', `/api/reservations/${blockId}/cancel`, { reason: 'Works finished' });
check('remove block (cancel with reason)', r.status === 200 && r.json.state === 'cancelled', r.text);

/* ---------- OTA booking: price belongs to the site ---------- */
const ota = (await call('GET', '/api/reservations?view=upcoming&ch=airbnb&size=25')).json?.data?.find(x => x.state === 'confirmed');
if (ota) {
  r = await call('PATCH', `/api/reservations/${ota.id}/dates`, { checkIn: ota.checkIn, checkOut: ota.checkOut, confirm: true, grossBookingValue: 1 });
  check('booking-site dates and price cannot be changed here -> 409 OTA_LOCKED', r.status === 409 && r.json.error.code === 'OTA_LOCKED', r.text);
  d = await detail(ota.id);
  check('airbnb detail: gross and commission straight from the record', d.money.gross === ota.grossBookingValue && d.money.channelFee === ota.channelFee, JSON.stringify(d.money));
} else console.log('skip OTA checks (no upcoming confirmed Airbnb booking)');

/* ---------- money cards (to-do filters on All) ---------- */
r = await call('GET', '/api/reservations?todo=unpaid&size=25');
check('Direct unpaid card: direct bookings still owed money, outstanding total', r.status === 200 && r.json.data.every(x => x.channel === 'direct' && x.outstanding > 0) && typeof r.json.totals.outstanding === 'number' && r.json.todos.unpaid.count === r.json.total, r.text.slice(0, 300));
r = await call('GET', '/api/reservations?todo=payout&size=25');
check('Payout pending card: finished booking-site stays still owed money', r.status === 200 && r.json.data.every(x => ['airbnb', 'booking_com', 'agoda'].includes(x.channel) && x.checkOut <= MYT(0) && x.outstanding > 0), r.text.slice(0, 300));
r = await call('GET', '/api/reservations?view=pending&size=25');
check('old "pending" links land on the Direct unpaid card', r.status === 200 && r.json.todo === 'unpaid', r.text.slice(0, 200));

console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
