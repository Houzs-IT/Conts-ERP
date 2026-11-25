/**
 * AI Connector actions, document flow and PDF links (owner, 26 Nov 2026): the pure rules, unit-tested in
 * src/lib/mcpActions.test.mjs. The tools themselves are in mcpServer.ts.
 *
 * ACTIONS, "confirm first, then do" (先确认再做). The connector may book a meeting and send an email for the signed-in
 * person; never orders, money, stock, approvals or deletes. Two steps:
 *   1. propose_meeting / propose_email check everything here (and against the Meetings directory, read as the person),
 *      store the exact payload in mcp_pending_actions for 10 minutes and answer a plain summary + confirmationId;
 *   2. confirm_action, after the person said yes in the chat, claims the row once (UPDATE ... WHERE used_at IS NULL AND
 *      expires_at > now RETURNING) and sends the payload through the ERP's OWN endpoint, in-process, as the person.
 *
 * THE WRITE FENCE. A connector token is read-only in the session middleware (functions/api/_middleware.ts). A non-GET
 * passes only when ALL of these hold (connectorDecision below): this isolate's inner secret is on the request, a second
 * header names the action being confirmed, the method + path is in ACTION_ALLOWLIST, and confirm_action granted a
 * permit for exactly that action, method, path and person in this same request, just after it consumed the row. The
 * permit is single use and lives 60 seconds (mcpInner.ts). Anything else stays 403.
 */

/** The only writes a connector token can ever make, and only through confirm_action:
 *  - booking a meeting: the Meetings page's own Book (functions/api/meetings/[[path]].ts -> the IT Hub);
 *  - the Mail Center sign-on: the engine session Mail Center opens with (functions/api/supply-chain/engine-session.ts),
 *    used once to send the confirmed email through Mail Center's own Compose (engine /api/mail-center/compose). */
export const ACTION_ALLOWLIST: readonly (readonly [string, string])[] = [
  ['POST', '/api/meetings/meetings'],
  ['POST', '/api/supply-chain/engine-session'],
];

export const ACTION_KINDS = ['meeting', 'email'] as const;
export type ActionKind = typeof ACTION_KINDS[number];
/** A proposal lapses after 10 minutes. */
export const ACTION_TTL_MS = 10 * 60_000;
/** Confirmed actions per person in any 24 hours. */
export const MAX_CONFIRMED_PER_DAY = 30;
/** The owner's switch on the AI Connector page, in the settings table. Off unless set to '1'. */
export const ACTIONS_SETTING_KEY = 'mcp.actionsEnabled';
export const ACTIONS_OFF = 'AI actions are switched off by your admin. Management can turn on "Allow AI actions (meetings, email)" on System > AI Connector.';

const norm = (p: string) => String(p ?? '').split('?')[0].replace(/\/+$/, '');

export const isAllowlisted = (method: string, path: string) =>
  ACTION_ALLOWLIST.some(([m, p]) => m === method.toUpperCase() && p === norm(path));

/** What confirm_action granted for one action: who, and the one method + path it may call. */
export interface ActionPermit { userId: string; method: string; path: string; exp: number }

/**
 * The session middleware's decision for a request carrying a connector token (functions/api/_middleware.ts
 * connectorRequest). `permit` is what takeActionPermit returned for the action header (null when there was none), and
 * `userId` the token's person (null before it was resolved).
 *   'refuse'  403: no inner secret, or a write that is not a confirmed, allow-listed action of this person;
 *   'read'    a GET / HEAD from the connector's own tool runner;
 *   'write'   the one write confirm_action is performing right now.
 */
export function connectorDecision(x: { method: string; path: string; innerOk: boolean; actionId: string; permit: ActionPermit | null; userId: string | null; now: number }): 'refuse' | 'read' | 'write' {
  if (!x.innerOk) return 'refuse';
  const method = x.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD') return 'read';
  if (!x.actionId || !x.permit || !x.userId) return 'refuse';
  if (!isAllowlisted(method, x.path)) return 'refuse';
  const p = x.permit;
  if (p.exp <= x.now || p.userId !== x.userId || p.method !== method || norm(p.path) !== norm(x.path)) return 'refuse';
  return 'write';
}

/* ---------- time ---------- */

const MYT_MS = 8 * 3600_000;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A date-time the AI gives: ISO with an offset, or a plain "YYYY-MM-DD HH:mm" / "YYYY-MM-DDTHH:mm" read as Malaysia
 *  time. Epoch ms, or null. */
export function parseWhen(v: unknown): number | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const plain = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (plain) {
    const [, y, mo, d, h, mi, se] = plain;
    const t = Date.UTC(+y, +mo - 1, +d, +h, +mi, +(se ?? 0)) - MYT_MS;
    const back = new Date(t + MYT_MS);
    // Rejects 2026-02-30 and 25:00, which Date.UTC would roll over.
    if (back.getUTCFullYear() !== +y || back.getUTCMonth() !== +mo - 1 || back.getUTCDate() !== +d || back.getUTCHours() !== +h) return null;
    return t;
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(s)) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** "Thu 27 Nov 2026, 14:00" in Malaysia time. */
export function mytLabel(t: number): string {
  const d = new Date(t + MYT_MS);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
const mytClock = (t: number) => { const d = new Date(t + MYT_MS); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
const mytDay = (t: number) => new Date(t + MYT_MS).toISOString().slice(0, 10);

/* ---------- meetings ---------- */

/** The Meetings page's directory (GET /api/meetings/bootstrap, src/lib/meetings.ts Bootstrap), only what is used. */
export interface MeetingDirectory {
  me: string;
  rooms: { id: number; name: string; location?: string; active?: boolean; seats?: number }[];
  people: { key: string; name: string; email: string | null; company?: string; department?: string }[];
}

/** The body the Meetings page sends to POST /api/meetings/meetings (src/lib/meetings.ts draftBody), one meeting,
 *  no repeat, the page's default reminder. */
export interface MeetingPayload {
  title: string; start: string; end: string; roomId: number | null; organizer: string; attendees: string[];
  videoType: 'none'; videoUrl: ''; notes: string; guestEmails: string[];
  reminders: { min: number; ch: ('erp' | 'email')[] }[]; repeat: 'none'; repeatUntil: null;
}

export const EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;
const lower = (s: unknown) => String(s ?? '').trim().toLowerCase();
const list = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,;\n]+/) : []).map(x => String(x ?? '').trim()).filter(Boolean);

type Proposal<P> = { ok: true; payload: P; summary: string; target: string } | { ok: false; problems: string[] };

/** propose_meeting's checks. The IT Hub still decides at confirm whether a person or room is free, the room's opening
 *  hours, closed dates and the longest booking, exactly as when the page books. */
export function proposeMeeting(args: Record<string, unknown>, dir: MeetingDirectory, now: number): Proposal<MeetingPayload> {
  const problems: string[] = [];
  const title = String(args.title ?? '').replace(/\s+/g, ' ').trim();
  if (!title) problems.push('Give the meeting a title.');
  else if (title.length > 200) problems.push('The title is longer than 200 characters.');
  const start = parseWhen(args.start);
  if (start === null) problems.push('Give start as a date and time, e.g. "2026-11-27 14:00" (Malaysia time) or ISO with an offset.');
  let end = args.end === undefined || args.end === null || args.end === '' ? (start === null ? null : start + 60 * 60_000) : parseWhen(args.end);
  if (end === null && start !== null) { problems.push('Give end as a date and time, or leave it out for one hour.'); end = null; }
  if (start !== null && end !== null) {
    if (end <= start) problems.push('The meeting must end after it starts.');
    else if (end - start > 12 * 3600_000) problems.push('A meeting can be at most 12 hours long.');
    if (start < now - 5 * 60_000) problems.push(`That start time (${mytLabel(start)}) is in the past.`);
    if (start > now + 366 * 24 * 3600_000) problems.push('Book at most a year ahead.');
  }
  const notes = String(args.notes ?? '').trim();
  if (notes.length > 2000) problems.push('Notes are longer than 2,000 characters.');

  // Attendees: a staff member by name or email from the Meetings directory; any other email is an outside guest, as
  // the page's "Guests by email".
  const attendees: string[] = [], guestEmails: string[] = [], names: string[] = [];
  const raw = list(args.attendees);
  if (raw.length > 50) problems.push('At most 50 attendees.');
  for (const a of raw.slice(0, 50)) {
    const q = lower(a);
    if (EMAIL_RE.test(q)) {
      const p = dir.people.find(x => lower(x.email) === q);
      if (p) { if (p.key !== dir.me && !attendees.includes(p.key)) { attendees.push(p.key); names.push(p.name); } }
      else if (!guestEmails.includes(q)) guestEmails.push(q);
      continue;
    }
    const exact = dir.people.filter(x => lower(x.name) === q);
    const hits = exact.length ? exact : dir.people.filter(x => lower(x.name).includes(q));
    if (hits.length === 1) {
      if (hits[0].key !== dir.me && !attendees.includes(hits[0].key)) { attendees.push(hits[0].key); names.push(hits[0].name); }
    } else if (hits.length > 1) {
      problems.push(`"${a}" matches ${hits.length} people: ${hits.slice(0, 5).map(h => `${h.name}${h.department ? ` (${h.department})` : ''}${h.email ? ` <${h.email}>` : ''}`).join('; ')}. Say which one, or give their email.`);
    } else {
      problems.push(`"${a}" is not in the staff directory. Give their email to invite them as an outside guest.`);
    }
  }

  // vocab-ok: a meeting room shared with Houzs and Hookka, not a rental unit
  let roomId: number | null = null, roomName = '';
  const roomAsked = String(args.room ?? '').trim();
  if (roomAsked) {
    const rooms = dir.rooms.filter(r => r.active !== false);
    const q = lower(roomAsked);
    const exact = rooms.filter(r => String(r.id) === q || lower(r.name) === q);
    const hits = exact.length ? exact : rooms.filter(r => lower(r.name).includes(q) || lower(`${r.name} ${r.location ?? ''}`).includes(q));
    if (hits.length === 1) { roomId = hits[0].id; roomName = hits[0].name + (hits[0].location ? `, ${hits[0].location}` : ''); }
    // vocab-ok: meeting rooms
    else problems.push(`${hits.length ? `"${roomAsked}" matches more than one meeting room` : `There is no meeting room "${roomAsked}"`}. Meeting rooms: ${rooms.map(r => r.name).join(', ') || 'none'}.`);
  }
  if (problems.length || start === null || end === null) return { ok: false, problems };

  const payload: MeetingPayload = {
    title, start: new Date(start).toISOString(), end: new Date(end).toISOString(), roomId, organizer: dir.me, attendees,
    videoType: 'none', videoUrl: '', notes, guestEmails, reminders: [{ min: 15, ch: ['erp', 'email'] }], repeat: 'none', repeatUntil: null,
  };
  const when = mytDay(start) === mytDay(end) ? `${mytLabel(start)} to ${mytClock(end)}` : `${mytLabel(start)} to ${mytLabel(end)}`;
  const who = [...names, ...guestEmails.map(g => `${g} (outside guest)`)];
  const summary = [
    `Book a meeting "${title}"`,
    `When: ${when} (Malaysia time)`,
    // vocab-ok: meeting room
    `Where: ${roomName || 'no meeting room'}`,
    `With: ${who.length ? who.join(', ') : 'nobody else (just you)'}`,
    notes ? `Notes: ${notes}` : '',
    'Everyone invited gets the Meetings notice and email, as when you book on the Meetings page. The meeting is booked in your name.',
  ].filter(Boolean).join('\n');
  return { ok: true, payload, summary, target: `meeting: "${title.slice(0, 80)}" ${mytLabel(start)}` };
}

/* ---------- email ---------- */

/** The body Mail Center's Compose takes (engine/backend/src/routes/mail-center.ts POST /compose). No attachments. */
export interface EmailPayload { fromAddress: string; to: string[]; cc: string[]; subject: string; text: string }

/** propose_email's checks: the same as Mail Center's Compose (every address valid, a subject and a body), plus limits.
 *  Whether the person may send from that mailbox is Mail Center's own rule, checked when it sends. */
export function proposeEmail(args: Record<string, unknown>, defaultFrom: string): Proposal<EmailPayload> {
  const problems: string[] = [];
  const to = list(args.to).map(lower), cc = list(args.cc).map(lower);
  const fromAddress = lower(args.from_mailbox ?? args.from ?? '') || lower(defaultFrom);
  const subject = String(args.subject ?? '').replace(/[\r\n]+/g, ' ').trim();
  const text = String(args.body ?? '').replace(/\r\n/g, '\n').trim();
  if (!to.length) problems.push('Give at least one recipient (to).');
  if (to.length > 20 || cc.length > 20) problems.push('At most 20 addresses in to and 20 in cc.');
  const bad = [...to, ...cc].find(a => !EMAIL_RE.test(a));
  if (bad) problems.push(`Not a valid email address: ${bad}`);
  if (!fromAddress || !EMAIL_RE.test(fromAddress)) problems.push('Give from_mailbox: the Mail Center mailbox to send from.');
  if (!subject) problems.push('Give a subject.');
  else if (subject.length > 200) problems.push('The subject is longer than 200 characters.');
  if (!text) problems.push('Give the message body.');
  else if (text.length > 20_000) problems.push('The message is longer than 20,000 characters.');
  if (problems.length) return { ok: false, problems };
  const uniq = (xs: string[]) => [...new Set(xs)];
  const mail: EmailPayload = { fromAddress, to: uniq(to), cc: uniq(cc).filter(c => !to.includes(c)), subject, text };
  const summary = [
    'Send this email through Mail Center',
    `From: ${mail.fromAddress}`,
    `To: ${mail.to.join(', ')}`,
    mail.cc.length ? `Cc: ${mail.cc.join(', ')}` : '',
    `Subject: ${subject}`,
    '',
    text,
    '',
    'It leaves the company once sent and cannot be called back. Mail Center sends it only if you may send from that mailbox; it is kept in the mailbox\'s Sent history.',
  ].filter((l, i, a) => l !== '' || (i > 0 && a[i - 1] !== '')).join('\n');
  const more = mail.to.length + mail.cc.length - 1;
  return { ok: true, payload: mail, summary, target: `email: to ${mail.to[0]}${more > 0 ? ` +${more}` : ''}, "${subject.slice(0, 60)}"` };
}

/** The confirmationId shape (mcpx_ + random), checked before any database read. */
export const validConfirmationId = (v: unknown) => /^mcpx_[A-Za-z0-9_-]{16,40}$/.test(String(v ?? ''));

/* ---------- document flow ---------- */

export interface FlowLink { type: string; number: string; status: string; date: string | null; amountRM: number | null; url: string; note?: string }
export interface FlowAnswer { start: FlowLink; chain: FlowLink[]; notes: string[] }

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {});
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object') as Obj[] : []);
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
/** sen -> RM, two decimals; null stays null (the reply had no figure: the person cannot see money there). */
export const rm = (sen: unknown): number | null => { const n = num(sen); return n === null ? null : Math.round(n) / 100; };
const enc = encodeURIComponent;

/** The owner of a unit from GET /api/units/detail ({ unit: { owner } }); a bare { owner } is read too. */
export const unitOwner = (detail: unknown): Obj => { const d = obj(detail); return obj(obj(d.unit).owner ?? d.owner); };

/** The owner-statement months a stay touches: check-in month to the month of the last night. */
export function stayMonths(checkIn: string, checkOut: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}/.test(checkIn)) return [];
  const lastNight = /^\d{4}-\d{2}-\d{2}/.test(checkOut) ? new Date(Date.parse(checkOut.slice(0, 10)) - 86_400_000).toISOString().slice(0, 10) : checkIn.slice(0, 10);
  const out: string[] = [];
  let [y, m] = checkIn.slice(0, 7).split('-').map(Number);
  const [ey, em] = (lastNight < checkIn.slice(0, 10) ? checkIn : lastNight).slice(0, 7).split('-').map(Number);
  while ((y < ey || (y === ey && m <= em)) && out.length < 13) {
    out.push(`${y}-${pad(m)}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

/**
 * A reservation's document chain from the replies the ERP gave the person: the reservation (GET /api/reservations/:id),
 * the guest invoice and receipts issued for it (its `documents`), the payments recorded (GET .../payments), the unit's
 * owner (GET /api/units/detail) and that owner's statements for the months the stay touches (GET /api/statements).
 * A part the person may not open arrives as `null` with its refusal in `refused`, and says so in the notes.
 */
export function reservationFlow(x: {
  origin: string; reservation: unknown; payments: unknown | null; unit: unknown | null;
  statements: { period: string; body: unknown | null }[]; refused: string[];
}): FlowAnswer {
  const r = obj(x.reservation);
  const money = obj(r.money);
  const id = str(r.id);
  const ref = str(r.externalRef) || id;
  const start: FlowLink = {
    type: 'Reservation', number: ref, status: str(r.state), date: str(r.checkIn) || null,
    amountRM: rm(money.gross ?? r.grossBookingValue), url: `${x.origin}/reservations/bookings?view=all&open=${enc(id)}`,
    note: [str(r.guestName), [str(r.propertyName), str(r.unitNumber)].filter(Boolean).join(' '), r.checkIn ? `${str(r.checkIn)} to ${str(r.checkOut)}` : ''].filter(Boolean).join(' · ') || undefined,
  };
  const chain: FlowLink[] = [];
  const notes = [...x.refused];
  for (const d of arr(r.documents)) {
    chain.push({
      type: d.type === 'receipt' ? 'Official receipt' : d.type === 'invoice' ? 'Guest invoice' : str(d.typeLabel) || 'Document',
      number: str(d.docNo), status: d.voidedAt ? `void${d.voidReason ? ` (${str(d.voidReason)})` : ''}` : 'issued',
      date: str(d.issuedAt).slice(0, 10) || null, amountRM: rm(d.amount), url: x.origin + (str(d.pdf) || `/api/guest-documents/${enc(str(d.id))}/pdf`),
    });
  }
  if (x.payments !== null) {
    for (const p of arr(obj(x.payments).data)) {
      chain.push({
        type: str(p.kind) === 'refund' ? 'Refund' : 'Payment', number: str(p.reference) || str(p.id), status: str(p.status),
        date: str(p.receivedOn) || null, amountRM: rm(p.amount), url: start.url, note: [str(p.method), str(p.note)].filter(Boolean).join(' · ') || undefined,
      });
    }
  }
  // GET /api/units/detail answers { unit: { owner }, ... }.
  const owner = unitOwner(x.unit);
  const ownerId = str(owner.id);
  if (ownerId) {
    chain.push({ type: 'Owner', number: str(owner.name) || ownerId, status: '', date: null, amountRM: null, url: `${x.origin}/owners/${enc(ownerId)}` });
    for (const s of x.statements) {
      if (s.body === null) continue;
      const row = arr(obj(s.body).data).find(d => str(d.ownerId) === ownerId && str(d.period) === s.period);
      if (row) {
        chain.push({
          type: 'Owner statement', number: `${str(row.ownerName) || str(owner.name)} ${s.period}`, status: str(row.state),
          date: str(row.periodEnd).slice(0, 10) || null, amountRM: rm(row.netPayout), url: `${x.origin}/finance/statements/${enc(str(row.id))}/report`,
          note: `statement id ${str(row.id)}; get_pdf {type:"statement", id} downloads it`,
        });
      } else {
        notes.push(`No owner statement for ${str(owner.name) || 'the owner'} for ${s.period} yet.`);
      }
    }
  }
  if (!arr(r.documents).length && x.payments !== null) notes.push('No guest invoice or receipt has been issued for this reservation.');
  return { start, chain, notes };
}

/** An owner statement's place in the chain: the owner, the units it covers and the statement itself. */
export function statementFlow(origin: string, statementId: string, report: unknown): FlowAnswer {
  const r = obj(obj(report).data ?? report);
  const owner = obj(r.owner);
  const units = arr(r.units);
  const start: FlowLink = {
    type: 'Owner statement', number: `${str(owner.name)} ${str(r.period)}`.trim(), status: str(r.state), date: str(r.periodEnd).slice(0, 10) || null,
    amountRM: null, url: `${origin}/finance/statements/${enc(statementId)}/report`, note: 'get_pdf {type:"statement", id} downloads it',
  };
  const chain: FlowLink[] = units.map(u => ({
    type: 'Unit', number: str(u.code) || str(u.name), status: '', date: null, amountRM: null,
    url: u.unitId || u.id ? `${origin}/properties/units/${enc(str(u.unitId ?? u.id))}` : start.url,
  }));
  return { start, chain, notes: units.length ? ['The reservations behind each unit\'s figures are listed on the statement report.'] : ['This statement has no report to draw (made before Property OS).'] };
}

/* ---------- PDF download links ---------- */

/** Where connector PDFs are kept in the MEDIA bucket. */
export const EXPORT_PREFIX = 'mcp-exports/';
export const EXPORT_TTL_MS = 15 * 60_000;

async function hmacHex(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`mcp-export|${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  return Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, '0')).join('');
}

/** The query string of a short-lived download link for one stored file. */
export async function signExport(secret: string, key: string, exp: number): Promise<string> {
  return `k=${enc(key)}&e=${exp}&s=${await hmacHex(secret, `${key}|${exp}`)}`;
}

/** 'ok', 'expired', or 'bad' (wrong signature, or not a connector export). Constant-time compare. */
export async function verifyExport(secret: string, key: string, exp: string, sig: string, now: number): Promise<'ok' | 'expired' | 'bad'> {
  if (!secret || !key.startsWith(EXPORT_PREFIX) || key.includes('..') || !/^\d{10,16}$/.test(exp) || !/^[0-9a-f]{64}$/.test(sig)) return 'bad';
  const want = await hmacHex(secret, `${key}|${exp}`);
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return 'bad';
  return Number(exp) > now ? 'ok' : 'expired';
}

/** A file name that is safe in a header and a bucket key. */
export const safeFileName = (s: string) => (s.replace(/[^A-Za-z0-9 ._()-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'document');

/** The IT Hub's 409 for a booking (src/lib/meetings.ts ConflictReply) in one plain sentence, with its suggestion. */
export function conflictText(body: unknown, dir: MeetingDirectory | null): string {
  const b = obj(body);
  const c = obj(b.conflict);
  const parts: string[] = [];
  const room = obj(c.room);
  // vocab-ok: meeting room
  if (room.title || room.organizer) parts.push(`the meeting room is taken by "${str(room.title)}"${room.organizer ? ` (${str(room.organizer)})` : ''}`);
  for (const p of arr(c.people)) {
    const who = dir?.people.find(x => x.key === str(p.key))?.name ?? str(p.key);
    parts.push(`${who} is busy with "${str(obj(p.meeting).title)}"`);
  }
  for (const r of Array.isArray(c.rules) ? c.rules : []) parts.push(str(r));
  const suggest = b.suggestTime ? ` The next free time suggested: ${mytLabel(Date.parse(str(b.suggestTime)))}.` : '';
  const rooms = arr(b.suggestRooms).map(r => str(r.name)).filter(Boolean);
  // vocab-ok: meeting rooms
  const free = rooms.length ? ` Meeting rooms free then: ${rooms.join(', ')}.` : '';
  return `${parts.length ? parts.join('; ') : 'the time is not available'}.${suggest}${free}`;
}

/** The pending-action statements (mcpStore.ts runs them; src/lib/mcpActions.test.mjs runs them on PGlite against the
 *  0380 migration, so single use, lapse and wrong-owner refusals are tested on real SQL). `?` placeholders, as db.ts. */
export const PENDING_SQL = {
  sweep: 'DELETE FROM mcp_pending_actions WHERE used_at IS NULL AND expires_at < ?',
  insert: `INSERT INTO mcp_pending_actions (id, token_id, user_id, kind, payload_json, summary, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  /** args: usedAt, id, tokenId, userId, now */
  consume: `UPDATE mcp_pending_actions SET used_at = ?
      WHERE id = ? AND token_id = ? AND user_id = ? AND used_at IS NULL AND expires_at > ?
      RETURNING id, kind, payload_json, summary, expires_at`,
  /** args: usedAt, id, tokenId, userId */
  cancel: `UPDATE mcp_pending_actions SET used_at = ?, outcome = 'cancelled'
      WHERE id = ? AND token_id = ? AND user_id = ? AND used_at IS NULL RETURNING id`,
  /** args: outcome, result, id */
  finish: 'UPDATE mcp_pending_actions SET outcome = ?, result = ? WHERE id = ?',
  /** args: userId, since */
  countDay: `SELECT count(*)::int AS n FROM mcp_pending_actions
      WHERE user_id = ? AND used_at > ? AND (outcome IS NULL OR outcome <> 'cancelled')`,
};
