import { type Env, all, one, json, fail } from './db';
import type { Session } from './auth';

/**
 * Meeting rooms shared by every company and every ERP (owner, 22 Nov 2026). The rooms, meetings, guest links and the
 * cross-ERP staff directory live in the Houzs IT Hub (houzs-hub routes/sysMeetings.ts), so a Houzs or Hookka colleague
 * booked from here sees it in their own ERP and the other way round. These functions are the only thing that talks to
 * it, server to server, with Conts's IT Hub key (IT_HUB_API_KEY, system CONTS), like IT Support (itHub.ts):
 *
 *   browser --session--> /api/meetings/* --Bearer key + X-Reporter-Id + X-Person-*--> hub
 *
 * Who is asking is the signed-in person (session.userId), never a value from the request; their name, email, company
 * (The Conts or Dream Crafter, from their side) and department come from users here. Adding and changing rooms needs
 * the Manage meeting rooms permission (area meetingRooms, given one by one; management always has it), decided here and
 * sent as X-Can-Manage-Rooms: the hub trusts it because only this server holds the key.
 *
 * The hub's 409 is a booking conflict and is passed on with its body unchanged: the page builds the "Adrian is busy
 * 2-3pm" dialog from it. Not connected is 501 and the hub down 502, never an empty calendar.
 */
const TIMEOUT_MS = 20_000;
const NOT_CONNECTED = 'Meetings is not connected on this system yet. Tell IT.';
const UNREACHABLE = 'Meetings could not be reached. Try again in a moment.';

export interface MeetingsHub { base: string; key: string; headers: Record<string, string> }

export const hubBase = (env: Env) => (env.IT_HUB_URL ?? '').trim().replace(/\/+$/, '');
export const hubKey = (env: Env) => (env.IT_HUB_API_KEY ?? '').trim();
export const meetingsConnected = (env: Env) => !!hubBase(env) && !!hubKey(env);
/** Header values are plain text: no line breaks, at most 200 characters. */
const clean = (v: unknown) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
/** The company a person belongs to, from the side they work on (access.ts sideSql). */
export const companyOf = (side: string | null | undefined) => (side === 'dream_crafter' ? 'Dream Crafter' : 'The Conts');
export const mayManageRooms = (s: Session) => {
  const level = s.levels?.meetingRooms;
  return s.role === 'management' || (!!level && level !== 'none');
};

/** The hub settings for this person, or the refusal to send. */
export async function meetingsHubFor(env: Env, s: Session): Promise<{ hub: MeetingsHub; refusal: null } | { hub: null; refusal: Response }> {
  if (!meetingsConnected(env)) return { hub: null, refusal: fail('NOT_CONFIGURED', NOT_CONNECTED, 501) };
  const me = await one<{ email: string | null; full_name: string | null; side: string | null; department: string | null }>(env,
    `SELECT u.email, u.full_name, CASE WHEN d.side IN ('conts','dream_crafter') THEN d.side ELSE u.side END AS side, d.name AS department
       FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = ?`, s.userId);
  return {
    hub: {
      base: hubBase(env),
      key: hubKey(env),
      headers: {
        'X-Reporter-Id': clean(s.userId),
        'X-Person-Name': clean(me?.full_name || s.fullName || me?.email || s.email),
        'X-Person-Email': clean(me?.email ?? s.email),
        'X-Person-Company': companyOf(me?.side ?? s.side),
        'X-Person-Department': clean(me?.department ?? ''),
        'X-Can-Manage-Rooms': mayManageRooms(s) ? '1' : '0',
      },
    },
    refusal: null,
  };
}

export function guestHub(env: Env): MeetingsHub | null {
  return meetingsConnected(env) ? { base: hubBase(env), key: hubKey(env), headers: { 'X-Reporter-Id': 'guest' } } : null;
}

export function meetingsFetch(hub: MeetingsHub, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${hub.key}`);
  for (const [k, v] of Object.entries(hub.headers)) headers.set(k, v);
  return fetch(`${hub.base}/api/v1/sys/meetings${path}`, { ...init, headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
}

/** One hub call answered to the browser. A 2xx, and a refusal the hub explains (400/403/404/409/413/429), carry the
 *  hub's own body; a 401 means Conts's key is wrong and must not read as the person's own sign-in having ended. */
export async function relayMeetings(call: Promise<Response>): Promise<Response> {
  let res: Response;
  try {
    res = await call;
  } catch (e) {
    console.error('Meetings hub unreachable', e instanceof Error ? e.message : e);
    return fail('UPSTREAM', UNREACHABLE, 502);
  }
  const body = await res.json().catch(() => null) as Record<string, unknown> | null;
  if (res.ok && body) return json(body, res.status === 201 ? 201 : 200);
  if (body && [400, 403, 404, 409, 413, 429].includes(res.status)) return json(body, res.status);
  console.error('Meetings hub answered', res.status, typeof body?.error === 'string' ? body.error : '');
  return fail('UPSTREAM', UNREACHABLE, 502);
}

/* ---------- staff directory ---------- */

export interface DirectoryPerson { id: string; name: string; email: string; company: string; department: string }
interface UserRow { id: string; email: string | null; full_name: string | null; side: string | null; department: string | null }

/** Active desk staff as the hub's directory wants them. Pure, so the shape is tested alone. Owners and field accounts
 *  (cleaners, technicians, renovation staff) have no Meetings page, so they are not offered to be invited. */
export function directoryPeople(rows: UserRow[]): DirectoryPerson[] {
  return rows.filter(r => r.id).map(r => {
    const email = String(r.email ?? '').trim();
    return { id: String(r.id), name: String(r.full_name ?? '').trim() || email || String(r.id), email, company: companyOf(r.side), department: String(r.department ?? '').trim() };
  });
}

/** Sends every active desk person to the hub. Nothing to send to (no address or key) is not an error. */
export async function pushMeetingsDirectory(env: Env): Promise<{ sent: number } | { skipped: string }> {
  if (!meetingsConnected(env)) return { skipped: 'not connected' };
  const rows = await all<UserRow>(env,
    `SELECT u.id, u.email, u.full_name, CASE WHEN d.side IN ('conts','dream_crafter') THEN d.side ELSE u.side END AS side, d.name AS department
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
      WHERE u.is_active = 1 AND u.role NOT IN ('owner','housekeeper','technician','renovator')`);
  const people = directoryPeople(rows);
  const res = await fetch(`${hubBase(env)}/api/v1/sys/meetings/directory`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${hubKey(env)}`, 'X-Reporter-Id': 'system', 'Content-Type': 'application/json' },
    body: JSON.stringify({ people }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`The hub refused the staff list (${res.status}).`);
  return { sent: people.length };
}

// Opening the page also refreshes the directory, at most once an hour per isolate, so a colleague is findable from
// Houzs and Hookka even before the cron worker's next hourly run.
let lastPush = 0;
export function maybePushDirectory(env: Env, waitUntil: (p: Promise<unknown>) => void) {
  if (Date.now() - lastPush < 3_600_000) return;
  lastPush = Date.now();
  waitUntil(pushMeetingsDirectory(env).catch(e => console.error('Meetings directory push failed', e instanceof Error ? e.message : e)));
}
