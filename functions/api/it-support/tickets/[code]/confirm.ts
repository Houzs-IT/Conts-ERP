import { type Env, json, fail } from '../../../../_lib/db';
import { requireSession } from '../../../../_lib/auth';
import { hubFor, askHub, auditSent, REQUEST_CODE } from '../../../../_lib/itHub';

/** POST /api/it-support/tickets/:code/confirm — the signed-in person (session.userId) confirms that IT's fix
 *  worked, which closes their request. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const { hub, refusal } = hubFor(env, session);
  if (!hub) return refusal;
  const code = String(params.code);
  if (!REQUEST_CODE.test(code)) return fail('NOT_FOUND', 'That IT request could not be found.', 404);

  const sent = await askHub<{ ok: boolean; status: string }>(hub, `/tickets/${code}/confirm`, { method: 'POST' },
    'IT has not marked this request as done yet, so there is nothing to confirm.');
  if (sent.refusal) return sent.refusal;
  await auditSent(env, session, 'it_support.confirm', code);
  return json(sent.data);
};
