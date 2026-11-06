import { mayWork } from '../../../_lib/access';
import { type Env, one, run, json, fail, audit, nowIso } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { templateOut } from '../../../_lib/guestReviewSetup';

/** PATCH /api/reviews/guest-templates/:id { title?, body?, active? } — edits a template. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayWork(session, ['management'])) return fail('FORBIDDEN', 'Only operations and management can change templates.', 403);
  const id = String(params.id);
  const before = await one<any>(env, 'SELECT * FROM guest_review_templates WHERE id = ?', id);
  if (!before) return fail('NOT_FOUND', 'That template no longer exists.', 404);
  const b = await request.json<any>().catch(() => null) ?? {};
  const title = b.title === undefined ? before.title : String(b.title).trim();
  const body = b.body === undefined ? before.body : String(b.body).trim();
  const fields: Record<string, string> = {};
  if (!title) fields.title = 'Give it a short name.'; else if (title.length > 80) fields.title = 'Keep the name to 80 characters.';
  if (!body) fields.body = 'Write the review text.'; else if (body.length > 1000) fields.body = 'Keep it to 1,000 characters.';
  if (Object.keys(fields).length) return fail('VALIDATION', 'Check the template.', 422, fields);
  const active = typeof b.active === 'boolean' ? (b.active ? 1 : 0) : Number(before.is_active);
  await run(env, 'UPDATE guest_review_templates SET title = ?, body = ?, is_active = ?, updated_at = ? WHERE id = ?', title, body, active, nowIso(), id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'guest_review_template.updated', entityTable: 'guest_review_templates', entityId: id, before: { title: before.title, active: before.is_active }, after: { title, active } });
  return json({ ok: true, template: templateOut(await one<any>(env, 'SELECT * FROM guest_review_templates WHERE id = ?', id)) });
};

/** DELETE /api/reviews/guest-templates/:id — removes a template. Reviews already written from it keep their text. */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayWork(session, ['management'])) return fail('FORBIDDEN', 'Only operations and management can change templates.', 403);
  const id = String(params.id);
  const before = await one<any>(env, 'SELECT id, title FROM guest_review_templates WHERE id = ?', id);
  if (!before) return fail('NOT_FOUND', 'That template no longer exists.', 404);
  await run(env, 'DELETE FROM guest_review_templates WHERE id = ?', id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'guest_review_template.deleted', entityTable: 'guest_review_templates', entityId: id, before: { title: before.title } });
  return json({ ok: true });
};
