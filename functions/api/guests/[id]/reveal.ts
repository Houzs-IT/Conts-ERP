import { type Env, one, json, fail, audit } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { hasGuestColumns } from '../../../_lib/guestList';

/** POST /api/guests/:id/reveal — the full ID number, for management only, and every reveal is audited
 *  (who, when, which guest; never the number itself). The profile otherwise shows the last four characters. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management can see a full ID number.', 403);
  if (!(await hasGuestColumns(env))) return fail('NOT_READY', 'Guest details are not set up on this database yet (migration 0091).', 503);
  const g = await one<{ id: string; id_number: string | null }>(env, 'SELECT id, id_number FROM guests WHERE id = ?', String(params.id));
  if (!g) return fail('NOT_FOUND', 'That guest does not exist.', 404);
  if (!g.id_number) return fail('NOT_FOUND', 'No ID number is on file for this guest.', 404);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'guest.id_revealed', entityTable: 'guests', entityId: g.id });
  return json({ idNumber: g.id_number });
};
