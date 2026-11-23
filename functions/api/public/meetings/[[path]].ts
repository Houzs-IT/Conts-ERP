import { type Env, json, audit } from '../../../_lib/db';
import { guestHub, meetingsFetch, type MeetingsHub } from '../../../_lib/meetingsHub';

/**
 * /api/public/meetings/* — the guest side of a meeting-room booking link (/book/:code, src/pages/MeetingBookPage.tsx).
 * NO SIGN-IN: the link code is all a guest has. Proxied to the Houzs IT Hub as X-Reporter-Id: guest, which the hub
 * lets reach only its /public routes: the link's rooms and each day's taken times, never what the meetings are or who
 * booked. The guest picks the room and the time range; only the booking fields below reach the hub, never a host or
 * attendees. The hub limits one person to two
 * bookings a day; a booking page's private token (64 hex) is the only way to see or cancel that booking.
 *
 *   GET  links/:code | links/:code/day?day=YYYY-MM-DD | links/:code/slots?day=YYYY-MM-DD | bookings/:token
 *   POST links/:code/book | bookings/:token/cancel
 *
 * Errors answer { error: "<sentence>" }, the shape the guest page reads.
 */
const LINK_CODE = /^[a-z0-9]{1,8}-[a-f0-9]{6,32}$/;
const TOKEN = /^[a-f0-9]{64}$/;
const DEAD = 'This booking link is not active.';
const said = (error: string, status: number) => json({ error }, status);

async function relay(call: Promise<Response>): Promise<Response> {
  let res: Response;
  try { res = await call; } catch { return said('Booking could not be reached. Try again in a moment.', 502); }
  const body = await res.json().catch(() => null) as Record<string, unknown> | null;
  if (res.ok && body) return json(body, res.status === 201 ? 201 : 200);
  if (body && [400, 404, 409, 429].includes(res.status)) return json({ error: typeof body.error === 'string' ? body.error : DEAD }, res.status);
  return said('Booking could not be reached. Try again in a moment.', 502);
}

export const onRequest: PagesFunction<Env> = async ({ request, env, params }) => {
  const parts = ([] as string[]).concat(params.path ?? []).filter(Boolean);
  const hub = guestHub(env);
  if (!hub) return said('Booking is not available right now.', 503);
  const send = (path: string, init?: RequestInit) => relay(meetingsFetch(hub as MeetingsHub, path, init));
  const [kind, id, act] = parts;

  if (kind === 'links') {
    if (!LINK_CODE.test(id ?? '')) return said(DEAD, 404);
    if (request.method === 'GET' && parts.length === 2) return send(`/public/links/${id}`);
    if (request.method === 'GET' && act === 'day') {
      const day = new URL(request.url).searchParams.get('day') ?? '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return said('Pick a day.', 400);
      return send(`/public/links/${id}/day?day=${day}`);
    }
    if (request.method === 'GET' && act === 'slots') {
      const day = new URL(request.url).searchParams.get('day') ?? '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return said('Pick a day.', 400);
      return send(`/public/links/${id}/slots?day=${day}`);
    }
    if (request.method === 'POST' && act === 'book') {
      let b: Record<string, unknown>;
      try { b = await request.json() as Record<string, unknown>; } catch { return said('That could not be read. Try again.', 400); }
      const body = { start: b.start, end: b.end, roomId: b.roomId, name: b.name, phone: b.phone, email: b.email, company: b.company, department: b.department, title: b.title, people: b.people };
      const res = await send(`/public/links/${id}/book`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (res.ok) {
        try { await audit(env, { actorId: null, actorLabel: `Guest ${String(b.name ?? '').slice(0, 80)}`, action: 'meetings.guest_book', entityTable: 'meeting_links', entityId: id, after: { start: b.start, end: b.end, roomId: b.roomId, company: b.company } }); }
        catch (e) { console.error('Guest booking audit failed', e); }
      }
      return res;
    }
  }
  if (kind === 'bookings') {
    if (!TOKEN.test(id ?? '')) return said('Booking not found.', 404);
    if (request.method === 'GET' && parts.length === 2) return send(`/public/bookings/${id}`);
    if (request.method === 'POST' && act === 'cancel') {
      const res = await send(`/public/bookings/${id}/cancel`, { method: 'POST' });
      if (res.ok) {
        try { await audit(env, { actorId: null, actorLabel: 'Guest', action: 'meetings.guest_cancel', entityTable: 'meetings', entityId: id.slice(0, 8) }); }
        catch (e) { console.error('Guest cancel audit failed', e); }
      }
      return res;
    }
  }
  return said('Not found.', 404);
};
