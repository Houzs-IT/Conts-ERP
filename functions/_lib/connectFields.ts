/**
 * Houzs Connect contact push — the pure parts (no DB, no fetch), so Node can load this
 * file for tests (type stripping only; no enums / parameter properties). The DB and HTTP
 * sides live in connect.ts, which re-exports everything here.
 *
 * Connect (chat.houzscentury.com) sends The Conts' guest WhatsApp templates. The ERP's only
 * job is to keep each guest's Connect contact (name + attributes) current, then name the
 * automation to fire. The template bodies + variable bindings live in Connect, not here.
 * See docs/superpowers/plans/2026-11-14-connect-guest-messaging.md and the integration spec.
 */

/** The hyphenated slug is the ONLY reliable company selector on the webhook. Omit it (or get it
 *  wrong) and every pushed contact falls into Houzs Century's list, not The Conts'. Never change. */
export const CONNECT_COMPANY_SLUG = 'the-conts';

/** Default Connect server if CONNECT_WEBHOOK_URL is unset (same idea as channexServer's fallback). */
export const CONNECT_DEFAULT_URL = 'https://chat.houzscentury.com';

/** The ten contact-field keys configured for The Conts in Connect. Values are all single-line
 *  strings; a template that doesn't reference a key simply ignores it. Keys must match exactly —
 *  a typo silently renders as "-" in the guest's message. */
export const CONNECT_FIELD_KEYS = [
  'unit_no', 'mailbox', 'mailbox_no', 'mailbox_passcode',
  'maindoor', 'maindoor2', 'wifi', 'wifi_username', 'checkin_date', 'checkout_date',
] as const;
export type ConnectFieldKey = typeof CONNECT_FIELD_KEYS[number];

/**
 * The one place the access_credentials `kind` → Connect field mapping lives, so it is trivial to
 * adjust once CS/ops confirm the ⚑ rows. Each entry pulls from one credential column:
 *   - `secret` = the code itself (door PIN, Wi-Fi password, mailbox passcode) — sensitive.
 *   - `label`  = the human name (SSID, mailbox number) — not sensitive.
 * For a given Connect key the FIRST matching credential (most recently updated — see the ORDER BY
 * in connect.ts) with a non-empty source value wins. `kinds` lists which credential kinds feed it;
 * the kind vocabulary is in functions/_lib/credentials.ts.
 */
export interface CredentialFieldMap { connectKey: ConnectFieldKey; source: 'secret' | 'label'; sensitive: boolean; kinds: readonly string[] }
export const CREDENTIAL_FIELD_MAP: readonly CredentialFieldMap[] = [
  { connectKey: 'wifi',             source: 'secret', sensitive: true,  kinds: ['wifi'] },
  { connectKey: 'wifi_username',    source: 'label',  sensitive: false, kinds: ['wifi'] },
  { connectKey: 'mailbox_passcode', source: 'secret', sensitive: true,  kinds: ['mailbox_pin'] },
  // ⚑ CS/ops to confirm: which credential gives the mailbox number vs the mailbox name.
  { connectKey: 'mailbox_no',       source: 'label',  sensitive: false, kinds: ['mailbox_pin', 'mailbox_key'] },
  { connectKey: 'mailbox',          source: 'label',  sensitive: false, kinds: ['mailbox_key'] },
  // Main entry code: smart lock / PIN / key. First one found wins.
  { connectKey: 'maindoor',         source: 'secret', sensitive: true,  kinds: ['main_door_key', 'smartlock_pin', 'smartlock_key', 'room_key'] },
  // ⚑ per-building / CS to confirm: the second access (lift card, lockbox, access card).
  { connectKey: 'maindoor2',        source: 'secret', sensitive: true,  kinds: ['lift_card', 'lockbox_pin', 'card'] },
] as const;

/** Connect collapses all whitespace to single spaces before sending (Meta rejects multi-line
 *  parameters), so every value is flattened here too: one line, trimmed, no tabs or newlines. */
export function singleLine(v: unknown): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim();
}

/** Dates are stored as ISO text (YYYY-MM-DD…). Connect does NO date formatting, so the ERP sends
 *  the exact string the message should show. YYYY/MM/DD per the integration spec's examples; the
 *  one function to change if the template copy wants a different style. */
export function formatConnectDate(iso: unknown): string {
  const d = String(iso ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.replace(/-/g, '/') : singleLine(iso);
}

/** A sensitive value, masked for the preview surface: bullets only, no tail, so the operator can
 *  confirm a field is populated without the raw code appearing in the new UI. The clear value only
 *  ever travels server-side → Connect → the guest. */
export function maskSecret(clear: string): string {
  const n = Math.min(8, Math.max(2, clear.length));
  return '•'.repeat(n);
}

export interface ReservationRow { name: string | null; phone: string | null; unit_no: string | null; check_in: string | null; check_out: string | null }
export interface CredentialRow { kind: string; label: string | null; secret: string | null }
export interface AssembledContact { name: string; phone: string; attributes: Record<string, string>; missing: ConnectFieldKey[] }

/**
 * Turn a reservation row + its guest-visible credential rows into the Connect push payload.
 * Only keys with a real value are included (an empty value renders as "-", so we leave it out).
 * With `mask` true, sensitive (`secret`-sourced) values are bulleted for the preview surface.
 * Pure: the DB read that feeds it is in connect.ts (assembleConnectContact).
 */
export function buildConnectAttributes(r: ReservationRow, creds: readonly CredentialRow[], opts: { mask?: boolean } = {}): AssembledContact {
  const attributes: Record<string, string> = {};
  const put = (key: ConnectFieldKey, raw: unknown, sensitive: boolean) => {
    const v = singleLine(raw);
    if (!v) return;
    attributes[key] = opts.mask && sensitive ? maskSecret(v) : v;
  };

  put('unit_no', r.unit_no, false);
  put('checkin_date', formatConnectDate(r.check_in), false);
  put('checkout_date', formatConnectDate(r.check_out), false);

  for (const m of CREDENTIAL_FIELD_MAP) {
    if (attributes[m.connectKey]) continue; // first match wins
    const hit = creds.find(c => m.kinds.includes(c.kind) && singleLine(m.source === 'secret' ? c.secret : c.label));
    if (hit) put(m.connectKey, m.source === 'secret' ? hit.secret : hit.label, m.sensitive);
  }

  return {
    name: singleLine(r.name),
    phone: singleLine(r.phone),
    attributes,
    missing: CONNECT_FIELD_KEYS.filter(k => !(k in attributes)),
  };
}

/** Automation names the operator may pick from, supplied by the CONNECT_AUTOMATIONS env (JSON array
 *  or comma-separated). Kept out of code so the ~41 planned templates are configured, never hardcoded;
 *  empty means the UI offers a free-text automation name instead. */
export function connectAutomations(raw: string | undefined | null): string[] {
  const s = String(raw ?? '').trim();
  if (!s) return [];
  let list: unknown[] = [];
  if (s.startsWith('[')) { try { const p = JSON.parse(s); if (Array.isArray(p)) list = p; } catch { /* fall through to CSV */ } }
  if (!list.length) list = s.split(',');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of list) { const name = singleLine(x); if (name && !seen.has(name)) { seen.add(name); out.push(name); } }
  return out;
}

export interface ConnectResult { ok: boolean; status: number | null; body: unknown; triggered: string[]; error?: string }

/** What the push actually did, for recording as a message delivery_state. Connect answering 200 with
 *  an empty `triggered[]` means NOTHING was sent (no enabled automation matched the name) — a failed
 *  send, surfaced to the operator, exactly as Houzs Century's ERP treats it. Pure. */
export function connectDeliveryOutcome(r: ConnectResult, automation: string): { state: 'sent' | 'failed'; reason?: string } {
  const serverError = (() => {
    const e = (r.body as { error?: unknown } | null)?.error;
    return typeof e === 'string' && e.trim() ? e.trim() : null;
  })();
  if (r.status === null) return { state: 'failed', reason: 'Houzs Connect could not be reached. Try again in a moment.' };
  if (!r.ok) {
    if (r.status === 401 || r.status === 503) return { state: 'failed', reason: 'Houzs Connect is not set up yet (missing or wrong key). Ask IT.' };
    if (r.status === 400) return { state: 'failed', reason: serverError ?? 'Houzs Connect rejected the request.' };
    return { state: 'failed', reason: serverError ?? `Houzs Connect returned ${r.status}.` };
  }
  if (r.triggered.length === 0) return { state: 'failed', reason: `No template went out: the automation "${automation}" is not set up and enabled in Houzs Connect yet.` };
  return { state: 'sent' };
}
