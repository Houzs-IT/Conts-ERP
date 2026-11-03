import { mayWork } from '../../../_lib/access';
import { type Env, all, one, run, json, fail, audit, nowIso } from '../../../_lib/db';
import { requireSession, isFieldRole } from '../../../_lib/auth';
import { pickTemplate } from '../../../_lib/guestReviews';
import { fillTemplate } from '../../../../src/lib/reviewRules';
import { templateOut } from '../../../_lib/guestReviewSetup';


/** GET /api/reviews/guest-templates — the texts public reviews of guests are written from, least used first.
 *  ?pick=<reservationId>: one template at random among the least used, filled with that guest's first name and unit,
 *  for the form's "Use a template" (it counts as a use). */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role) || session.role === 'owner') return fail('FORBIDDEN', 'Reviews are visible to operations, finance and management.', 403);
  const pick = new URL(request.url).searchParams.get('pick');
  if (pick) {
    const r = await one<{ guest: string | null; unit: string | null }>(env, `
      SELECT g.full_name AS guest, trim(COALESCE(p.name, '') || ' ' || u.unit_number) AS unit
      FROM reservations r JOIN units u ON u.id = r.unit_id LEFT JOIN properties p ON p.id = u.property_id LEFT JOIN guests g ON g.id = r.guest_id WHERE r.id = ?`, pick);
    if (!r) return fail('NOT_FOUND', 'That reservation no longer exists.', 404);
    const t = await pickTemplate(env, mayWork(session, ['management']));
    if (!t) return fail('NO_TEMPLATE', 'No template is active. Add one under Templates.', 404);
    return json({ templateId: t.id, text: fillTemplate(t.body, { guest: r.guest, unit: r.unit }) });
  }
  const rows = await all<any>(env, 'SELECT * FROM guest_review_templates ORDER BY is_active DESC, use_count, created_at, id');
  return json({ data: rows.map(templateOut) });
};

/** POST /api/reviews/guest-templates { title, body, active } — a new template. {guest} and {unit} are filled in. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayWork(session, ['management'])) return fail('FORBIDDEN', 'Only operations and management can change templates.', 403);
  const b = await request.json<any>().catch(() => null);
  const title = String(b?.title ?? '').trim(), body = String(b?.body ?? '').trim();
  const fields: Record<string, string> = {};
  if (!title) fields.title = 'Give it a short name.'; else if (title.length > 80) fields.title = 'Keep the name to 80 characters.';
  if (!body) fields.body = 'Write the review text.'; else if (body.length > 1000) fields.body = 'Keep it to 1,000 characters.';
  if (Object.keys(fields).length) return fail('VALIDATION', 'Check the template.', 422, fields);
  const id = crypto.randomUUID(), at = nowIso();
  await run(env, 'INSERT INTO guest_review_templates (id, title, body, is_active, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, title, body, b?.active === false ? 0 : 1, session.userId, at, at);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'guest_review_template.created', entityTable: 'guest_review_templates', entityId: id, after: { title } });
  return json({ ok: true, template: templateOut(await one<any>(env, 'SELECT * FROM guest_review_templates WHERE id = ?', id)) }, 201);
};
