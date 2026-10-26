import { type Env, all, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { invalidCredential, mayEditCredentials, usedByReady, CREDENTIAL_USERS, type CredentialInput } from '../../_lib/credentials';

/** Bullets with the last three characters shown, e.g. "••••17#". Empty stays empty. */
function maskOf(clear: string | null): string {
  if (!clear) return '';
  const tail = clear.slice(-3);
  return '•'.repeat(Math.max(2, clear.length - tail.length)) + tail;
}

/** GET /api/access-credentials?unitId= — always masked here. Seeing a code takes a separate, audited request (GET /:id?reveal=true). */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const unitId = new URL(request.url).searchParams.get('unitId');
  const rows = await all<any>(env, `
    SELECT a.*, u.unit_number, p.name AS property_name,
           (SELECT l.actor_label FROM audit_log l WHERE l.entity_table = 'access_credentials' AND l.entity_id = a.id AND l.action = 'access.reveal' ORDER BY l.occurred_at DESC LIMIT 1) AS revealed_by,
           (SELECT l.occurred_at FROM audit_log l WHERE l.entity_table = 'access_credentials' AND l.entity_id = a.id AND l.action = 'access.reveal' ORDER BY l.occurred_at DESC LIMIT 1) AS revealed_at
    FROM access_credentials a
    JOIN units u ON u.id = a.unit_id
    JOIN properties p ON p.id = u.property_id
    WHERE 1 = 1 ${unitId ? 'AND a.unit_id = ?' : ''}
    ORDER BY p.name, u.unit_number, a.label`, ...(unitId ? [unitId] : []));

  const field = isFieldRole(session.role);
  const hasUsedBy = await usedByReady(env);
  return json({
    generatedAt: nowIso(),
    data: rows.map(r => ({
      id: r.id, unitNumber: r.unit_number, propertyName: r.property_name,
      kind: r.kind, label: r.label, instruction: r.instruction,
      rotatesAfterStay: !!r.rotates_after_stay, updatedAt: r.updated_at,
      usedBy: hasUsedBy && Array.isArray(r.used_by) ? r.used_by : [...CREDENTIAL_USERS],
      // Field roles get the instruction only, not even the masked tail.
      secret: field ? '' : maskOf(r.secret),
      lastRevealedBy: r.revealed_by ?? null, lastRevealedAt: r.revealed_at ? String(r.revealed_at).slice(0, 10) : null,
    })),
  });
};

/** POST /api/access-credentials { unitId, kind, label, secret?, instruction, rotatesAfterStay } — a new code for a unit.
 *  Only the people who may reveal a code may set one. The code itself never goes into the audit log. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayEditCredentials(session)) return fail('FORBIDDEN', 'Only operations managers and management can add access codes.', 403);

  const b = await request.json<CredentialInput>().catch(() => null);
  if (!b) return fail('VALIDATION', 'Nothing to save.', 422);
  const bad = invalidCredential(b, false);
  if (bad) return fail('VALIDATION', bad.message, 422, { [bad.field]: bad.message });
  const unit = await one<{ unit_number: string }>(env, 'SELECT unit_number FROM units WHERE id = ?', b.unitId);
  if (!unit) return fail('NOT_FOUND', 'That unit does not exist.', 404);

  const id = crypto.randomUUID();
  const secret = String(b.secret ?? '').trim() || null;
  const usedBy = b.usedBy ?? [...CREDENTIAL_USERS];
  await run(env, `
    INSERT INTO access_credentials (id, unit_id, kind, label, secret, instruction, rotates_after_stay, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id, b.unitId, b.kind, String(b.label).trim(), secret, String(b.instruction).trim(), b.rotatesAfterStay ? 1 : 0, nowIso());
  if (b.usedBy && await usedByReady(env)) await run(env, 'UPDATE access_credentials SET used_by = ?::jsonb WHERE id = ?', JSON.stringify(usedBy), id);
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'access.create', entityTable: 'access_credentials', entityId: id,
    after: { unitId: b.unitId, unitNumber: unit.unit_number, kind: b.kind, label: String(b.label).trim(), hasCode: !!secret, rotatesAfterStay: !!b.rotatesAfterStay, usedBy },
  });
  return json({ id }, 201);
};
