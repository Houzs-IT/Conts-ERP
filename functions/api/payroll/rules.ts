import { mayRun } from '../../_lib/access';
import { type Env, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { payRulesSchema } from '../../_lib/payrollCalc';
import { hasPayroll, NOT_MIGRATED, readPayRules, RULES_KEY } from '../../_lib/payroll';

const MANAGE = ['management']; // everyone else needs Full on HR (functions/_lib/access.ts)

/** PUT /api/payroll/rules — the whole set of pay rules (statutory amounts, overtime, Sunday and holiday rates, emergency
 *  leave). Applies to slips made from now on; approved and paid slips keep the rules they were made with. */
export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayRun(session, MANAGE)) return fail('FORBIDDEN', 'Changing pay rules needs Full access to HR.', 403);
  if (!(await hasPayroll(env))) return fail('NOT_MIGRATED', NOT_MIGRATED, 503);
  const parsed = payRulesSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail('VALIDATION', 'Some rules need a fix.', 422, Object.fromEntries(parsed.error.issues.map(i => [String(i.path[0] ?? 'form'), i.message])));
  }
  const before = await readPayRules(env);
  await run(env, `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, RULES_KEY, JSON.stringify(parsed.data), nowIso());
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'payroll.rules', entityTable: 'settings', entityId: RULES_KEY, before, after: parsed.data });
  return json({ data: parsed.data });
};
