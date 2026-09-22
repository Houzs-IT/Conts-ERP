import { type Env, all, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';

const ORDER = ['earliest_checkin', 'building', 'manual'];
const STRATEGY = ['least_loaded', 'round_robin'];
const PREFER = ['internal', 'outsourced', 'any'];

const DEFAULTS: Record<string, string> = {
  'housekeeping.ordering_rule': 'earliest_checkin',
  'housekeeping.assign_strategy': 'least_loaded',
  'housekeeping.assign_prefer': 'any',
};

/** GET /api/housekeeping/rules — the current auto-assign rules for the editor. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Field roles cannot see the rules.', 403);

  const rows = await all<{ key: string; value: string }>(env, "SELECT key, value FROM settings WHERE key LIKE 'housekeeping.%'");
  const map = new Map(rows.map(r => [r.key, r.value]));
  return json({
    rule: map.get('housekeeping.ordering_rule') ?? DEFAULTS['housekeeping.ordering_rule'],
    strategy: map.get('housekeeping.assign_strategy') ?? DEFAULTS['housekeeping.assign_strategy'],
    prefer: map.get('housekeeping.assign_prefer') ?? DEFAULTS['housekeeping.assign_prefer'],
  });
};

/** PUT /api/housekeeping/rules { rule?, strategy?, prefer? } — how cleaning is
 *  sequenced and how auto-assign spreads it across the roster. Any subset. */
export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!['management', 'operations_manager'].includes(session.role)) return fail('FORBIDDEN', 'Only operations managers and management can change the rules.', 403);

  const b = await request.json<any>().catch(() => null);
  const writes: [string, string][] = [];
  if (b?.rule != null) { if (!ORDER.includes(b.rule)) return fail('VALIDATION', 'Pick a valid ordering rule.', 422, { rule: 'Earliest check-in, building or manual.' }); writes.push(['housekeeping.ordering_rule', b.rule]); }
  if (b?.strategy != null) { if (!STRATEGY.includes(b.strategy)) return fail('VALIDATION', 'Pick a valid spread strategy.', 422, { strategy: 'Least-loaded or round-robin.' }); writes.push(['housekeeping.assign_strategy', b.strategy]); }
  if (b?.prefer != null) { if (!PREFER.includes(b.prefer)) return fail('VALIDATION', 'Pick a valid preference.', 422, { prefer: 'Internal, outsourced or any.' }); writes.push(['housekeeping.assign_prefer', b.prefer]); }
  if (!writes.length) return fail('VALIDATION', 'Nothing to change.', 422);

  const now = nowIso();
  for (const [key, value] of writes) {
    await run(env, `
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, key, value, now);
  }
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'housekeeping.rules', entityTable: 'settings', entityId: 'housekeeping', after: Object.fromEntries(writes) });
  return json({ ok: true });
};
