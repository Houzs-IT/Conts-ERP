import { type Env, all, json, fail, audit } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';

const REVEAL_ROLES = ['management', 'operations_manager'];

/** GET /api/access-credentials?unitId=&reveal=true
 *  Secrets are masked unless an operations or management role asks explicitly,
 *  and a reveal is itself an audited action even though it is only a read. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const url = new URL(request.url);
  const unitId = url.searchParams.get('unitId');
  const wantsReveal = url.searchParams.get('reveal') === 'true';
  const mayReveal = REVEAL_ROLES.includes(session.role);

  if (wantsReveal && !mayReveal) {
    return fail('FORBIDDEN', 'You can see the access instruction but not the raw code. Ask an operations manager.', 403);
  }

  const rows = await all(env, `
    SELECT a.*, u.unit_number, p.name AS property_name
    FROM access_credentials a
    JOIN units u ON u.id = a.unit_id
    JOIN properties p ON p.id = u.property_id
    WHERE 1 = 1 ${unitId ? 'AND a.unit_id = ?' : ''}
    ORDER BY p.name, u.unit_number`, ...(unitId ? [unitId] : []));

  if (wantsReveal) {
    for (const r of rows as any[]) {
      await audit(env, {
        actorId: session.userId, actorLabel: session.fullName, action: 'access.reveal',
        entityTable: 'access_credentials', entityId: r.id,
        after: { unitNumber: r.unit_number },
      });
    }
  }

  return json({
    generatedAt: new Date().toISOString(),
    data: (rows as any[]).map(r => ({
      id: r.id, unitNumber: r.unit_number, propertyName: r.property_name,
      kind: r.kind, label: r.label,
      instruction: r.instruction,
      rotatesAfterStay: !!r.rotates_after_stay,
      updatedAt: r.updated_at,
      // Field roles get the instruction only, never the raw secret.
      secret: wantsReveal && !isFieldRole(session.role) ? r.secret : '\u2022\u2022\u2022\u2022',
    })),
  });
};
