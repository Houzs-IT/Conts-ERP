import { mayRun } from '../../_lib/access';
import { type Env, one, json, fail, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';

const REVEAL_ROLES = ['management', 'operations_manager'];

/** GET /api/access-credentials/:id?reveal=true — the clear code. Only operations managers and management, and every reveal is written to the audit log. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (new URL(request.url).searchParams.get('reveal') !== 'true') return fail('VALIDATION', 'Ask for a reveal explicitly.', 422);
  if (!mayRun(session, REVEAL_ROLES)) return fail('FORBIDDEN', 'You can see the access instruction but not the raw code. Ask an operations manager.', 403);

  const id = String(params.id);
  const row = await one<any>(env, `
    SELECT a.id, a.secret, u.unit_number FROM access_credentials a JOIN units u ON u.id = a.unit_id WHERE a.id = ?`, id);
  if (!row) return fail('NOT_FOUND', 'That credential no longer exists.', 404);

  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'access.reveal', entityTable: 'access_credentials', entityId: id, after: { unitNumber: row.unit_number } });
  return json({ id, secret: row.secret ?? '' });
};
