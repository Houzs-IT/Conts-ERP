/**
 * AI Connector tools added 26 Nov 2026 (owner): the confirm-first actions (propose_meeting, propose_email,
 * confirm_action, cancel_action), document_flow and get_pdf. Called from mcpServer.ts callTool, which logs every call in
 * mcp_calls. The pure rules (validation, the write fence, flow shaping, signed links) are in mcpActions.ts.
 *
 * Every read here goes through the same readValue as erp_get (path gate, in-process GET as the person, credential
 * stripping). The only writes are confirm_action's, through the ERP's own endpoints as the person, fenced by
 * ACTION_ALLOWLIST and a single-use permit (mcpActions.ts, mcpInner.ts, functions/api/_middleware.ts).
 */
import { type Env, mytToday } from './db';
import { MCP_ACTION_HEADER, MCP_INNER_HEADER, grantActionPermit, mcpInnerSecret } from './mcpInner';
import { dispatchRequest } from './mcpDispatch';
import { scmEngineConfigured } from './scmEngine';
import {
  ACTIONS_OFF, EXPORT_PREFIX, EXPORT_TTL_MS, MAX_CONFIRMED_PER_DAY, conflictText, proposeEmail, proposeMeeting, reservationFlow, safeFileName,
  signExport, statementFlow, stayMonths, unitOwner, validConfirmationId, type EmailPayload, type MeetingDirectory, type MeetingPayload,
} from './mcpActions';
import { parseFetchId } from './mcpQuick';
import {
  actionsEnabled, cancelPendingAction, confirmedInLastDay, consumePendingAction, createPendingAction, finishPendingAction, mcpActionsReady,
  randomToken, type McpIdentity,
} from './mcpStore';

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };
const text = (t: string, isError = false): ToolResult => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });
export type Outcome = { result: ToolResult; status: number; note: string; target: string };
const done = (body: unknown, target: string, note = ''): Outcome => ({ result: text(typeof body === 'string' ? body : JSON.stringify(body)), status: 200, note, target });
const refuse = (msg: string, status: number, target: string, note = ''): Outcome => ({ result: text(msg, true), status, note: note || msg.slice(0, 120), target });

export type ReadValue =
  | { ok: true; status: number; value: unknown; removed: string[]; target: string }
  | { ok: false; status: number; message: string; note: string; target: string };

export interface ToolCtx {
  request: Request; env: Env; waitUntil: (p: Promise<unknown>) => void; id: McpIdentity; token: string; origin: string;
  read: (path: string, q?: Record<string, unknown>) => Promise<ReadValue>;
}

export const ACTION_TOOL_NAMES = ['propose_meeting', 'propose_email', 'confirm_action', 'cancel_action', 'document_flow', 'get_pdf'];

const CONFIRM_NOTE = 'Show this summary to the person and ask them to confirm. Only call confirm_action after they explicitly say yes. It lapses in 10 minutes.';
const enc = encodeURIComponent;

/** One request through the API in-process as the person (mcpDispatch.ts). A write carries the action id the middleware
 *  needs a permit for; nothing else can make one. */
async function inner(c: ToolCtx, method: 'GET' | 'POST', path: string, o: { body?: unknown; actionId?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${c.token}`, [MCP_INNER_HEADER]: mcpInnerSecret(), accept: 'application/json', 'user-agent': 'Conts AI Connector',
  };
  if (o.actionId) { headers[MCP_ACTION_HEADER] = o.actionId; headers['idempotency-key'] = `mcp-${o.actionId}`; }
  if (o.body !== undefined) headers['content-type'] = 'application/json';
  return dispatchRequest(new Request(c.origin + path, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) }), c.env, c.waitUntil);
}

const errorOf = (b: unknown, status: number): string => {
  const e = (b as { error?: unknown } | null)?.error;
  if (e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string') return (e as { message: string }).message;
  if (typeof e === 'string') return e;
  return `the request failed (${status})`;
};

/** Actions are possible only with migration 0380 and the owner's switch on. Null: go ahead. */
async function actionsBlocked(c: ToolCtx, target: string): Promise<Outcome | null> {
  if (!(await mcpActionsReady(c.env))) return refuse('AI actions are not set up on this system yet (its database update, migration 0380, has not been applied).', 503, target, 'not set up');
  if (!(await actionsEnabled(c.env))) return refuse(ACTIONS_OFF, 403, target, 'actions off');
  return null;
}

async function proposeMeetingTool(c: ToolCtx, args: Record<string, unknown>): Promise<Outcome> {
  const blocked = await actionsBlocked(c, 'meeting');
  if (blocked) return blocked;
  // The Meetings page's own directory, read as the person: who they can invite and the meeting rooms.
  const b = await c.read('/api/meetings/bootstrap');
  if (!b.ok) return refuse(b.status === 501 ? 'Meetings is not connected on this system yet.' : b.message, b.status, 'meeting', b.note);
  const dir = b.value as MeetingDirectory;
  if (!dir || typeof dir.me !== 'string' || !Array.isArray(dir.people) || !Array.isArray(dir.rooms)) return refuse('Meetings answered in a way this connector does not understand.', 502, 'meeting');
  const p = proposeMeeting(args, dir, Date.now());
  if (!p.ok) return refuse(`Nothing was booked. Fix this first:\n- ${p.problems.join('\n- ')}`, 400, 'meeting', 'invalid');
  const row = await createPendingAction(c.env, { tokenId: c.id.tokenId, userId: c.id.user.id, kind: 'meeting', payload: p.payload, summary: p.summary });
  return done({ confirmationId: row.id, summary: p.summary, expiresAt: row.expiresAt, instruction: CONFIRM_NOTE }, `propose ${p.target}`);
}

async function proposeEmailTool(c: ToolCtx, args: Record<string, unknown>): Promise<Outcome> {
  const blocked = await actionsBlocked(c, 'email');
  if (blocked) return blocked;
  if (!scmEngineConfigured(c.env)) return refuse('Mail Center is not set up on this system.', 501, 'email');
  const p = proposeEmail(args, c.id.user.email);
  if (!p.ok) return refuse(`Nothing was sent. Fix this first:\n- ${p.problems.join('\n- ')}`, 400, 'email', 'invalid');
  const row = await createPendingAction(c.env, { tokenId: c.id.tokenId, userId: c.id.user.id, kind: 'email', payload: p.payload, summary: p.summary });
  // The log line names the recipients and subject, never the body.
  return done({ confirmationId: row.id, summary: p.summary, expiresAt: row.expiresAt, instruction: CONFIRM_NOTE }, `propose ${p.target}`);
}

/** Books the confirmed meeting through POST /api/meetings/meetings, exactly as the Meetings page's Book button. */
async function bookMeeting(c: ToolCtx, actionId: string, meeting: MeetingPayload): Promise<{ ok: boolean; message: string }> {
  grantActionPermit(actionId, { userId: c.id.user.id, method: 'POST', path: '/api/meetings/meetings' });
  const res = await inner(c, 'POST', '/api/meetings/meetings', { body: meeting, actionId });
  const b = await res.json().catch(() => null) as { ids?: unknown[]; created?: number } | null;
  if (res.ok) {
    const ids = (b?.ids ?? []).map(String);
    return { ok: true, message: `Booked "${meeting.title}"${ids.length ? ` (meeting ${ids.join(', ')})` : ''}. Everyone invited was notified as usual. Open it: ${c.origin}/system/meetings` };
  }
  if (res.status === 409) {
    const dir = await c.read('/api/meetings/bootstrap');
    return { ok: false, message: `Not booked: ${conflictText(b, dir.ok ? dir.value as MeetingDirectory : null)} Propose a new time to try again.` };
  }
  return { ok: false, message: `Not booked. Meetings answered: ${errorOf(b, res.status)}` };
}

/** Sends the confirmed email through Mail Center's Compose as the person: the Mail Center sign-on (engine-session, the
 *  same one the Mail Center screen opens with), then POST /api/mail-center/compose on the engine, which applies the
 *  person's mailbox access (who may send from which mailbox) and keeps it in the mailbox's Sent history. The engine
 *  session is signed out straight after. */
async function sendEmail(c: ToolCtx, actionId: string, mail: EmailPayload): Promise<{ ok: boolean; message: string }> {
  if (!scmEngineConfigured(c.env)) return { ok: false, message: 'Not sent: Mail Center is not set up on this system.' };
  grantActionPermit(actionId, { userId: c.id.user.id, method: 'POST', path: '/api/supply-chain/engine-session' });
  const s = await inner(c, 'POST', '/api/supply-chain/engine-session', { actionId });
  const sb = await s.json().catch(() => null) as { token?: string; sessionPass?: string | null } | null;
  if (!s.ok || !sb?.token) return { ok: false, message: `Not sent: Mail Center did not open for your account (${errorOf(sb, s.status)}).` };
  const api = c.env.SCM_ENGINE_API!.replace(/\/+$/, '');
  const auth: Record<string, string> = { authorization: `Bearer ${sb.token}`, ...(sb.sessionPass ? { 'x-session-pass': sb.sessionPass } : {}) };
  try {
    const res = await fetch(`${api}/api/mail-center/compose`, {
      method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(mail), signal: AbortSignal.timeout(25_000),
    });
    const b = await res.json().catch(() => null) as { ok?: boolean; threadId?: string; error?: unknown } | null;
    if (res.ok && b?.ok) return { ok: true, message: `Sent from ${mail.fromAddress} to ${mail.to.join(', ')}${mail.cc.length ? ` (cc ${mail.cc.join(', ')})` : ''}: "${mail.subject}". It is in the mailbox's Sent history in Mail Center.` };
    return { ok: false, message: `Not sent. Mail Center answered: ${typeof b?.error === 'string' ? b.error : `the request failed (${res.status})`}` };
  } catch {
    return { ok: false, message: 'Mail Center could not be reached, so it is not known whether the email went. Check the mailbox\'s Sent history in Mail Center before trying again.' };
  } finally {
    c.waitUntil(fetch(`${api}/api/auth/logout`, { method: 'POST', headers: auth, signal: AbortSignal.timeout(10_000) }).catch(() => undefined));
  }
}

async function confirmTool(c: ToolCtx, args: Record<string, unknown>): Promise<Outcome> {
  const cid = String(args.confirmationId ?? '').trim();
  const target = `confirm ${cid.slice(0, 40)}`;
  if (!validConfirmationId(cid)) return refuse('Give the confirmationId a propose_ tool returned.', 400, target, 'invalid');
  const blocked = await actionsBlocked(c, target);
  if (blocked) return blocked;
  if ((await confirmedInLastDay(c.env, c.id.user.id)) >= MAX_CONFIRMED_PER_DAY) {
    return refuse(`Not done: the limit of ${MAX_CONFIRMED_PER_DAY} AI actions in 24 hours is reached. Do it in the ERP instead.`, 429, target, 'daily limit');
  }
  const row = await consumePendingAction(c.env, cid, c.id.tokenId, c.id.user.id);
  if (!row) return refuse('That confirmation is not open: it was already used or cancelled, lapsed after 10 minutes, or belongs to another connection. Propose it again.', 404, target, 'not open');
  const first = row.summary.split('\n')[0].slice(0, 120);
  const t = `confirm ${row.kind}: ${row.kind === 'email' ? targetOfEmail(row.payload as EmailPayload) : first}`;
  let r: { ok: boolean; message: string };
  try {
    r = row.kind === 'meeting' ? await bookMeeting(c, row.id, row.payload as MeetingPayload)
      : row.kind === 'email' ? await sendEmail(c, row.id, row.payload as EmailPayload)
        : { ok: false, message: 'Unknown action.' };
  } catch (e) {
    console.error('AI Connector action failed', row.kind, e);
    r = { ok: false, message: 'Something went wrong on the ERP side; it is not known whether it was done. Check in the ERP before trying again.' };
  }
  await finishPendingAction(c.env, row.id, r.ok ? 'done' : 'failed', r.message);
  return r.ok ? done({ done: true, message: r.message }, t) : refuse(r.message, 422, t, 'action failed');
}

const targetOfEmail = (p: EmailPayload) => `to ${p.to?.[0] ?? '?'}${(p.to?.length ?? 0) + (p.cc?.length ?? 0) > 1 ? ` +${p.to.length + p.cc.length - 1}` : ''}, "${String(p.subject ?? '').slice(0, 60)}"`;

async function cancelTool(c: ToolCtx, args: Record<string, unknown>): Promise<Outcome> {
  const cid = String(args.confirmationId ?? '').trim();
  const target = `cancel ${cid.slice(0, 40)}`;
  if (!validConfirmationId(cid)) return refuse('Give the confirmationId to cancel.', 400, target, 'invalid');
  if (!(await mcpActionsReady(c.env))) return refuse('AI actions are not set up on this system yet.', 503, target);
  const ok = await cancelPendingAction(c.env, cid, c.id.tokenId, c.id.user.id);
  return ok ? done({ cancelled: true, message: 'Cancelled. Nothing was done.' }, target) : refuse('That confirmation is not open (already used, cancelled or another connection\'s). Nothing was done.', 404, target, 'not open');
}

/* ---------- document flow ---------- */

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const rows = (v: unknown): Record<string, unknown>[] => {
  const a = Array.isArray(v) ? v : Array.isArray(obj(v).data) ? obj(v).data as unknown[] : [];
  return a.filter(x => x && typeof x === 'object') as Record<string, unknown>[];
};

async function flowOfReservation(c: ToolCtx, rid: string): Promise<Outcome> {
  const target = `flow reservation:${rid}`;
  const r = await c.read(`/api/reservations/${enc(rid)}`);
  if (!r.ok) return refuse(r.status === 404 ? 'That reservation was not found, or your account cannot see it.' : r.message, r.status, target, r.note);
  const res = obj(r.value);
  const refused: string[] = [];
  const [pay, unit] = await Promise.all([
    c.read(`/api/reservations/${enc(rid)}/payments`),
    res.unitId ? c.read('/api/units/detail', { unitId: String(res.unitId) }) : Promise.resolve(null),
  ]);
  if (!pay.ok) refused.push(pay.status === 403 ? 'Payments, invoices and receipts are not available to your role.' : `Payments could not be read: ${pay.message}`);
  if (unit && !unit.ok) refused.push(`The unit and its owner are not available: ${unit.message}`);
  const owner = unit?.ok ? unitOwner(unit.value) : {};
  const ownerName = String(owner.name ?? '');
  const statements: { period: string; body: unknown | null }[] = [];
  if (owner.id) {
    const months = stayMonths(String(res.checkIn ?? ''), String(res.checkOut ?? ''));
    const got = await Promise.all(months.map(m => c.read('/api/statements', { period: m, q: ownerName, pageSize: 50 })));
    got.forEach((g, i) => statements.push({ period: months[i], body: g.ok ? g.value : null }));
    const no = got.find(g => !g.ok);
    if (no && !no.ok) refused.push(no.status === 403 ? 'Owner statements are not available to your role.' : `Owner statements could not be read: ${no.message}`);
  }
  const flow = reservationFlow({ origin: c.origin, reservation: res, payments: pay.ok ? pay.value : null, unit: unit?.ok ? unit.value : null, statements, refused });
  return done({ ...flow, moneyIn: 'RM' }, target);
}

async function documentFlowTool(c: ToolCtx, args: Record<string, unknown>): Promise<Outcome> {
  const q = String(args.number_or_id ?? args.id ?? args.number ?? '').trim().slice(0, 100);
  if (!q) return refuse('Give a reservation reference, a guest invoice or receipt number, or an id from search.', 400, 'flow', 'invalid');
  const f = parseFetchId(q);
  if (f?.kind === 'reservation') return flowOfReservation(c, f.rowId);
  if (f?.kind === 'statement') {
    const r = await c.read(`/api/statements/${enc(f.rowId)}/report`);
    if (!r.ok) return refuse(r.message, r.status, `flow ${q}`, r.note);
    return done({ ...statementFlow(c.origin, f.rowId, r.value), moneyIn: 'RM' }, `flow ${q}`);
  }
  if (f) return refuse(`document_flow follows reservations, guest invoices and receipts, and owner statements. A ${f.kind.replace(/_/g, ' ')} has no chain here; open it with fetch or the link search gave. Supply chain documents (sales orders, purchasing, delivery) show their linked documents on their own screen in Supply chain.`, 400, `flow ${q}`, 'no chain');

  // A guest invoice or receipt number (finance only), else a reservation found by search.
  const docs = await c.read('/api/guest-documents', { q, pageSize: 5 });
  const doc = docs.ok ? rows(docs.value).find(d => String(d.docNo ?? '').toLowerCase() === q.toLowerCase()) : undefined;
  if (doc?.reservationId) return flowOfReservation(c, String(doc.reservationId));
  const s = await c.read('/api/search', { q });
  if (!s.ok) return refuse(s.message, s.status, `flow ${q}`, s.note);
  const hits = rows(s.value).filter(h => h.kind === 'reservation');
  const exact = hits.filter(h => [h.ref, h.label].some(v => String(v ?? '').toLowerCase() === q.toLowerCase()));
  const pick = exact.length === 1 ? exact[0] : hits.length === 1 ? hits[0] : null;
  if (pick) return flowOfReservation(c, String(pick.id));
  if (hits.length > 1) return done({ found: 'several', message: 'Several reservations match. Call document_flow again with one of these ids.', choices: hits.slice(0, 10).map(h => ({ id: `reservation:${String(h.id)}`, title: [h.label, h.sub, h.ref].filter(Boolean).join(' · ') })) }, `flow ${q}`, 'several');
  return refuse('No reservation, guest invoice or receipt matches that. Try search first, then pass the id it gives (e.g. "reservation:abc123" or "statement:xyz").', 404, `flow ${q}`, 'not found');
}

/* ---------- PDFs ---------- */

/** The company logo for the statement letterhead, as PNG bytes (the generator draws PNG only), or null. */
async function logoPng(origin: string, src: string): Promise<Uint8Array | null> {
  try {
    let bytes: Uint8Array;
    const data = /^data:image\/png;base64,(.+)$/i.exec(src);
    if (data) bytes = Uint8Array.from(atob(data[1]), ch => ch.charCodeAt(0));
    else if (/^https:\/\//i.test(src) || src.startsWith('/')) {
      const r = await fetch(src.startsWith('/') ? origin + src : src, { signal: AbortSignal.timeout(4000) });
      if (!r.ok) return null;
      bytes = new Uint8Array(await r.arrayBuffer());
    } else return null;
    return bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 ? bytes : null;
  } catch { return null; }
}

/** Malaysian numbers as dialled at home, others international (OwnerIncomeReportPage printedPhone). */
async function printedPhoneFn(): Promise<(raw: string | null) => string> {
  const { parsePhone } = await import('../../src/lib/phone');
  return (raw) => {
    const p = parsePhone(raw);
    if (!p?.possible) return (raw ?? '').trim();
    return p.callingCode === '60' ? `0${p.national}` : p.international;
  };
}

async function getPdfTool(c: ToolCtx, args: Record<string, unknown>): Promise<Outcome> {
  const type = String(args.type ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const raw = String(args.id ?? '').trim();
  const rid = parseFetchId(raw)?.rowId ?? raw;
  const target = `pdf ${type}:${rid.slice(0, 80)}`;
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(rid)) return refuse('Give the document id (from document_flow or search).', 400, target, 'invalid');

  if (type === 'statement' || type === 'owner_statement') {
    // Read as the person first: the report endpoint's own checks decide, as for the Download button.
    const r = await c.read(`/api/statements/${enc(rid)}/report`);
    if (!r.ok) return refuse(r.message, r.status, target, r.note);
    const report = obj(r.value).data as { units?: unknown[]; owner?: { name?: string }; period?: string; settings?: { company?: { logo?: string } } } | undefined;
    if (!report || !Array.isArray(report.units)) return refuse('That statement could not be read.', 502, target);
    if (!report.units.length) {
      return done({ url: `${c.origin}/api/statements/${enc(rid)}/pdf`, how: 'This statement was made before Property OS and has no report to draw as a PDF. Open this link while signed in to the ERP and press Print / Save as PDF.' }, target, 'print page');
    }
    if (!c.env.MEDIA) return refuse('File storage is not set up on this system, so no download link can be made. Open the statement in the ERP and press Download.', 501, target);
    const { statementPdf } = await import('../../src/lib/statementPdf');
    const bytes = await statementPdf(report as never, { logo: await logoPng(c.origin, String(report.settings?.company?.logo ?? '')), phone: await printedPhoneFn() });
    const exp = Date.now() + EXPORT_TTL_MS;
    const name = safeFileName(`Owner statement ${report.owner?.name ?? ''} ${report.period ?? ''}`);
    const key = `${EXPORT_PREFIX}${mytToday()}/${randomToken(12)}/${name}.pdf`;
    await c.env.MEDIA.put(key, bytes, { httpMetadata: { contentType: 'application/pdf' }, customMetadata: { userId: c.id.user.id, expiresAt: new Date(exp).toISOString() } });
    return done({
      url: `${c.origin}/api/mcp/export?${await signExport(c.env.SESSION_SECRET, key, exp)}`, fileName: `${name}.pdf`, expiresAt: new Date(exp).toISOString(),
      how: 'A download link for the PDF, the same one the Owners page draws, valid for 15 minutes. Give the person the link.',
    }, target);
  }
  if (type === 'guest_document' || type === 'invoice' || type === 'receipt') {
    // Issued guest invoices and receipts are print pages made in the browser (no server-side PDF): check the person may
    // open it, then hand them the link.
    const res = await inner(c, 'GET', `/api/guest-documents/${enc(rid)}/pdf`);
    if (res.status === 401 || res.status === 403) return refuse('Not available to your role: guest invoices and receipts are for people with Finance access.', res.status, target, 'no access');
    if (!res.ok) return refuse(res.status === 404 ? 'That invoice or receipt was not found.' : `The ERP answered ${res.status}.`, res.status, target);
    return done({ url: `${c.origin}/api/guest-documents/${enc(rid)}/pdf`, how: 'This invoice or receipt is a print page, made in the browser. Open the link while signed in to the ERP and press Print / Save as PDF.' }, target, 'print page');
  }
  return refuse('get_pdf makes "statement" (owner statement, a real PDF file) and "guest_document" (a guest invoice or official receipt, as a print page). Other documents: open them in the ERP and use its Print / Download button.', 400, target, 'unknown type');
}

/** One of the tools above, or null when `name` is not one of them. */
export async function runActionTool(name: string, args: Record<string, unknown>, c: ToolCtx): Promise<Outcome | null> {
  switch (name) {
    case 'propose_meeting': return proposeMeetingTool(c, args);
    case 'propose_email': return proposeEmailTool(c, args);
    case 'confirm_action': return confirmTool(c, args);
    case 'cancel_action': return cancelTool(c, args);
    case 'document_flow': return documentFlowTool(c, args);
    case 'get_pdf': return getPdfTool(c, args);
    default: return null;
  }
}

const ACT = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const RO = { readOnlyHint: true, openWorldHint: false };
const CONFIRM_DESC = 'It does NOT book or send anything: it checks everything and returns a summary and a confirmationId. Show this summary to the person and ask them to confirm. Only call confirm_action after they explicitly say yes.';

export const ACTION_TOOLS = [
  {
    name: 'propose_meeting', title: 'Propose a meeting (needs confirmation)',
    description: `Prepare a meeting in the person's name in Meetings (shared by every company). ${CONFIRM_DESC}`,
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        start: { type: 'string', description: 'Date and time, e.g. "2026-11-27 14:00" (Malaysia time) or ISO with an offset.' },
        end: { type: 'string', description: 'Optional; default one hour after start.' },
        attendees: { type: 'array', items: { type: 'string' }, description: 'Staff names or emails from the Meetings directory; any other email is invited as an outside guest.' },
        // vocab-ok: meeting room
        room: { type: 'string', description: 'Optional meeting room name.' },
        notes: { type: 'string' },
      },
      required: ['title', 'start'], additionalProperties: false,
    },
    annotations: ACT,
  },
  {
    name: 'propose_email', title: 'Propose an email (needs confirmation)',
    description: `Prepare an email from a Mail Center mailbox the person may send from. ${CONFIRM_DESC} Once sent it leaves the company and cannot be called back.`,
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'array', items: { type: 'string' } },
        cc: { type: 'array', items: { type: 'string' } },
        subject: { type: 'string' },
        body: { type: 'string', description: 'Plain text.' },
        from_mailbox: { type: 'string', description: 'The Mail Center mailbox address to send from. Default: the person\'s own email.' },
      },
      required: ['to', 'subject', 'body'], additionalProperties: false,
    },
    annotations: ACT,
  },
  {
    name: 'confirm_action', title: 'Do a confirmed action',
    description: 'Book the meeting or send the email a propose_ tool prepared. ONLY call this after the person has seen the summary and explicitly said yes in this conversation. Works once; lapses 10 minutes after the proposal.',
    inputSchema: { type: 'object', properties: { confirmationId: { type: 'string' } }, required: ['confirmationId'], additionalProperties: false },
    annotations: ACT,
  },
  {
    name: 'cancel_action', title: 'Cancel a proposed action',
    description: 'Drop a proposal the person does not want. Nothing is booked or sent.',
    inputSchema: { type: 'object', properties: { confirmationId: { type: 'string' } }, required: ['confirmationId'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'document_flow', title: 'Document flow',
    description: 'The chain of documents around a reservation: the reservation, its guest invoice and official receipts, the payments recorded, the unit\'s owner and the owner statement(s) for the months of the stay; or an owner statement with its units. Give a reservation reference, an invoice or receipt number, or an id from search ("reservation:..." / "statement:..."). Each link has type, number, status, date, amount (RM) and its ERP link.',
    inputSchema: { type: 'object', properties: { number_or_id: { type: 'string' } }, required: ['number_or_id'], additionalProperties: false },
    annotations: RO,
  },
  {
    name: 'get_pdf', title: 'Get a PDF',
    description: 'A document as a PDF: type "statement" (owner statement: a download link valid 15 minutes, the same PDF the Owners page makes) or "guest_document" (guest invoice or official receipt: the ERP print page to Save as PDF). Only documents the person may open.',
    inputSchema: {
      type: 'object',
      properties: { type: { type: 'string', enum: ['statement', 'guest_document'] }, id: { type: 'string', description: 'The statement or document id (from document_flow or search).' } },
      required: ['type', 'id'], additionalProperties: false,
    },
    annotations: RO,
  },
];
