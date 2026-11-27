import { type Env, audit, fail } from '../../../_lib/db';
import { escapeHtml, mytNow } from '../../../_lib/mcpProactive';
import { logSend, proactiveReady, unsubscribeWithToken, UNSUB_TOKEN_RE } from '../../../_lib/mcpProactiveStore';

/**
 * The unsubscribe link at the foot of every morning brief and alert email (round 4d). No session: the random token in
 * the link is the only credential (no user id in it), and it can only turn that person's emails OFF.
 *
 *   GET  ?t=...  shows ONE button and changes nothing. Mail scanners (Outlook Safe Links, Gmail) open every link in an
 *                email before the person does; a GET that unsubscribed would switch people off without them knowing.
 *   POST t=...   the button: turns the brief and the alerts off, logged in mcp_proactive_sends.
 */
// Fixed colours: a stand-alone page outside the app's theme (as the email itself).
const page = (title: string, inner: string, status = 200): Response => new Response(
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;background:#F5F5F3;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1F1F1C">
<main style="max-width:480px;margin:48px auto;padding:24px;background:#FFFFFF;border:1px solid #E6E6E1;border-radius:12px">${inner}</main></body></html>`,
  { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer' } },
);

const invalid = () => page('Link not valid', '<h1 style="font-size:20px">This link is not valid</h1><p>Change your email settings on System &gt; AI Connector in The Conts ERP.</p>', 400);

export const onRequestGet: PagesFunction<Env> = async ({ request }) => {
  const t = new URL(request.url).searchParams.get('t') ?? '';
  if (!UNSUB_TOKEN_RE.test(t)) return invalid();
  return page('Unsubscribe', `<h1 style="font-size:20px;margin:0 0 8px">Stop these emails?</h1>
<p style="color:#5F5F5A">This turns off your morning brief and urgent alerts from The Conts ERP. You can turn them on again on System &gt; AI Connector.</p>
<form method="post" action="/api/mcp/proactive/unsubscribe"><input type="hidden" name="t" value="${escapeHtml(t)}">
<button type="submit" style="height:44px;padding:0 20px;border:0;border-radius:8px;background:#2F5D50;color:#FFFFFF;font-size:15px;font-weight:600;cursor:pointer">Unsubscribe</button></form>`);
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!(await proactiveReady(env))) return fail('NOT_CONFIGURED', 'Not set up on this system yet.', 503);
  const form = await request.formData().catch(() => null);
  const t = String(form?.get('t') ?? new URL(request.url).searchParams.get('t') ?? '');
  const userId = await unsubscribeWithToken(env, t);
  if (!userId) return invalid();
  await audit(env, { actorId: userId, actorLabel: 'Email unsubscribe link', action: 'ai_connector.brief_unsubscribe', entityTable: 'mcp_brief_subscriptions', entityId: userId, after: { briefEnabled: false, alertsEnabled: false } });
  await logSend(env, { userId, kind: 'unsubscribe', day: mytNow().day, items: 0, notificationId: null, status: 'skipped', note: 'unsubscribed by the email link' });
  return page('Unsubscribed', '<h1 style="font-size:20px;margin:0 0 8px">You are unsubscribed</h1><p style="color:#5F5F5A">No more morning briefs or alerts. Turn them on again any time on System &gt; AI Connector.</p>');
};
