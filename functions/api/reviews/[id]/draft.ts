import { mayWork } from '../../../_lib/access';
import { type Env, one, json, fail, audit } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { REVIEW_COLUMNS, reviewFrom, reviewOut } from '../../../_lib/reviews';
import { demoOn, tablesFor } from '../../../_lib/demo';
import { aiConfigured, aiEnabled, draftReviewReply } from '../../../_lib/aiDraft';
import { scaleText } from '../../../../src/lib/reviewRules';

/** POST /api/reviews/:id/draft — an AI draft of the reply to this review, for the reply box. Never posted: the person
 *  reads it, changes it and presses Post. 501 NOT_CONFIGURED without the ANTHROPIC_API_KEY secret, 409 AI_OFF when
 *  Settings has AI draft replies off. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayWork(session, ['management'])) return fail('FORBIDDEN', 'Only operations and management can reply to reviews.', 403);
  if (!aiConfigured(env)) return fail('NOT_CONFIGURED', 'AI drafting is not set up. Write the reply yourself, or ask for the AI key to be added.', 501);
  if (!(await aiEnabled(env))) return fail('AI_OFF', 'AI draft replies are turned off in Reviews settings.', 409);
  const t = tablesFor(await demoOn(env, request, session));
  const row = await one<any>(env, `SELECT ${REVIEW_COLUMNS} ${reviewFrom(t)} WHERE v.id = ?`, String(params.id));
  if (!row) return fail('NOT_FOUND', 'That review no longer exists.', 404);
  const r = reviewOut(row);
  const out = await draftReviewReply(env, {
    channel: r.channel, guestName: r.guestName, unit: [r.propertyName, r.unitNumber].filter(Boolean).join(' ') || null, score: scaleText(r.native),
    comment: r.comment, categories: r.categories.map(c => ({ label: c.label, score: scaleText(c.native) })), tags: r.tags.map(x => x.label),
  });
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: out.ok ? 'review.ai_draft' : 'review.ai_draft_failed', entityTable: 'reviews', entityId: r.id, after: out.ok ? { length: out.text.length } : { reason: out.reason } });
  if (!out.ok) return fail('AI_FAILED', out.reason, 502);
  return json({ ok: true, draft: out.text });
};
