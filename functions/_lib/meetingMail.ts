import type { Env } from './db';

/**
 * Meeting emails through The Conts's own mail (owner, 25 Nov 2026). The Houzs IT Hub writes every meeting email
 * (invitation, change, cancellation, reminder, guest booking); this collects the ones for meetings made in Conts ERP
 * with the hub key (IT_HUB_API_KEY), sends them with Conts's Resend key (MAIL_API_KEY, theconts.com, the key that
 * already sends invitations and password resets), and tells the hub what happened; the organiser sees it in the
 * meeting detail. It runs by itself: right after a booking, change or cancellation (api/meetings, api/public/meetings)
 * and from the cron worker every 5 minutes (cronJobs.ts meetingMail), which carries the reminders.
 *
 * The hub hands each email out once (locked, with a 10-minute lease) and offers a failed one again, up to 5 tries.
 */
export interface HubMail { id: number; from: string; to: string[]; subject: string; html: string; text: string }
/** Send one email; null when it went, else the reason it did not. */
export type SendOne = (m: HubMail) => Promise<string | null>;

const TIMEOUT_MS = 20_000;

/** Collect the waiting emails from the hub, send each, and report the results. */
export async function collectAndSend(base: string, key: string, send: SendOne): Promise<{ sent: number; failed: number }> {
  const call = (path: string, body: unknown) => fetch(`${base}/api/v1/sys/meetings${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'X-Reporter-Id': 'mail', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const res = await call('/mail/claim', {});
  if (!res.ok) throw new Error(`the hub answered ${res.status}`);
  const mail = ((await res.json()) as { mail?: HubMail[] }).mail ?? [];
  const results: { id: number; error: string | null }[] = [];
  for (const m of mail) {
    let error: string | null;
    try { error = await send(m); } catch (e) { error = e instanceof Error ? e.message : String(e); }
    results.push({ id: m.id, error });
  }
  if (results.length) {
    const done = await call('/mail/results', { results });
    if (!done.ok) throw new Error(`the hub did not take the results (${done.status})`);
  }
  return { sent: results.filter(r => !r.error).length, failed: results.filter(r => r.error).length };
}

/** One email through Conts's Resend key, html and plain text, from the address the hub chose. */
export function viaContsMail(env: Env): SendOne {
  return async (m) => {
    const key = ((env as { MAIL_API_KEY?: string }).MAIL_API_KEY ?? '').trim();
    if (!key) return 'Mail is not set up here (MAIL_API_KEY).';
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: m.from, to: m.to, subject: m.subject, html: m.html, text: m.text }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok ? null : `Resend answered ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`;
  };
}

/** Conts's waiting meeting emails; nothing when meetings is not connected. */
export async function sendMeetingMail(env: Env): Promise<{ sent: number; failed: number }> {
  const base = (env.IT_HUB_URL ?? '').trim().replace(/\/+$/, '');
  const key = (env.IT_HUB_API_KEY ?? '').trim();
  if (!base || !key) return { sent: 0, failed: 0 };
  return collectAndSend(base, key, viaContsMail(env));
}

/** After the answer has gone: send what a change just queued. */
export function mailSoon(env: Env, waitUntil: (p: Promise<unknown>) => void) {
  waitUntil(sendMeetingMail(env).catch(e => console.error('Meeting emails not sent', e instanceof Error ? e.message : e)));
}

const BADGE_EVERY_MS = 60_000;
let lastBadgeRun = 0;
/** The unread badge every signed-in page polls: at most once a minute per instance, so reminders still go out if
 *  the cron worker is not set up for meetings. */
export function mailFromBadge(env: Env, waitUntil: (p: Promise<unknown>) => void, now = Date.now()) {
  if (now - lastBadgeRun < BADGE_EVERY_MS) return;
  lastBadgeRun = now;
  mailSoon(env, waitUntil);
}
