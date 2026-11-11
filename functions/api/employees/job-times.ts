import { z } from 'zod';
import { mayRun } from '../../_lib/access';
import { type Env, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import {
  CLEANING_CARDS, REPAIR_CARDS, JOB_MINUTES_KEY, MAX_JOB_MINUTES, readJobMinutes, isJobCardKey, type JobMinutes,
} from '../../_lib/jobCards';

const MANAGE = ['management'];
const bodySchema = z.object({ minutes: z.record(z.string(), z.number().int().min(0).max(MAX_JOB_MINUTES)) });

export interface JobTimesPayload {
  minutes: JobMinutes;
  cleaning: readonly { key: string; label: string }[];
  repairs: readonly { key: string; label: string }[];
  maxMinutes: number;
  mayEdit: boolean;
}

/** GET /api/employees/job-times — HR > Employees > Standard Times: the minutes each cleaning and repair job card
 *  should take. 0 means not decided yet, and that card is left out of efficiency. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role) || session.role === 'owner') return fail('FORBIDDEN', 'Standard times are kept by the office.', 403);
  const payload: JobTimesPayload = { minutes: await readJobMinutes(env), cleaning: CLEANING_CARDS, repairs: REPAIR_CARDS, maxMinutes: MAX_JOB_MINUTES, mayEdit: mayRun(session, MANAGE) };
  return json(payload);
};

/** PUT /api/employees/job-times { minutes: { [card]: whole minutes } } — management only. Only the cards sent change;
 *  every figure on Employee Performance uses the new times straight away, past months too. */
export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayRun(session, MANAGE)) return fail('FORBIDDEN', 'Setting standard times needs Full access to HR.', 403);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail('VALIDATION', `Enter whole minutes from 0 to ${MAX_JOB_MINUTES} for each job card.`, 422);
  const before = await readJobMinutes(env);
  const next: JobMinutes = { ...before };
  for (const [card, minutes] of Object.entries(parsed.data.minutes)) {
    if (!isJobCardKey(card)) return fail('VALIDATION', `Unknown job card ${card}.`, 422);
    next[card] = minutes;
  }
  await run(env, 'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', JOB_MINUTES_KEY, JSON.stringify(next), nowIso());
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'settings.update', entityTable: 'settings', entityId: JOB_MINUTES_KEY, before, after: next });
  return json({ minutes: next });
};
