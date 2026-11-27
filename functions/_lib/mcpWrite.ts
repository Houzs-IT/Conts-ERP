/**
 * AI Connector round 4b: write actions (owner, 26 Nov 2026, "那些也ok"). The same two steps as propose_meeting /
 * propose_email (mcpActions.ts): a propose_ tool checks everything, reads the record AS THE PERSON and stores one pending
 * action for 10 minutes, writing nothing; confirm_action, after the person said yes in the chat, makes ONE write through
 * the ERP's OWN existing endpoint as that person, so the ERP's own permission check, validation and audit decide.
 *
 *   propose_mail_reply  Mail Center's own Reply (engine POST /api/mail-center/threads/:id/reply) after the Mail Center
 *                       sign-on that Mail Center opens with (POST /api/supply-chain/engine-session, already the one
 *                       sign-on confirm_action may make, for propose_email). Body: { text, afterMessageId } only:
 *                       afterMessageId is the newest message the person was shown, so the engine's reply guard answers
 *                       409 already_replied when a colleague replied in between; `force` is never sent. It never makes
 *                       a mailbox: someone whose Mail Center was never opened (no engine account or no mailbox of
 *                       their own, read-only via GET /api/supply-chain/mail-waiting) is told to open Mail Center first,
 *                       at propose AND again at confirm, before any sign-on.
 *   propose_note        reservation: the drawer's "Staff notes" save, PATCH /api/reservations/:id/details { staffNotes };
 *                       cleaning job: "Notes for the cleaner", PATCH /api/housekeeping/tasks/:id { instructions }. One
 *                       dated line "[Note <date> <name> (via AI Connector): ...]" appended to what is stored at confirm
 *                       time (a colleague's note added in between survives). The middleware fences the body to that
 *                       one key (mcpActions.ts BODY_FENCE).
 *
 * Not offered: a note on a maintenance job (it has no note / comment endpoint: its only free text is the job's own
 * description in the general PATCH, which also re-derives the job's state; not a note, so not used). Never: payouts,
 * invoices, statements, payments, stock, prices, deletes.
 *
 * Each action has its own switch on System > AI Connector (settings mcp.action.<name>, default OFF), effective only while
 * the main "Allow AI actions" switch is on, and needs migration 0396 (the pending table's kind list).
 *
 * Pure apart from `WriteDeps`, so the whole propose -> confirm path is unit-tested with a stand-in ERP
 * (src/lib/mcpWrite.test.mjs). mcpActionTools.ts supplies the real deps.
 */
import { ACTIONS_OFF, MAX_CONFIRMED_PER_DAY, actionBodyAllowed, validConfirmationId, type ActionKind } from './mcpActions';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {});
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object') as Obj[] : []);
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const cut = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const enc = encodeURIComponent;
const SAFE_ID = /^[A-Za-z0-9._-]{1,80}$/;

/* ---------- switches ---------- */

export const WRITE_ACTIONS = ['mail_reply', 'note'] as const;
export type WriteAction = typeof WRITE_ACTIONS[number];
export const WRITE_ACTION_LABELS: Record<WriteAction, string> = {
  mail_reply: 'Reply to Mail Center emails',
  note: 'Add notes to reservations and cleaning jobs',
};
/** The settings key of one action's switch ('1' = on). */
export const writeSettingKey = (a: WriteAction) => `mcp.action.${a}`;
export const actionOffMessage = (a: WriteAction) =>
  `"${WRITE_ACTION_LABELS[a]}" is switched off by your admin. Management can turn it on under AI write actions on System > AI Connector.`;
export const NOT_READY = 'This AI action is not set up on this system yet (its database update, migration 0396, has not been applied).';

export type WriteKind = 'mail_reply' | 'reservation_note' | 'cleaning_note';
export const WRITE_KINDS: readonly WriteKind[] = ['mail_reply', 'reservation_note', 'cleaning_note'];
export const isWriteKind = (k: unknown): k is WriteKind => (WRITE_KINDS as readonly unknown[]).includes(k);
export const switchForKind = (k: WriteKind): WriteAction => (k === 'mail_reply' ? 'mail_reply' : 'note');

/** The ERP endpoint each kind writes through, and the read that gates it (P1 and the propose pre-check use the same
 *  module gate the session middleware applies to that method + path). */
export const WRITE_ROUTES: Record<WriteKind, { method: 'POST' | 'PATCH'; path: (ref: string) => string; label: string }> = {
  mail_reply: { method: 'POST', path: () => '/api/supply-chain/engine-session', label: 'Mail Center: reply' },
  reservation_note: { method: 'PATCH', path: ref => `/api/reservations/${enc(ref)}/details`, label: 'Reservation: staff notes' },
  cleaning_note: { method: 'PATCH', path: ref => `/api/housekeeping/tasks/${enc(ref)}`, label: 'Cleaning job: notes for the cleaner' },
};

/* ---------- notes (pure) ---------- */

export const MAX_NOTE = 500;
/** What each route keeps (it silently cuts longer text, so a note that would not fit is refused instead). */
export const NOTE_CAP: Record<'reservation_note' | 'cleaning_note', number> = { reservation_note: 2000, cleaning_note: 1000 };

/** The note the person asked for: one line, at most MAX_NOTE characters. */
export function noteText(args: Obj): { ok: true; text: string } | { ok: false; error: string } {
  const text = str(args.note ?? args.text).replace(/\s+/g, ' ').trim();
  if (!text) return { ok: false, error: 'Write the note.' };
  if (text.length > MAX_NOTE) return { ok: false, error: `The note is too long (at most ${MAX_NOTE} characters).` };
  return { ok: true, text };
}

/** "[Note 2026-11-27 Lim Wei (via AI Connector): ...]" */
export const noteLine = (text: string, who: string, today: string) => `[Note ${today} ${who.trim() || 'staff'} (via AI Connector): ${text}]`;

/** The stored notes with one line appended, or why it does not fit (the route would cut it). */
export function appendNote(existing: string, line: string, cap: number): { ok: true; value: string } | { ok: false; error: string } {
  const cur = existing.trim();
  const value = cur ? `${cur}\n${line}` : line;
  if (value.length > cap) return { ok: false, error: `The notes would go over ${cap.toLocaleString('en-MY')} characters (the most the ERP keeps). Shorten the note, or tidy the existing notes in the ERP first.` };
  return { ok: true, value };
}

export interface ReservationView { id: string; ref: string; guest: string; unit: string; checkIn: string; checkOut: string; state: string; notes: string }
export function readReservation(v: unknown): ReservationView | null {
  const r = obj(v);
  if (!str(r.id)) return null;
  return {
    id: str(r.id), ref: str(r.externalRef) || str(r.id), guest: str(r.guestName), unit: [str(r.propertyName), str(r.unitNumber)].filter(Boolean).join(' '),
    checkIn: str(r.checkIn).slice(0, 10), checkOut: str(r.checkOut).slice(0, 10), state: str(r.state), notes: str(r.staffNotes),
  };
}

export interface CleaningView { id: string; kind: string; state: string; unit: string; notes: string }
export function readCleaning(v: unknown): CleaningView | null {
  const t = obj(v);
  if (!str(t.id)) return null;
  return { id: str(t.id), kind: str(t.kind).replace(/_/g, ' '), state: str(t.state), unit: [str(t.propertyName), str(t.unitNumber)].filter(Boolean).join(' '), notes: str(t.instructions) };
}

/* ---------- mail reply (pure) ---------- */

export interface WaitingThread { id: string; subject: string; mailbox: string; fromEmail: string; fromName: string; lastAt: string | null; snippet: string; newestMessageId: string | null }

/** GET /api/supply-chain/mail-waiting?list=1 -> 'not_opened' | 'not_listed' (an engine from before ?list=1) | threads. */
export function readWaiting(v: unknown): { kind: 'not_opened'; note: string } | { kind: 'not_listed' } | { kind: 'ok'; threads: WaitingThread[] } {
  const b = obj(v);
  if (b.opened === false || b.count === null) return { kind: 'not_opened', note: str(b.note) };
  if (!Array.isArray(b.threads)) return { kind: 'not_listed' };
  return {
    kind: 'ok',
    threads: arr(b.threads).map(t => ({
      id: str(t.id), subject: str(t.subject) || '(no subject)', mailbox: str(t.mailbox), fromEmail: str(t.fromEmail), fromName: str(t.fromName),
      lastAt: t.lastAt ? str(t.lastAt) : null, snippet: str(t.snippet), newestMessageId: t.newestMessageId ? str(t.newestMessageId) : null,
    })).filter(t => t.id),
  };
}

export const OPEN_MAIL_FIRST = 'Open Mail Center in the ERP first (Mail, once) so your mailbox is set up. The AI Connector never creates a mailbox.';
export const MAX_REPLY = 20_000;

export type MailPayload = { threadId: string; text: string; afterMessageId: string; to: string; subject: string };

/** propose_mail_reply's checks against the waiting threads read as the person. */
export function buildMailReply(args: Obj, threads: WaitingThread[]): { ok: true; payload: MailPayload; summary: string } | { ok: false; error: string; status: number } {
  const id = str(args.thread_id ?? args.threadId).trim();
  const text = str(args.body ?? args.text).replace(/\r\n/g, '\n').trim();
  if (!SAFE_ID.test(id)) return { ok: false, status: 400, error: 'Give thread_id: the threadId of an email waiting for your reply (daily_brief lists them under Mail Center).' };
  if (!text) return { ok: false, status: 400, error: 'Write the reply (body).' };
  if (text.length > MAX_REPLY) return { ok: false, status: 400, error: `The reply is longer than ${MAX_REPLY.toLocaleString('en-MY')} characters.` };
  const t = threads.find(x => x.id === id);
  if (!t) {
    const list = threads.slice(0, 10).map(x => `${x.id} "${cut(x.subject, 60)}" from ${x.fromName || x.fromEmail}`).join('; ');
    return { ok: false, status: 404, error: `That email is not one waiting for your reply (assigned to you, or unassigned in your own mailbox). Only those can be answered from here; open Mail Center for the rest.${list ? ` Waiting for you now: ${list}.` : ' Nothing is waiting for your reply now.'}` };
  }
  if (!t.newestMessageId) return { ok: false, status: 409, error: 'That email cannot be answered from here (its messages could not be checked for a colleague\'s reply). Open it in Mail Center.' };
  const subject = /^re:/i.test(t.subject) ? t.subject : `Re: ${t.subject}`;
  const to = t.fromEmail || t.fromName;
  const summary = [
    'Reply in Mail Center',
    `From: ${t.mailbox || 'the email\'s mailbox'}`,
    `To: ${t.fromName ? `${t.fromName} <${t.fromEmail}>` : t.fromEmail}`,
    `Subject: ${subject}`,
    t.snippet ? `Answering: "${cut(t.snippet, 240)}"` : '',
    '',
    text,
    '',
    'It leaves the company once sent and cannot be called back. If a colleague replies to this email before you confirm, it is NOT sent (Mail Center\'s reply guard). It is kept in the email\'s thread in Mail Center.',
  ].filter((l, i, a) => l !== '' || (i > 0 && a[i - 1] !== '')).join('\n');
  return { ok: true, payload: { threadId: t.id, text, afterMessageId: t.newestMessageId, to, subject: t.subject }, summary };
}

/* ---------- outcomes (pure) ---------- */

const errorOf = (b: unknown, status: number): string => {
  const e = obj(b).error;
  if (e && typeof e === 'object' && typeof obj(e).message === 'string') return str(obj(e).message);
  if (typeof e === 'string') return e;
  return `the request failed (${status})`;
};

/** What the ERP's own route answered, in plain words. A 401 / 403 is the ERP's own refusal, said as such. */
export function describeWrite(kind: WriteKind, status: number, body: unknown, label: string): { ok: boolean; message: string } {
  const b = obj(body);
  if (kind === 'mail_reply') {
    if (status >= 200 && status < 300 && b.ok !== false) {
      return { ok: true, message: b.queued ? `Reply to ${label} queued: the first try did not go through; Mail Center retries it every 5 minutes and the thread shows whether it was delivered.` : `Reply sent to ${label}. It is in the email's thread in Mail Center.` };
    }
    if (status === 409 && b.code === 'already_replied') return { ok: false, message: `Not sent: ${str(b.by) || 'a colleague'} already replied${b.at ? ` at ${str(b.at)}` : ''}. Read their reply in Mail Center first; propose again if you still want to send yours.` };
    if (status === 404) return { ok: false, message: 'Not sent: that email is not in your mailboxes in Mail Center.' };
    if (status === 401 || status === 403) return { ok: false, message: `Not sent: Mail Center refused it for your account (${errorOf(body, status)}).` };
    return { ok: false, message: `Not sent. Mail Center answered: ${errorOf(body, status)}` };
  }
  const what = kind === 'reservation_note' ? `reservation ${label}` : `cleaning job ${label}`;
  if (status >= 200 && status < 300) return { ok: true, message: `Note added to ${what}.` };
  if (status === 401 || status === 403) return { ok: false, message: `Not saved: the ERP refused it for your account (${errorOf(body, status)}).` };
  if (status === 404) return { ok: false, message: `Not saved: ${what} no longer exists.` };
  return { ok: false, message: `Not saved. The ERP answered: ${errorOf(body, status)}` };
}

/* ---------- propose -> confirm, I/O through deps ---------- */

export type ReadValue =
  | { ok: true; status: number; value: unknown }
  | { ok: false; status: number; message: string };
export interface PendingRow { id: string; kind: ActionKind; payload: unknown; summary: string }

export interface WriteDeps {
  userName: string;
  origin: string;
  /** A GET as the person (mcpServer.ts readValue: path gate, in-process GET, credential stripping). */
  read: (path: string, q?: Record<string, unknown>) => Promise<ReadValue>;
  /** The session middleware's own module gate for this method + path and person (access.ts accessFor + refusalFor). */
  canWrite: (method: string, path: string) => Promise<boolean>;
  /** Migrations 0380 + 0396 applied. */
  ready: () => Promise<boolean>;
  mainOn: () => Promise<boolean>;
  switches: () => Promise<Record<WriteAction, boolean>>;
  createPending: (kind: WriteKind, payload: unknown, summary: string) => Promise<{ id: string; expiresAt: string }>;
  peekPending: (id: string) => Promise<ActionKind | null>;
  consumePending: (id: string) => Promise<PendingRow | null>;
  finishPending: (id: string, outcome: 'done' | 'failed', result: string) => Promise<void>;
  confirmedToday: () => Promise<number>;
  /** THE one in-process write as the person: a single-use permit for exactly this method, path and body fence. */
  write: (actionId: string, req: { method: 'PATCH'; path: string; body: Obj; fence: WriteKind }) => Promise<{ status: number; body: unknown }>;
  /** Mail Center: the sign-on (single-use permit), the engine reply, sign out. */
  engineReply: (actionId: string, threadId: string, body: Obj) => Promise<{ status: number; body: unknown }>;
  /** The ERP audit trail (audit_log), as the person. */
  audit: (action: string, entityTable: string, entityId: string, after: Obj) => Promise<void>;
  now: () => number;
}

export type WriteOutcome = { ok: boolean; status: number; target: string; message: string; body?: Obj };

const myToday = (now: number) => new Date(now + 8 * 3600_000).toISOString().slice(0, 10);
const CONFIRM_NOTE = 'Nothing has been done yet. Show this summary to the person and ask them to confirm. Only call confirm_action after they explicitly say yes; otherwise call cancel_action. It lapses in 10 minutes.';

/** Refused before anything is read: not set up, the main switch, the action's own switch. */
async function blockedFor(d: WriteDeps, a: WriteAction): Promise<{ status: number; message: string } | null> {
  if (!(await d.ready())) return { status: 503, message: NOT_READY };
  if (!(await d.mainOn())) return { status: 403, message: ACTIONS_OFF };
  if (!(await d.switches())[a]) return { status: 403, message: actionOffMessage(a) };
  return null;
}

const noAccess = (what: string) => `Not available to your role: your ERP account cannot change ${what}.`;

/** The record a note goes on, by "reservation:<id>" / "cleaning:<id>" (from search), a bare id, or a reservation
 *  reference found with search. Read as the person. */
async function findNoteTarget(d: WriteDeps, kind: 'reservation_note' | 'cleaning_note', raw: string): Promise<{ ok: true; value: unknown } | { ok: false; status: number; message: string }> {
  const q = raw.trim();
  const label = kind === 'reservation_note' ? 'reservation' : 'cleaning job';
  if (!q || q.length > 100) return { ok: false, status: 400, message: `Give the ${label}: ${kind === 'reservation_note' ? 'its reference, or ' : ''}the id from search${kind === 'cleaning_note' ? ' or housekeeping_today' : ''}.` };
  const m = /^(reservation|cleaning):(.+)$/.exec(q);
  if (m && (m[1] === 'reservation') !== (kind === 'reservation_note')) return { ok: false, status: 400, message: `That id is a ${m[1] === 'cleaning' ? 'cleaning job' : 'reservation'}; give target_type "${m[1] === 'cleaning' ? 'cleaning_job' : 'reservation'}".` };
  const api = kind === 'reservation_note' ? '/api/reservations' : '/api/housekeeping/tasks';
  const open = async (id: string) => {
    if (!SAFE_ID.test(id)) return { ok: false as const, status: 400, message: `That ${label} id cannot be read.` };
    const r = await d.read(`${api}/${enc(id)}`);
    if (r.ok) return { ok: true as const, value: r.value };
    return { ok: false as const, status: r.status, message: r.status === 401 || r.status === 403 ? `You don't have access to this ${label}.` : r.status === 404 ? `That ${label} was not found.` : r.message };
  };
  if (m) return open(m[2]);
  if (SAFE_ID.test(q)) {
    const direct = await open(q);
    if (direct.ok || direct.status === 403 || kind === 'cleaning_note') return direct;
  }
  // A reservation reference (or guest name) through the ERP's own search.
  const s = await d.read('/api/search', { q: q.slice(0, 60) });
  if (!s.ok) return { ok: false, status: s.status, message: s.status === 403 ? "You don't have access to reservations." : s.message };
  const hits = (Array.isArray(s.value) ? arr(s.value) : arr(obj(s.value).data)).filter(h => h.kind === 'reservation');
  const exact = hits.filter(h => [h.ref, h.label].some(v => str(v).toLowerCase() === q.toLowerCase()));
  const pick = exact.length === 1 ? exact[0] : hits.length === 1 ? hits[0] : null;
  if (pick) return open(str(pick.id));
  if (hits.length > 1) return { ok: false, status: 409, message: `Several reservations match "${q}": ${hits.slice(0, 6).map(h => `reservation:${str(h.id)} (${[h.label, h.sub, h.ref].map(str).filter(Boolean).join(' · ')})`).join('; ')}. Give one of these ids.` };
  return { ok: false, status: 404, message: `No reservation matches "${q}". Use search first and pass the id it gives.` };
}

/** propose_mail_reply / propose_note: switches -> the ERP's own gate -> read as the person -> validate -> ONE pending
 *  action. Nothing is written to the ERP here. */
export async function proposeWrite(d: WriteDeps, tool: 'propose_mail_reply' | 'propose_note', args: Obj): Promise<WriteOutcome> {
  if (tool === 'propose_mail_reply') {
    const target = 'propose mail_reply';
    const blocked = await blockedFor(d, 'mail_reply');
    if (blocked) return { ok: false, ...blocked, target };
    if (!(await d.canWrite('POST', WRITE_ROUTES.mail_reply.path('')))) return { ok: false, status: 403, target, message: noAccess('Mail Center (the Mail Center sign-on is closed for your access)') };
    const w = await d.read('/api/supply-chain/mail-waiting', { list: '1' });
    if (!w.ok) {
      const msg = w.status === 401 || w.status === 403 ? "You don't have access to Mail Center." : w.status === 501 ? 'Mail Center is not set up on this system.' : `Mail Center could not be read: ${w.message}`;
      return { ok: false, status: w.status, target, message: msg };
    }
    const waiting = readWaiting(w.value);
    if (waiting.kind === 'not_opened') return { ok: false, status: 409, target, message: OPEN_MAIL_FIRST };
    if (waiting.kind === 'not_listed') return { ok: false, status: 502, target, message: 'Mail Center cannot list your waiting emails yet (the supply chain engine needs its update). Reply in Mail Center instead.' };
    const p = buildMailReply(args, waiting.threads);
    if (!p.ok) return { ok: false, status: p.status, target, message: p.error };
    const row = await d.createPending('mail_reply', p.payload, p.summary);
    const { threadId, to } = p.payload;
    // The log line names the thread and the recipient, never the text.
    return { ok: true, status: 200, target: `propose mail_reply: thread ${threadId} to ${cut(to, 60)}`, message: '', body: { confirmationId: row.id, summary: p.summary, expiresAt: row.expiresAt, instruction: CONFIRM_NOTE } };
  }

  const tt = str(args.target_type).trim().toLowerCase();
  const kind: 'reservation_note' | 'cleaning_note' | null = tt === 'reservation' ? 'reservation_note' : tt === 'cleaning_job' || tt === 'cleaning' ? 'cleaning_note' : null;
  const target = `propose ${kind ?? 'note'}`;
  if (!kind) return { ok: false, status: 400, target, message: 'Give target_type "reservation" or "cleaning_job". Maintenance jobs have no notes field in the ERP, so notes cannot be added to them here.' };
  const blocked = await blockedFor(d, 'note');
  if (blocked) return { ok: false, ...blocked, target };
  const t = noteText(args);
  if (!t.ok) return { ok: false, status: 400, target, message: t.error };
  const found = await findNoteTarget(d, kind, str(args.number_or_id ?? args.id));
  if (!found.ok) return { ok: false, status: found.status, target, message: found.message };
  const line = noteLine(t.text, d.userName, myToday(d.now()));
  let summary: string, ref: string, label: string, existing: string;
  if (kind === 'reservation_note') {
    const r = readReservation(found.value);
    if (!r) return { ok: false, status: 502, target, message: 'That reservation could not be read.' };
    ({ id: ref, notes: existing } = r);
    label = r.ref;
    summary = `Add to the staff notes of reservation ${r.ref} (${[r.guest, r.unit, r.checkIn ? `${r.checkIn} to ${r.checkOut}` : '', r.state].filter(Boolean).join(' · ')}):\n"${t.text}"\nIt is added as a new line with today's date and your name, after the notes already there. Staff notes are internal: guests and owners do not see them.`;
  } else {
    const c = readCleaning(found.value);
    if (!c) return { ok: false, status: 502, target, message: 'That cleaning job could not be read.' };
    ({ id: ref, notes: existing } = c);
    label = [c.unit, c.kind].filter(Boolean).join(' ') || c.id;
    summary = `Add to the notes for the cleaner on the cleaning job ${label} (${c.state}):\n"${t.text}"\nIt is added as a new line with today's date and your name, after the notes already there. The cleaner sees it on the job in the field app.`;
  }
  if (!(await d.canWrite('PATCH', WRITE_ROUTES[kind].path(ref)))) return { ok: false, status: 403, target, message: noAccess(kind === 'reservation_note' ? 'reservations' : 'cleaning jobs') };
  const fits = appendNote(existing, line, NOTE_CAP[kind]);
  if (!fits.ok) return { ok: false, status: 400, target, message: fits.error };
  const row = await d.createPending(kind, { ref, text: t.text, label }, summary);
  return { ok: true, status: 200, target: `propose ${kind}: ${cut(label, 80)}`, message: '', body: { confirmationId: row.id, summary, expiresAt: row.expiresAt, instruction: CONFIRM_NOTE } };
}

/** confirm_action for a write kind: not set up / main switch / daily cap / the action's own switch (peeked, so a
 *  switched-off action is refused without using up its confirmation) -> single-use claim -> the body fence -> ONE write
 *  as the person -> outcome, audit. Null when the confirmation is not a write kind (meetings / email go their own way). */
export async function confirmWrite(d: WriteDeps, rawId: string): Promise<WriteOutcome | null> {
  const cid = rawId.trim();
  const target = `confirm ${cid.slice(0, 40)}`;
  if (!validConfirmationId(cid)) return null;
  if (!(await d.ready())) return null;
  const peek = await d.peekPending(cid);
  if (!peek || !isWriteKind(peek)) return null;
  const blocked = await blockedFor(d, switchForKind(peek));
  if (blocked) return { ok: false, ...blocked, target };
  if ((await d.confirmedToday()) >= MAX_CONFIRMED_PER_DAY) return { ok: false, status: 429, target, message: `Not done: the limit of ${MAX_CONFIRMED_PER_DAY} AI actions in 24 hours is reached. Do it in the ERP instead.` };
  const row = await d.consumePending(cid);
  if (!row || !isWriteKind(row.kind)) return { ok: false, status: 404, target, message: 'That confirmation is not open: it was already used or cancelled, lapsed after 10 minutes, or belongs to another connection. Propose it again.' };
  const kind = row.kind;
  const p = obj(row.payload);
  let r: { ok: boolean; message: string; status: number; after?: Obj };
  try {
    r = kind === 'mail_reply' ? await doMailReply(d, row.id, p) : await doNote(d, row.id, kind, p);
  } catch (e) {
    console.error('AI Connector write action failed', kind, e);
    r = { ok: false, status: 500, message: 'Something went wrong on the ERP side; it is not known whether it was done. Check in the ERP before trying again.' };
  }
  await d.finishPending(row.id, r.ok ? 'done' : 'failed', r.message);
  const ref = str(kind === 'mail_reply' ? p.threadId : p.ref);
  if (r.ok) {
    // The connector's own line in the ERP audit trail: who, what kind, which record; never the text itself.
    await d.audit(`ai_connector.${kind}`, kind === 'mail_reply' ? 'email_threads' : kind === 'reservation_note' ? 'reservations' : 'tasks', ref, { via: 'AI Connector', confirmationId: row.id, ...(r.after ?? {}) }).catch(e => console.error('AI Connector audit failed', e));
  }
  return { ok: r.ok, status: r.ok ? 200 : r.status, target: `confirm ${kind}: ${cut(kind === 'mail_reply' ? `thread ${ref} to ${str(p.to)}` : str(p.label) || ref, 100)}`, message: r.message };
}

async function doNote(d: WriteDeps, actionId: string, kind: 'reservation_note' | 'cleaning_note', p: Obj): Promise<{ ok: boolean; message: string; status: number; after?: Obj }> {
  const ref = str(p.ref);
  const label = str(p.label) || ref;
  if (!SAFE_ID.test(ref)) return { ok: false, status: 400, message: 'Not saved: the record id is not valid.' };
  // Appended to what is stored NOW (read as the person), so a note added since the proposal survives.
  const api = kind === 'reservation_note' ? '/api/reservations' : '/api/housekeeping/tasks';
  const cur = await d.read(`${api}/${enc(ref)}`);
  if (!cur.ok) return { ok: false, status: cur.status, message: cur.status === 401 || cur.status === 403 ? `Not saved: the ERP refused it for your account (${cur.message}).` : `Not saved: the record could not be read now (${cur.message}).` };
  const existing = kind === 'reservation_note' ? readReservation(cur.value)?.notes : readCleaning(cur.value)?.notes;
  if (existing === undefined) return { ok: false, status: 502, message: 'Not saved: the record could not be read now.' };
  const fits = appendNote(existing, noteLine(str(p.text), d.userName, myToday(d.now())), NOTE_CAP[kind]);
  if (!fits.ok) return { ok: false, status: 400, message: `Not saved: ${fits.error}` };
  const body = kind === 'reservation_note' ? { staffNotes: fits.value } : { instructions: fits.value };
  if (!actionBodyAllowed(kind, body)) return { ok: false, status: 400, message: 'Not done: blocked by the AI Connector\'s write fence.' };
  const res = await d.write(actionId, { method: 'PATCH', path: WRITE_ROUTES[kind].path(ref), body, fence: kind });
  const out = describeWrite(kind, res.status, res.body, label);
  return { ...out, status: res.status, after: { noteChars: str(p.text).length } };
}

async function doMailReply(d: WriteDeps, actionId: string, p: Obj): Promise<{ ok: boolean; message: string; status: number; after?: Obj }> {
  const threadId = str(p.threadId);
  if (!SAFE_ID.test(threadId) || !str(p.afterMessageId)) return { ok: false, status: 400, message: 'Not sent: the email to answer is not valid. Propose it again.' };
  // Never a new mailbox: Mail Center must already be open for this person (read-only check) BEFORE the sign-on, which
  // would otherwise give a first-time person a mailbox.
  const w = await d.read('/api/supply-chain/mail-waiting');
  if (!w.ok) return { ok: false, status: w.status, message: w.status === 401 || w.status === 403 ? 'Not sent: your account does not have access to Mail Center.' : `Not sent: Mail Center could not be checked (${w.message}).` };
  if (readWaiting(w.value).kind === 'not_opened') return { ok: false, status: 409, message: `Not sent. ${OPEN_MAIL_FIRST}` };
  const body = { text: str(p.text), afterMessageId: str(p.afterMessageId) };
  if (!actionBodyAllowed('mail_reply', body)) return { ok: false, status: 400, message: 'Not done: blocked by the AI Connector\'s write fence.' };
  const res = await d.engineReply(actionId, threadId, body);
  const out = describeWrite('mail_reply', res.status, res.body, str(p.to));
  const rb = obj(res.body);
  return { ...out, status: res.status, after: { to: str(p.to), subject: cut(str(p.subject), 120), messageId: str(rb.messageId) || null, queued: rb.queued === true } };
}

/* ---------- tool definitions ---------- */

const ACT = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const CONFIRM_DESC = 'It does NOT change anything: it checks everything and returns a summary and a confirmationId. Show this summary to the person and ask them to confirm. Only call confirm_action after they explicitly say yes.';

export const WRITE_TOOLS = [
  {
    name: 'propose_mail_reply', title: 'Propose a Mail Center reply (needs confirmation)',
    description: `Prepare a reply to an email waiting for the person's reply in Mail Center (assigned to them, or unassigned in their own mailbox; daily_brief lists them with their threadId), from that email's mailbox to its sender. ${CONFIRM_DESC} If a colleague replies first it is not sent. Only when management switched it on.`,
    inputSchema: {
      type: 'object',
      properties: {
        thread_id: { type: 'string', description: 'The threadId from daily_brief (Mail Center: emails waiting for your reply).' },
        body: { type: 'string', description: 'The reply, plain text.' },
      },
      required: ['thread_id', 'body'], additionalProperties: false,
    },
    annotations: ACT,
  },
  {
    name: 'propose_note', title: 'Propose a note on a reservation or cleaning job (needs confirmation)',
    description: `Prepare a note: on a reservation (its internal Staff notes) or a cleaning job (its notes for the cleaner), as a new dated line with the person's name. ${CONFIRM_DESC} Maintenance jobs have no notes field. Only when management switched it on.`,
    inputSchema: {
      type: 'object',
      properties: {
        target_type: { type: 'string', enum: ['reservation', 'cleaning_job'] },
        number_or_id: { type: 'string', description: 'A reservation reference, or an id from search / housekeeping_today ("reservation:..." / "cleaning:...").' },
        note: { type: 'string', description: `The note, one short paragraph (at most ${MAX_NOTE} characters).` },
      },
      required: ['target_type', 'number_or_id', 'note'], additionalProperties: false,
    },
    annotations: { ...ACT, openWorldHint: false },
  },
];
