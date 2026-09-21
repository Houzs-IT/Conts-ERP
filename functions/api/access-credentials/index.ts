import { type Env, all, json, nowIso } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';

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
  return json({
    generatedAt: nowIso(),
    data: rows.map(r => ({
      id: r.id, unitNumber: r.unit_number, propertyName: r.property_name,
      kind: r.kind, label: r.label, instruction: r.instruction,
      rotatesAfterStay: !!r.rotates_after_stay, updatedAt: r.updated_at,
      // Field roles get the instruction only, not even the masked tail.
      secret: field ? '' : maskOf(r.secret),
      lastRevealedBy: r.revealed_by ?? null, lastRevealedAt: r.revealed_at ? String(r.revealed_at).slice(0, 10) : null,
    })),
  });
};
