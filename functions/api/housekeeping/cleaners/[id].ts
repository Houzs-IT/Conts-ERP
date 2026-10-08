import { mayWork } from '../../../_lib/access';
import { type Env, one, run, json, fail, audit, nowIso } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';

const EMPLOYMENT = ['internal', 'outsourced'];
const MANAGE = ['management', 'operations_manager', 'operations_staff'];

/** PATCH /api/housekeeping/cleaners/:id — edit a roster entry. Any subset of
 *  { name, employmentType, vendorName, phone, isActive }. Deactivating keeps the
 *  entry (and its history) but drops it from the assign picker. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayWork(session, MANAGE)) return fail('FORBIDDEN', 'Only operations can change the roster.', 403);

  const id = String(params.id);
  const b = await request.json<any>().catch(() => null);
  const c = await one<any>(env, 'SELECT id, full_name, employment_type, vendor_name, phone, is_active FROM cleaners WHERE id = ?', id);
  if (!c) return fail('NOT_FOUND', 'That cleaner is no longer on the roster.', 404);

  const sets: string[] = [];
  const args: unknown[] = [];
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};

  if (typeof b?.name === 'string') {
    const name = b.name.trim();
    if (!name) return fail('VALIDATION', 'The name cannot be empty.', 422, { name: 'Enter a name.' });
    sets.push('full_name = ?'); args.push(name.slice(0, 120));
    before.name = c.full_name; after.name = name.slice(0, 120);
  }
  if (typeof b?.employmentType === 'string') {
    if (!EMPLOYMENT.includes(b.employmentType)) return fail('VALIDATION', 'Pick internal or outsourced.', 422, { employmentType: 'Internal or outsourced.' });
    sets.push('employment_type = ?'); args.push(b.employmentType);
    before.employmentType = c.employment_type; after.employmentType = b.employmentType;
    // Moving to internal clears the vendor; moving to outsourced clears the login link.
    if (b.employmentType === 'internal') { sets.push('vendor_name = NULL'); }
    else { sets.push('user_id = NULL'); }
  }
  if (typeof b?.vendorName === 'string') {
    const v = b.vendorName.trim() ? b.vendorName.trim().slice(0, 120) : null;
    sets.push('vendor_name = ?'); args.push(v);
    before.vendorName = c.vendor_name; after.vendorName = v;
  }
  if (typeof b?.phone === 'string') {
    const p = b.phone.trim() ? b.phone.trim().slice(0, 40) : null;
    sets.push('phone = ?'); args.push(p);
    before.phone = c.phone; after.phone = p;
  }
  if (b?.isActive === true || b?.isActive === false) {
    sets.push('is_active = ?'); args.push(b.isActive ? 1 : 0);
    before.isActive = !!c.is_active; after.isActive = b.isActive;
  }

  if (!sets.length) return fail('VALIDATION', 'Nothing to change.', 422);

  await run(env, `UPDATE cleaners SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, ...args, nowIso(), id);
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'housekeeping.cleaner_update',
    entityTable: 'cleaners', entityId: id, before, after,
  });
  return json({ ok: true });
};
