import { type Env, all, one, json, fail } from '../../../_lib/db';
import { requireSession, isFieldRole } from '../../../_lib/auth';
import { issueChecklist, issueParts } from '../../../_lib/maintenanceTemplates';

/** GET /api/field/maintenance/:id — one repair on the technician's phone: the template's instruction note, the
 *  checklist, the photos and videos, the parts planned and used (and the catalog to add one from), and the unit's
 *  access instructions (never the code). Only a job given to this account; no money. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const id = String(params.id);
  const m = await one<any>(env, `
    SELECT m.id, m.unit_id, m.assignee_id, mt.instructions, COALESCE(r.full_name, '') AS reporter, m.source
    FROM maintenance_issues m LEFT JOIN maintenance_templates mt ON mt.id = m.template_id LEFT JOIN users r ON r.id = m.reported_by WHERE m.id = ?`, id);
  if (!m) return fail('NOT_FOUND', 'That job no longer exists.', 404);
  if (isFieldRole(session.role) && m.assignee_id !== session.userId) return fail('FORBIDDEN', 'That job is assigned to someone else.', 403);

  const media = await all<any>(env, `
    SELECT d.id, d.kind, d.file_name, d.mime_type, d.byte_size, d.created_at, u.full_name AS uploader
    FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by WHERE d.maintenance_id = ? AND d.kind IN ('photo','video') ORDER BY d.created_at`, id);
  const access = await all<any>(env, `SELECT id, label, instruction FROM access_credentials WHERE unit_id = ? AND instruction IS NOT NULL AND btrim(instruction) != '' ORDER BY label`, m.unit_id);
  const catalog = await all<any>(env, `SELECT id, code, name, unit_label, track_stock, stock_on_hand FROM maintenance_skus WHERE active = 1 ORDER BY name LIMIT 500`);
  return json({
    id, instructions: m.instructions ?? null, reporter: m.reporter || null, source: m.source ?? 'staff',
    checklist: await issueChecklist(env, id),
    media: media.map(d => ({
      id: d.id, kind: d.kind, url: `/api/documents/${d.id}/download`, fileName: d.file_name, mimeType: d.mime_type, uploadedAt: d.created_at, uploader: d.uploader ?? null,
      stage: String(d.file_name).startsWith('after-') ? 'after' : 'before',
    })),
    parts: await issueParts(env, id),
    catalog: catalog.map(c => ({ id: c.id, code: c.code, name: c.name, unitLabel: c.unit_label, trackStock: !!c.track_stock, stockOnHand: c.track_stock ? Number(c.stock_on_hand) : null })),
    access: access.map(a => ({ id: a.id, label: a.label, instruction: a.instruction })),
  });
};
