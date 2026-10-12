import { type Env, fail } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { hubFor, hubFetch } from '../../../_lib/itHub';

/** GET /api/it-support/attachments/:id — a file on one of the signed-in person's own IT requests (session.userId),
 *  passed through from the hub so Conts's key stays on the server. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const { hub, refusal } = hubFor(env, session);
  if (!hub) return refusal;
  const id = String(params.id);
  if (!/^\d{1,12}$/.test(id)) return fail('NOT_FOUND', 'That file could not be found.', 404);

  let res: Response;
  try {
    res = await hubFetch(hub, `/attachments/${id}`);
  } catch {
    return fail('UPSTREAM', 'IT Support could not be reached. Try again in a moment.', 502);
  }
  if (res.status === 404) return fail('NOT_FOUND', 'That file could not be found.', 404);
  if (!res.ok || !res.body) return fail('UPSTREAM', 'IT Support could not be reached. Try again in a moment.', 502);
  const headers = new Headers({ 'content-type': res.headers.get('content-type') ?? 'application/octet-stream', 'cache-control': 'private, max-age=3600' });
  const disposition = res.headers.get('content-disposition');
  if (disposition) headers.set('content-disposition', disposition);
  return new Response(res.body, { status: 200, headers });
};
