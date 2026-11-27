import { type Env, audit, fail, json } from '../../../_lib/db';
import { actorOf } from '../../../_lib/aiConnector';
import { briefGate } from '../../../_lib/aiBrief';
import { hasRealEmail } from '../../../_lib/fieldPin';
import { DEFAULT_SUBSCRIPTION, mytNow } from '../../../_lib/mcpProactive';
import { claimKeys, getSubscription, lastTestAt, logSend, releaseKeys, saveSubscription } from '../../../_lib/mcpProactiveStore';
import { buildBrief, sendEmail, withPersonToken } from '../../../_lib/mcpProactiveRun';

/** The test brief's limit: one per person per this many minutes. */
const TEST_GAP_MS = 10 * 60_000;

/** POST /api/ai-connector/brief/test: "Send me a test brief". The brief with the data gaps, built AS the signed-in person,
 *  emailed to THEIR OWN address only (no recipient can be given), at most once per 10 minutes. Only ever their own
 *  (session.userId). */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  const g = await briefGate(request, env, true);
  if (g.response) return g.response;
  const { person } = g;
  const userId = person.session.userId;
  if (!hasRealEmail(person.email)) return fail('VALIDATION', 'Your ERP account has no email address. Ask management to add one first.', 422);
  const now = mytNow();
  const last = await lastTestAt(env, userId);
  // The claimed 10-minute bucket stops two quick presses racing; the last send stops one either side of a bucket edge.
  const bucket = `brief_test:${now.hhmm.slice(0, 4)}`;
  if ((last && Date.now() - Date.parse(last) < TEST_GAP_MS) || !(await claimKeys(env, userId, [bucket], now.day)).length) {
    return fail('RATE_LIMITED', 'A test brief was sent in the last 10 minutes. Check your inbox, or try again later.', 429);
  }
  // Settings saved once (still off), so the email carries a working unsubscribe link.
  if (!(await getSubscription(env, userId))) await saveSubscription(env, { userId, ...DEFAULT_SUBSCRIPTION });
  const c = { request, env, waitUntil };
  const built = await withPersonToken(c, userId, (id, token) => buildBrief(c, person, id, token, now, { withGaps: true, test: true }));
  if (!built || !built.ok) {
    const message = built ? built.message : 'the AI Connector is not turned on for your account';
    await releaseKeys(env, userId, [bucket], now.day).catch(() => {});
    await logSend(env, { userId, kind: 'brief_test', day: now.day, items: 0, notificationId: null, status: 'failed', note: message });
    return fail('UPSTREAM', `The brief could not be built: ${message}`, 502);
  }
  const r = await sendEmail(env, { template: 'ai.brief_test', to: person.email, userId, key: `ai.brief_test|${userId}|${now.day}|${now.hhmm}`, subject: built.subject, text: built.text, html: built.html });
  await logSend(env, { userId, kind: 'brief_test', day: now.day, items: built.items, notificationId: r.id ?? null, status: r.state, note: ['with data gaps', r.reason ?? ''].filter(Boolean).join('; ') });
  await audit(env, { ...actorOf(person.session), action: 'ai_connector.brief_test', entityTable: 'mcp_brief_subscriptions', entityId: userId, after: { items: built.items, state: r.state } });
  // A provider failure is not an error of this request: the outbox row exists and the scheduled job retries it. The page
  // says so plainly instead of "sent".
  return json({ ok: true, sentTo: person.email, items: built.items, state: r.state, ...(r.state === 'failed' ? { reason: r.reason ?? 'mail provider error' } : {}) });
};
