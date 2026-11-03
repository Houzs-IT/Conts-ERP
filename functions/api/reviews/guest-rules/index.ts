import { mayWork } from '../../../_lib/access';
import { type Env, all, one, run, json, fail, audit, nowIso } from '../../../_lib/db';
import { requireSession, isFieldRole } from '../../../_lib/auth';
import { ruleOut, readRule } from '../../../_lib/guestReviewSetup';

/** GET /api/reviews/guest-rules — the automatic guest review rules, in the order they are tried. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role) || session.role === 'owner') return fail('FORBIDDEN', 'Reviews are visible to operations, finance and management.', 403);
  const rows = await all<any>(env, 'SELECT * FROM guest_review_rules ORDER BY position, created_at, id');
  return json({ data: rows.map(ruleOut) });
};

/** POST /api/reviews/guest-rules { name, condition, mode, cleanliness, communication, respect_house_rules, recommend,
 *  tags, active } — a new rule, tried after the existing ones. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayWork(session, ['management'])) return fail('FORBIDDEN', 'Only operations and management can change guest review rules.', 403);
  const read = readRule(await request.json<any>().catch(() => null));
  if (!read.ok) return fail('VALIDATION', 'Check the rule.', 422, read.fields);
  const v = read.value, id = crypto.randomUUID(), at = nowIso();
  await run(env, `INSERT INTO guest_review_rules (id, name, condition, cleanliness, communication, respect_house_rules, recommend, tags, mode, is_active, position, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?::text::jsonb, ?, ?, (SELECT COALESCE(max(position), 0) + 1 FROM guest_review_rules), ?, ?, ?)`,
    id, v.name, v.condition, v.cleanliness, v.communication, v.respect_house_rules, v.recommend ? 1 : 0, v.tags.length ? JSON.stringify(v.tags) : null, v.mode, v.active ? 1 : 0, session.userId, at, at);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'guest_review_rule.created', entityTable: 'guest_review_rules', entityId: id, after: v });
  return json({ ok: true, rule: ruleOut(await one<any>(env, 'SELECT * FROM guest_review_rules WHERE id = ?', id)) }, 201);
};
