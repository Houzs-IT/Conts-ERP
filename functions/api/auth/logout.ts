import { type Env } from '../../_lib/db';
import { clearCookie, endSession, readCookie, readSession } from '../../_lib/auth';

/** POST /api/auth/logout. Clearing the cookie only empties this browser; ending its user_sessions row (migration
 *  0106) also stops a copy of the cookie from working anywhere else. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const s = await readSession(env.SESSION_SECRET, readCookie(request));
  if (s) await endSession(env, s.sid, s.userId);
  return new Response(null, { status: 204, headers: { 'set-cookie': clearCookie(request) } });
};
