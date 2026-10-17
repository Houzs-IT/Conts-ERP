import { type Env, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { CATEGORIES, APPROVAL_MODES, RULES_KEY, approvalRules, type ApprovalRule } from '../../_lib/maintenance';

/** GET /api/maintenance/approval-rules — per problem category, when the owner must approve a job before work starts:
 *  never, always, only Major jobs, or when the quote is over an amount (sen). A job held for approval stays out of the
 *  technicians' app until the owner approves and, when it needs parts, they arrive. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Only the office sees the approval rules.', 403);
  return json({ rules: await approvalRules(env), mayEdit: !!session.manage });
};

/** PUT /api/maintenance/approval-rules { rules: { [category]: { mode, amount? } } } — management only. Applies to jobs
 *  added or changed from now on; jobs already open keep their approval state. */
export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management sets the approval rules.', 403);

  const b = await request.json<any>().catch(() => null);
  if (!b?.rules || typeof b.rules !== 'object') return fail('VALIDATION', 'Send the rules.', 422);
  const before = await approvalRules(env);
  const next: Record<string, ApprovalRule> = { ...before };
  for (const [cat, r] of Object.entries<any>(b.rules)) {
    if (!(CATEGORIES as readonly string[]).includes(cat)) return fail('VALIDATION', `Unknown category ${cat}.`, 422);
    if (!APPROVAL_MODES.includes(r?.mode)) return fail('VALIDATION', 'Pick never, always, major only, or over an amount.', 422, { [cat]: 'Pick a rule.' });
    if (r.mode === 'over' && (!Number.isInteger(r.amount) || r.amount < 0)) return fail('VALIDATION', 'Enter the amount in sen, RM 0.00 or more.', 422, { [cat]: 'Enter the amount.' });
    next[cat] = r.mode === 'over' ? { mode: 'over', amount: r.amount } : { mode: r.mode };
  }
  const now = nowIso();
  await run(env, 'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', RULES_KEY, JSON.stringify(next), now);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'settings.update', entityTable: 'settings', entityId: RULES_KEY, before, after: next });
  return json({ rules: next });
};
