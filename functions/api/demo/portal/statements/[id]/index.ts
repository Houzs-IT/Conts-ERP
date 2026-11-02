import { type Env, json, fail } from '../../../../../_lib/db';
import { requireSession } from '../../../../../_lib/auth';
import { demoAllowed } from '../../../../../_lib/demo';
import { sampleOwnerFor, parseStatementId, sampleStatement } from '../../../../../_lib/demoPortal';

/** GET /api/demo/portal/statements/:id?ownerId=demo-... — one sample statement, per unit and per line, in the shape of
 *  /api/owner/statements/:id. Worked out from the sample reservations; never an owner statement. sample: true. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!(await demoAllowed(env, session))) return fail('FORBIDDEN', 'The sample owner portal is for management and sales staff.', 403);
  const url = new URL(request.url);
  const found = await sampleOwnerFor(env, url);
  if (found instanceof Response) return found;
  const id = parseStatementId(String(params.id));
  if (!id || id.ownerId !== found.owner.id) return fail('NOT_FOUND', 'That sample statement does not exist.', 404);
  return json({ sample: true, ...(await sampleStatement(env, found.owner, found.units, id.period)) });
};
