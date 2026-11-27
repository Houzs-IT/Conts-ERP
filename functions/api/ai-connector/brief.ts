import { type Env, audit, fail, json } from '../../_lib/db';
import { actorOf } from '../../_lib/aiConnector';
import { briefGate, SCHEDULE_WORDS } from '../../_lib/aiBrief';
import { DEFAULT_SUBSCRIPTION, parseSubscriptionInput, thresholdsForDisplay } from '../../_lib/mcpProactive';
import { getSubscription, recentSends, saveSubscription } from '../../_lib/mcpProactiveStore';
import { hasRealEmail } from '../../_lib/fieldPin';

/** GET /api/ai-connector/brief: the signed-in person's own morning brief / urgent alert settings (off until they turn them
 *  on), the alert rules (read-only, one config: functions/_lib/mcpProactive.ts PROACTIVE_CONFIG), and their last emails.
 *  Only their own row (session.userId). */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const g = await briefGate(request, env, false);
  if (g.response) return g.response;
  const { person } = g;
  const sub = await getSubscription(env, person.userId);
  return json({
    allowed: person.allowed,
    email: hasRealEmail(person.email) ? person.email : '',
    saved: !!sub,
    subscription: sub ?? { userId: person.userId, ...DEFAULT_SUBSCRIPTION },
    thresholds: thresholdsForDisplay(),
    schedule: SCHEDULE_WORDS,
    recent: person.allowed ? await recentSends(env, person.userId, 10) : [],
  });
};

/** PUT /api/ai-connector/brief { briefEnabled, briefTime, briefDays, alertsEnabled }: the person turns their own emails on
 *  or off. Refused unless the AI Connector is on for them; an account with no real email cannot turn anything on. */
export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const g = await briefGate(request, env, true);
  if (g.response) return g.response;
  const { person } = g;
  const parsed = parseSubscriptionInput(await request.json().catch(() => null), person.session.userId);
  if (!parsed.ok) return fail('VALIDATION', parsed.error, 422);
  if ((parsed.value.briefEnabled || parsed.value.alertsEnabled) && !hasRealEmail(person.email)) {
    return fail('VALIDATION', 'Your ERP account has no email address. Ask management to add one first.', 422);
  }
  const before = await getSubscription(env, person.userId);
  await saveSubscription(env, parsed.value);
  await audit(env, { ...actorOf(person.session), action: 'ai_connector.brief_settings', entityTable: 'mcp_brief_subscriptions', entityId: person.userId, before, after: parsed.value });
  return json({ ok: true, subscription: parsed.value });
};
