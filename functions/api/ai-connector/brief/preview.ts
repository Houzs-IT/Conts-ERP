import { type Env, fail, json } from '../../../_lib/db';
import { briefGate } from '../../../_lib/aiBrief';
import { isMonday, mytNow } from '../../../_lib/mcpProactive';
import { buildBrief, withPersonToken } from '../../../_lib/mcpProactiveRun';

/** GET /api/ai-connector/brief/preview[?gaps=1]: the brief as it would be emailed now, built AS the signed-in person
 *  (their own short-lived connector token, revoked straight after), shown on the page and NOT sent. Only ever their own
 *  (session.userId). */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  const g = await briefGate(request, env, true);
  if (g.response) return g.response;
  const { person } = g;
  const now = mytNow();
  const withGaps = new URL(request.url).searchParams.get('gaps') === '1' || isMonday(now);
  const built = await withPersonToken({ request, env, waitUntil }, person.session.userId, (id, token) => buildBrief({ request, env, waitUntil }, person, id, token, now, { withGaps }));
  if (!built) return fail('FORBIDDEN', 'The AI Connector is not turned on for your account.', 403);
  if (!built.ok) return fail('UPSTREAM', `The brief could not be built: ${built.message}`, 502);
  return json({ subject: built.subject, html: built.html, items: built.items });
};
