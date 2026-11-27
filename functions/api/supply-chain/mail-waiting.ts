import { type Env, json, fail } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { levelsFor } from '../../_lib/access';
import { scmEngineConfigured, mayUseScmEngine, mailWaitingAssertion } from '../../_lib/scmEngine';

/** GET /api/supply-chain/mail-waiting — the Mail Center "waiting for my reply" count for the signed-in person: open
 *  threads whose last message is the customer's, assigned to them or unassigned in their own mailbox. The same number
 *  Mail Center shows under My mailbox, read server to server for the AI Connector's daily brief (round 4, owner
 *  26 Nov 2026): the connector only makes GETs, and opening Mail Center needs a POST sign-on.
 *
 *  READ-ONLY (main session, 27 Nov 2026): it never signs the person on and never makes an engine account, session or
 *  mailbox. It sends the engine a one-minute signed statement (aud 'mail-waiting'; engine
 *  engine/backend/src/conts/mail-waiting-route.ts), and the engine only reads. Someone with no engine account or no
 *  mailbox of their own yet gets `{ count: null, opened: false, note }` ("Mail Center not opened yet").
 *
 *  Same gate as the Mail menu item and the Mail Center screen: no field or owner accounts (mayUseScmEngine), the
 *  person's Mail Center area not closed (levelsFor .mail), and the engine checks Mail and its mailbox access again.
 *
 *  `?list=1` (AI Connector round 4b, 27 Nov 2026): also `threads`, the same waiting threads (at most 10, longest waiting
 *  first: subject, mailbox, from, last snippet, newest message id), which Mail Center's inbox already shows this person.
 *  The daily brief names them and propose_mail_reply shows which email is being answered. An engine from before this
 *  answers without `threads`; callers treat that as "not listed yet". */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayUseScmEngine(session)) return fail('FORBIDDEN', 'Your account does not have access to Mail Center.', 403);
  if (!scmEngineConfigured(env)) return fail('NOT_CONFIGURED', 'Mail Center is not set up on this environment.', 501);
  const levels = await levelsFor(env, session);
  if ((levels.mail ?? 'none') === 'none') return fail('FORBIDDEN', 'Your access does not include Mail Center.', 403);

  const list = new URL(request.url).searchParams.get('list') === '1';
  let res: Response;
  try {
    res = await fetch(`${env.SCM_ENGINE_API!.replace(/\/+$/, '')}/api/conts-mail-waiting${list ? '?list=1' : ''}`, {
      method: 'POST', headers: { 'x-conts-mail': await mailWaitingAssertion(env, session, levels) }, signal: AbortSignal.timeout(6000),
    });
  } catch {
    return fail('ENGINE_UNREACHABLE', 'Mail Center could not be reached. Try again in a moment.', 502);
  }
  const b = await res.json<{ count?: unknown; opened?: unknown; note?: unknown; threads?: unknown }>().catch(() => null);
  if (res.status === 401 || res.status === 403) return fail('FORBIDDEN', 'Your account does not have access to Mail Center.', 403);
  // An engine from before this route answers 404: the count is simply not available yet.
  if (res.status === 404) return fail('ENGINE_OUTDATED', 'Mail Center cannot report this count yet (the engine needs its update).', 502);
  if (!res.ok || !b) return fail('ENGINE_REFUSED', `Mail Center did not answer (${res.status}).`, 502);
  const headers = { 'cache-control': 'no-store' };
  if (b.opened === false || b.count === null) {
    return json({ count: null, opened: false, note: typeof b.note === 'string' ? b.note : 'Mail Center not opened yet.', target: '/mail' }, 200, headers);
  }
  const count = Number(b.count ?? 0);
  const threads = list && Array.isArray(b.threads) ? { threads: b.threads.slice(0, 10) } : {};
  return json({ count: Number.isFinite(count) && count > 0 ? count : 0, opened: true, target: '/mail', ...threads }, 200, headers);
};
