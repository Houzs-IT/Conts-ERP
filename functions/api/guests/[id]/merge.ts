import { mayWork } from '../../../_lib/access';
import { type Env, one, all, run, json, fail, audit } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { CONTACT_ROLES, hasGuestColumns, MANUAL_TAGS } from '../../../_lib/guestList';

const FILL = ['email', 'phone', 'country_code', 'language', 'id_type', 'id_number', 'date_of_birth'] as const;

/** POST /api/guests/:id/merge { intoId } — the guest at :id is a duplicate of intoId. Its bookings and conversations
 *  move to intoId; details intoId lacks are filled from it; notes and manual tags are combined. The duplicate is kept,
 *  marked merged_into (hidden from the list, opening it opens intoId), so a later import that names it is redirected
 *  instead of bringing it back. Audited with what moved. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayWork(session, CONTACT_ROLES)) return fail('FORBIDDEN', 'Only operations and management can merge guests.', 403);
  if (!(await hasGuestColumns(env))) return fail('NOT_READY', 'Guest details are not set up on this database yet (migration 0091).', 503);

  const fromId = String(params.id);
  const b = await request.json<any>().catch(() => null);
  const intoId = typeof b?.intoId === 'string' ? b.intoId : '';
  if (!intoId || intoId === fromId) return fail('VALIDATION', 'Pick the guest to keep.', 422, { intoId: 'Pick the guest to keep.' });
  const [from, into] = await Promise.all([
    one<any>(env, 'SELECT * FROM guests WHERE id = ?', fromId),
    one<any>(env, 'SELECT * FROM guests WHERE id = ?', intoId),
  ]);
  if (!from || !into) return fail('NOT_FOUND', 'One of the two guests no longer exists.', 404);
  if (from.merged_into) return fail('CONFLICT', 'This guest was already merged into another.', 409);
  if (into.merged_into) return fail('CONFLICT', 'The guest to keep was itself merged into another. Pick that one.', 409);

  const moved = await all<{ id: string }>(env, 'UPDATE reservations SET guest_id = ? WHERE guest_id = ? RETURNING id', intoId, fromId);
  const threads = await all<{ id: string }>(env, 'UPDATE message_threads SET guest_id = ? WHERE guest_id = ? RETURNING id', intoId, fromId);
  const filled = FILL.filter(k => !into[k] && from[k]);
  const tags = MANUAL_TAGS.filter(t => `,${into.tags ?? ''},${from.tags ?? ''},`.includes(`,${t},`)).join(',');
  const notes = [into.notes, from.notes].filter(Boolean).join('\n\n') || null;
  await run(env, `UPDATE guests SET ${[...filled.map(k => `${k} = ?`), 'tags = ?', 'notes = ?'].join(', ')} WHERE id = ?`,
    ...filled.map(k => from[k]), tags, notes, intoId);
  await run(env, 'UPDATE guests SET merged_into = ? WHERE id = ?', intoId, fromId);
  // Anything merged into the duplicate before now follows it.
  await run(env, 'UPDATE guests SET merged_into = ? WHERE merged_into = ?', intoId, fromId);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'guest.merge', entityTable: 'guests', entityId: intoId,
    before: { duplicateId: fromId, duplicateName: from.full_name }, after: { reservations: moved.map(r => r.id), threads: threads.length, filled } });
  return json({ id: intoId, mergedFrom: fromId, reservationsMoved: moved.length, threadsMoved: threads.length, filled });
};
