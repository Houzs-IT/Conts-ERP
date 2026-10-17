import { type Env, all, one, json, fail } from '../../../_lib/db';
import { requireSession, isFieldRole } from '../../../_lib/auth';
import { mineSql, hasAssigneeUser, UNASSIGNED_SQL, hasJobType, fieldVisibleSql } from '../../../_lib/maintenance';
import { fieldRepairs } from '../../../_lib/fieldRepairs';

/** GET /api/field/repairs/:id — one repair job for the phone: the job, its Before and After photos and videos, its
 *  files (claim, invoice, receipt), the notes left on it, and, once it is theirs, how to get into the unit (the
 *  instruction only, never the code). A technician may also open an unassigned job before picking it up, and whoever
 *  reported a job may open it. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const id = String(params.id);

  const byId = await hasAssigneeUser(env);
  const flags = await one<{ mine: boolean; unassigned: boolean; reported: boolean; visible: boolean }>(env, `
    SELECT ${fieldVisibleSql(await hasJobType(env))} AS visible, ${mineSql(byId)} AS mine, (${UNASSIGNED_SQL} AND m.state IN ('open','reopened')) AS unassigned, (m.reported_by IS NOT DISTINCT FROM ?) AS reported
    FROM maintenance_issues m WHERE m.id = ?`, ...(byId ? [session.userId, session.userId] : [session.userId]), session.userId, id);
  if (!flags) return fail('NOT_FOUND', 'That job no longer exists.', 404);
  const field = isFieldRole(session.role);
  const mayPick = session.role === 'technician' && !!flags.unassigned;
  if (field && !flags.visible && !flags.reported) return fail('FORBIDDEN', 'That job is waiting for the owner. The office will send it when it can go ahead.', 403);
  if (field && !flags.mine && !mayPick && !flags.reported) return fail('FORBIDDEN', 'That job is assigned to someone else.', 403);

  const [job] = await fieldRepairs(env, 'm.id = ?', [id]);
  const docs = await all<any>(env, `
    SELECT d.id, d.kind, d.file_name, d.mime_type, d.byte_size, d.created_at, u.full_name AS uploader
    FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by WHERE d.maintenance_id = ? ORDER BY d.created_at`, id);
  const access = flags.mine || !field
    ? await all<{ id: string; label: string; instruction: string | null }>(env, 'SELECT id, label, instruction FROM access_credentials WHERE unit_id = ? ORDER BY label', job.unitId)
    : [];
  const notes = await all<{ note: string; actor_label: string; occurred_at: string; action: string }>(env, `
    SELECT after_state::jsonb ->> 'note' AS note, actor_label, occurred_at, action FROM audit_log
    WHERE entity_table = 'maintenance_issues' AND entity_id = ? AND action IN ('maintenance.note','maintenance.end')
      AND COALESCE(after_state::jsonb ->> 'note', '') <> ''
    ORDER BY occurred_at`, id);

  const isMedia = (d: any) => d.kind === 'photo' || d.kind === 'video';
  return json({
    job, mine: !!flags.mine, mayPick,
    media: docs.filter(isMedia).map(d => ({ id: d.id, kind: d.kind, url: `/api/documents/${d.id}/download`, fileName: d.file_name, mimeType: d.mime_type,
      stage: String(d.file_name).startsWith('after-') ? 'after' : 'before', uploadedAt: d.created_at, uploader: d.uploader ?? null })),
    files: docs.filter(d => !isMedia(d)).map(d => ({ id: d.id, kind: d.kind, url: `/api/documents/${d.id}/download`, fileName: d.file_name,
      byteSize: Number(d.byte_size), uploadedAt: d.created_at, uploader: d.uploader ?? null })),
    access: access.filter(a => a.instruction).map(a => ({ id: a.id, label: a.label, instruction: a.instruction })),
    notes: notes.map(n => ({ note: n.note, by: n.actor_label, at: n.occurred_at, done: n.action === 'maintenance.end' })),
  });
};
