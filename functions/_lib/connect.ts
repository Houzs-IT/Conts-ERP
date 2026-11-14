/**
 * Houzs Connect contact push — the DB read (assembleConnectContact) and the webhook call
 * (postConnectContact). Modelled on channex.ts (fetch wrapper + a xxxConfigured guard + a custom
 * secret header) and on Houzs Century's proven backend/src/services/connect.ts. Never throws;
 * gated on isConnectConfigured; the feature is inert until CONNECT_WEBHOOK_KEY is set.
 *
 * The pure parts (field mapping, attribute assembly, response handling) are in connectFields.ts and
 * re-exported below. See docs/superpowers/plans/2026-11-14-connect-guest-messaging.md.
 */
import { type Env, all, one, inDemo } from './db';
import { usedBySql } from './credentials';
import {
  CONNECT_COMPANY_SLUG, CONNECT_DEFAULT_URL, buildConnectAttributes,
  type AssembledContact, type ConnectResult,
} from './connectFields';

export * from './connectFields';

/** The Connect server, trailing slash trimmed. Override with CONNECT_WEBHOOK_URL; defaults to prod. */
export const connectServer = (env: Env) => (env.CONNECT_WEBHOOK_URL || CONNECT_DEFAULT_URL).replace(/\/+$/, '');

/** Both the URL (defaulted) and the shared key are needed; demo mode never pushes to Connect, same
 *  as channexConfigured. Unset key ⇒ false ⇒ nothing is sent. This is what keeps the feature inert. */
export const isConnectConfigured = (env: Env) => !!env.CONNECT_WEBHOOK_KEY && !inDemo();

/**
 * POST the contact to Connect's inbound webhook. Always sends companySlug "the-conts". Passing an
 * explicit `automation` fires that automation (sends the template now); omitting it would fire ALL
 * enabled webhook automations, so callers that send a template always name one. Returns
 * {ok,status,body,triggered}; never throws.
 */
export async function postConnectContact(env: Env, p: { phone: string; name?: string | null; automation?: string; attributes: Record<string, string> }): Promise<ConnectResult> {
  if (!isConnectConfigured(env)) return { ok: false, status: null, body: null, triggered: [], error: 'Houzs Connect is not configured.' };
  try {
    const res = await fetch(connectServer(env) + '/api/webhooks/erp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-connect-key': String(env.CONNECT_WEBHOOK_KEY ?? '') },
      body: JSON.stringify({ companySlug: CONNECT_COMPANY_SLUG, phone: p.phone, name: p.name ?? undefined, automation: p.automation || undefined, attributes: p.attributes }),
    });
    const text = (await res.text().catch(() => '')).slice(0, 2000);
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    const triggered = Array.isArray((body as { triggered?: unknown } | null)?.triggered)
      ? ((body as { triggered: unknown[] }).triggered).map(String) : [];
    return { ok: res.ok, status: res.status, body, triggered };
  } catch (e) {
    return { ok: false, status: null, body: null, triggered: [], error: String(e).slice(0, 300) };
  }
}

/**
 * Assemble the Connect push for one reservation: the guest (name + phone), the unit label, the stay
 * dates, and the unit's guest-visible access credentials pivoted by kind (buildConnectAttributes).
 * The `secret` column is read server-side here (the same clear value the audited reveal path returns);
 * with `mask` true the sensitive values are bulleted for the preview surface. Returns null if the
 * reservation is gone.
 */
export async function assembleConnectContact(env: Env, reservationId: string, opts: { mask?: boolean } = {}): Promise<AssembledContact | null> {
  const r = await one<{ name: string | null; phone: string | null; unit_no: string | null; check_in: string | null; check_out: string | null; unit_id: string }>(env, `
    SELECT g.full_name AS name, g.phone AS phone,
           trim(coalesce(p.name, '') || ' ' || u.unit_number) AS unit_no,
           r.check_in, r.check_out, r.unit_id
    FROM reservations r
    JOIN units u ON u.id = r.unit_id
    LEFT JOIN properties p ON p.id = u.property_id
    LEFT JOIN guests g ON g.id = r.guest_id
    WHERE r.id = ?`, reservationId);
  if (!r) return null;

  // Guest-visible credentials for the unit, newest first so the first match per Connect key is the
  // current one. usedBySql adds the guest-visibility filter once migration 0161 is in (else '').
  const creds = await all<{ kind: string; label: string | null; secret: string | null }>(env, `
    SELECT c.kind, c.label, c.secret FROM access_credentials c
    WHERE c.unit_id = ?${await usedBySql(env, 'c', 'guest')}
    ORDER BY c.updated_at DESC`, r.unit_id);

  return buildConnectAttributes(r, creds, opts);
}
