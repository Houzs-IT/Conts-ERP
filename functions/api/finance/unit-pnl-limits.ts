import { type Env, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { COST_KEYS, type Limits } from '../../../src/lib/unitPnl';
import { LIMITS_KEY } from './unit-pnl';

/** PUT /api/finance/unit-pnl-limits { lines: { cleaning: { pctMax?, perNightMax? }, … }, marginMin? } — the limits the
 *  unit P&L report checks (plan docs/superpowers/plans/2026-10-28-unit-pnl.md, Task 4). Management only, like the
 *  organisation settings. Percent 0-100; per night in sen. An empty field means no limit. */
export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (session.role !== 'management') return fail('FORBIDDEN', 'Only management can change the report limits.', 403);
  const body = await request.json<{ lines?: Record<string, { pctMax?: unknown; perNightMax?: unknown } | null>; marginMin?: unknown }>().catch(() => null);
  if (!body || typeof body !== 'object') return fail('VALIDATION', 'Send the limits.', 422);
  const num = (v: unknown, max: number) => (v === null || v === undefined || v === '' ? undefined : typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : NaN);
  const out: Limits = { lines: {} };
  for (const [key, lim] of Object.entries(body.lines ?? {})) {
    if (!(COST_KEYS as readonly string[]).includes(key)) return fail('VALIDATION', `Unknown cost line: ${key}.`, 422);
    const pctMax = num(lim?.pctMax, 100), perNightMax = num(lim?.perNightMax, 100_000_00);
    if (Number.isNaN(pctMax) || Number.isNaN(perNightMax)) return fail('VALIDATION', 'Limits must be numbers of zero or more (percent up to 100).', 422);
    if (pctMax !== undefined || perNightMax !== undefined) out.lines[key as keyof Limits['lines']] = { ...(pctMax !== undefined ? { pctMax } : {}), ...(perNightMax !== undefined ? { perNightMax: Math.round(perNightMax) } : {}) };
  }
  const marginMin = num(body.marginMin, 100);
  if (Number.isNaN(marginMin)) return fail('VALIDATION', 'The operating margin must be a percent from 0 to 100.', 422);
  if (marginMin !== undefined) out.marginMin = marginMin;

  const before = await one<{ value: string }>(env, 'SELECT value FROM settings WHERE key = ?', LIMITS_KEY);
  const value = JSON.stringify(out);
  await run(env, 'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', LIMITS_KEY, value, nowIso());
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'settings.update', entityTable: 'settings', entityId: LIMITS_KEY,
    before: before?.value ? JSON.parse(before.value) : null, after: out });
  return json({ limits: out });
};
