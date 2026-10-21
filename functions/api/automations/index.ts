import { mayRun } from '../../_lib/access';
import { type Env, all, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { CATALOG, QUIET_HOURS, RUNNING, needsToRun } from '../../_lib/automationCatalog';
import { companyDetails } from '../../_lib/letterhead';
import { phone } from '../../../src/lib/phone';

const MANAGE = ['management', 'operations_manager'];

/** GET /api/automations — the fixed rule catalog, with each rule's on/off state from the database. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role) || session.role === 'owner') return fail('FORBIDDEN', 'Automations are visible to operations, finance and management.', 403);

  const saved = await all<{ id: string; is_active: number }>(env, 'SELECT id, is_active FROM automations');
  const state = new Map(saved.map(r => [r.id, !!r.is_active]));
  const company = await companyDetails(env);
  return json({
    generatedAt: nowIso(), quietHours: QUIET_HOURS,
    // `running`: whether any code sends this message today. A switch alone sends nothing, so the screen must
    // never call a rule Live just because it is switched on.
    data: CATALOG.map(r => ({ ...r, isActive: state.get(r.id) ?? r.isActive, running: RUNNING.has(r.template), blockedBy: RUNNING.has(r.template) ? null : needsToRun(r) })),
    // What {contact} becomes in every guest message (fillTemplate), so the preview shows the real number.
    contact: phone(company.phone),
    mailConfigured: !!(env as unknown as { MAIL_API_KEY?: string }).MAIL_API_KEY,
  });
};

/** PATCH /api/automations { id, isActive } — turns one rule on or off. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayRun(session, MANAGE)) return fail('FORBIDDEN', 'You can view automations but cannot change them. Ask an operations manager.', 403);

  const b = await request.json<{ id: string; isActive: boolean }>().catch(() => null);
  const rule = CATALOG.find(r => r.id === b?.id);
  if (!rule || typeof b?.isActive !== 'boolean') return fail('VALIDATION', 'Pick an automation and say whether it is on.', 422);

  await run(env, `
    INSERT INTO automations (id, name, trigger, offset_hours, template, is_active) VALUES (?, ?, ?, NULL, ?, ?)
    ON CONFLICT (id) DO UPDATE SET is_active = excluded.is_active`, rule.id, rule.name, rule.trigger, rule.template, b.isActive ? 1 : 0);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: b.isActive ? 'automation.activate' : 'automation.pause', entityTable: 'automations', entityId: rule.id, after: { isActive: b.isActive } });
  return json({ ok: true });
};
