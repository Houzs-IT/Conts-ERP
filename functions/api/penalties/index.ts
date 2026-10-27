import { mayWork } from '../../_lib/access';
import { type Env, json, fail, audit } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { hasPenalties, NOT_MIGRATED, listPenalties, penaltyInput, saveDraft, movePenalty, type Penalty } from '../../_lib/penalties';

const MANAGE = ['management']; // everyone else follows their level in HR (functions/_lib/access.ts)
export interface PenaltiesPayload { data: Penalty[] }

/** GET /api/penalties — every worker penalty with its lines (HR > Employees > Worker Penalty). */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role) || session.role === 'owner') return fail('FORBIDDEN', 'Penalties are kept by the office.', 403);
  if (!(await hasPenalties(env))) return fail('NOT_MIGRATED', NOT_MIGRATED, 503);
  const payload: PenaltiesPayload = { data: await listPenalties(env) };
  return json(payload);
};

/** POST /api/penalties { date, jobKind?, jobId?, reason, remarks?, lines, submit? } — a new penalty, saved as a draft or
 *  straight away submitted for approval (Hookka's "Save Draft" and "Save & Submit"). */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayWork(session, MANAGE)) return fail('FORBIDDEN', 'Your access does not include raising penalties.', 403);
  if (!(await hasPenalties(env))) return fail('NOT_MIGRATED', NOT_MIGRATED, 503);
  const b = await request.json<Record<string, unknown>>().catch(() => null);
  const parsed = penaltyInput.safeParse(b);
  if (!parsed.success) {
    return fail('VALIDATION', 'Some fields need a fix.', 422, Object.fromEntries(parsed.error.issues.map(i => [String(i.path[0] ?? 'form'), i.message])));
  }
  const submit = b?.submit === true;
  if (submit && parsed.data.lines.length === 0) return fail('VALIDATION', 'Add at least one worker before submitting.', 422, { lines: 'Add a worker.' });
  const id = await saveDraft(env, parsed.data, session.userId);
  if (submit) {
    const refused = await movePenalty(env, id, 'submit', session);
    if (refused) return fail('CONFLICT', refused.message, refused.status);
  }
  const [saved] = await listPenalties(env, id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: submit ? 'penalty.create_submit' : 'penalty.create', entityTable: 'worker_penalties', entityId: id,
    after: { penaltyNo: saved?.penaltyNo, reason: parsed.data.reason, jobRef: saved?.jobRef, totalSen: saved?.totalSen, workers: saved?.lines.map(l => l.name) } });
  return json({ data: saved }, 201);
};
