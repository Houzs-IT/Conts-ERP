import { mayWork } from '../../../_lib/access';
import { type Env, one, run, json, fail, audit, nowIso } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { hasTechnicianList } from '../../../_lib/maintenance';
import { followWorker } from '../../../_lib/fieldAccess';

const EMPLOYMENT = ['internal', 'outsourced'];
const MANAGE = ['management']; // everyone else follows the area's level (mayWork / maySee / mayRun)

/** PATCH /api/maintenance/technicians/:id — edit an entry on the technician list. Any subset of
 *  { name, employmentType, vendorName, phone, isActive }. Switching someone off keeps their jobs but takes them off
 *  "who fixes it". A new name is also written on their open jobs, so the job list and the field app agree. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayWork(session, MANAGE)) return fail('FORBIDDEN', 'Only operations can change the technician list.', 403);
  if (!(await hasTechnicianList(env))) return fail('NOT_MIGRATED', 'The technician list needs a database update (migration 0144) that has not been applied yet.', 503);

  const id = String(params.id);
  const b = await request.json<Record<string, unknown>>().catch(() => null);
  const t = await one<{ full_name: string; employment_type: string; vendor_name: string | null; phone: string | null; is_active: number; user_id: string | null }>(env,
    'SELECT full_name, employment_type, vendor_name, phone, is_active, user_id FROM technicians WHERE id = ?', id);
  if (!t) return fail('NOT_FOUND', 'That technician is no longer on the list.', 404);

  const sets: string[] = [], args: unknown[] = [];
  const before: Record<string, unknown> = {}, after: Record<string, unknown> = {};
  let rename: string | null = null;

  if (typeof b?.name === 'string') {
    const name = b.name.trim().slice(0, 80);
    if (!name) return fail('VALIDATION', 'The name cannot be empty.', 422, { name: 'Enter a name.' });
    if (name.toLowerCase() !== t.full_name.trim().toLowerCase()
      && await one(env, 'SELECT 1 AS x FROM technicians WHERE is_active = 1 AND id <> ? AND lower(trim(full_name)) = lower(?)', id, name)) {
      return fail('CONFLICT', `${name} is already on the list. Use a different name so jobs go to the right person.`, 409, { name: 'Already on the list.' });
    }
    sets.push('full_name = ?'); args.push(name); before.name = t.full_name; after.name = name;
    if (name !== t.full_name) rename = name;
  }
  if (typeof b?.employmentType === 'string') {
    if (!EMPLOYMENT.includes(b.employmentType)) return fail('VALIDATION', 'Pick in-house or contractor.', 422, { employmentType: 'In-house or contractor.' });
    sets.push('employment_type = ?'); args.push(b.employmentType);
    before.employmentType = t.employment_type; after.employmentType = b.employmentType;
    // Moving to in-house clears the company; moving to contractor clears the login link.
    sets.push(b.employmentType === 'internal' ? 'vendor_name = NULL' : 'user_id = NULL');
  }
  if (typeof b?.vendorName === 'string') {
    const v = b.vendorName.trim() ? b.vendorName.trim().slice(0, 120) : null;
    sets.push('vendor_name = ?'); args.push(v); before.vendorName = t.vendor_name; after.vendorName = v;
  }
  if (typeof b?.phone === 'string') {
    const p = b.phone.trim() ? b.phone.trim().slice(0, 40) : null;
    sets.push('phone = ?'); args.push(p); before.phone = t.phone; after.phone = p;
  }
  if (b?.isActive === true || b?.isActive === false) {
    if (b.isActive && !t.is_active && await one(env, 'SELECT 1 AS x FROM technicians WHERE is_active = 1 AND id <> ? AND lower(trim(full_name)) = lower(trim(?))', id, t.full_name)) {
      return fail('CONFLICT', `Someone else called ${t.full_name} is on the list. Rename one of them first.`, 409);
    }
    sets.push('is_active = ?'); args.push(b.isActive ? 1 : 0); before.isActive = !!t.is_active; after.isActive = b.isActive;
  }
  if (!sets.length) return fail('VALIDATION', 'Nothing to change.', 422);

  const now = nowIso();
  await run(env, `UPDATE technicians SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, ...args, now, id);
  const loginActive = b?.employmentType === 'outsourced' ? false : b?.isActive === true || b?.isActive === false ? b.isActive : null;
  if (loginActive !== null && await followWorker(env, t.user_id, loginActive)) after.appLogin = loginActive ? 'on' : 'off';
  if (rename) await run(env, `UPDATE maintenance_issues SET vendor_name = ?, updated_at = ? WHERE technician_id = ? AND state <> 'resolved'`, rename, now, id);
  // Moving to contractor drops the login, so their open jobs stop showing in that login's field app.
  if (b?.employmentType === 'outsourced') await run(env, `UPDATE maintenance_issues SET assignee_kind = 'contractor', assignee_user_id = NULL, updated_at = ? WHERE technician_id = ? AND state <> 'resolved'`, now, id);
  else if (b?.employmentType === 'internal') await run(env, `UPDATE maintenance_issues SET assignee_kind = 'in_house', updated_at = ? WHERE technician_id = ? AND state <> 'resolved'`, now, id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'maintenance.technician_update', entityTable: 'technicians', entityId: id, before, after });
  return json({ ok: true });
};
