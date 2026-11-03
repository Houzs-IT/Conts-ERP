import { mayWork } from '../../../_lib/access';
import { type Env, one, run, json, fail, audit, nowIso } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { ruleOut, readRule } from '../../../_lib/guestReviewSetup';

/** PATCH /api/reviews/guest-rules/:id — edits a rule (any field of POST), including turning it off. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayWork(session, ['management'])) return fail('FORBIDDEN', 'Only operations and management can change guest review rules.', 403);
  const id = String(params.id);
  const row = await one<any>(env, 'SELECT * FROM guest_review_rules WHERE id = ?', id);
  if (!row) return fail('NOT_FOUND', 'That rule no longer exists.', 404);
  const before = ruleOut(row);
  const read = readRule(await request.json<any>().catch(() => null), before);
  if (!read.ok) return fail('VALIDATION', 'Check the rule.', 422, read.fields);
  const v = read.value;
  await run(env, `UPDATE guest_review_rules SET name = ?, condition = ?, cleanliness = ?, communication = ?, respect_house_rules = ?, recommend = ?,
      tags = ?::text::jsonb, mode = ?, is_active = ?, updated_at = ? WHERE id = ?`,
    v.name, v.condition, v.cleanliness, v.communication, v.respect_house_rules, v.recommend ? 1 : 0, v.tags.length ? JSON.stringify(v.tags) : null, v.mode, v.active ? 1 : 0, nowIso(), id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'guest_review_rule.updated', entityTable: 'guest_review_rules', entityId: id, before, after: v });
  return json({ ok: true, rule: ruleOut(await one<any>(env, 'SELECT * FROM guest_review_rules WHERE id = ?', id)) });
};

/** DELETE /api/reviews/guest-rules/:id — removes a rule. Reviews it already wrote stay as they are. */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayWork(session, ['management'])) return fail('FORBIDDEN', 'Only operations and management can change guest review rules.', 403);
  const id = String(params.id);
  const row = await one<any>(env, 'SELECT * FROM guest_review_rules WHERE id = ?', id);
  if (!row) return fail('NOT_FOUND', 'That rule no longer exists.', 404);
  await run(env, 'DELETE FROM guest_review_rules WHERE id = ?', id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'guest_review_rule.deleted', entityTable: 'guest_review_rules', entityId: id, before: ruleOut(row) });
  return json({ ok: true });
};
