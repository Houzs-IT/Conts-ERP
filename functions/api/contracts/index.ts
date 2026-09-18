import { type Env, all, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, canSeeFinance } from '../../_lib/auth';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const ownerScoped = session.role === 'owner';
  const rows = await all<any>(env, `
    SELECT c.*, o.display_name,
           (SELECT GROUP_CONCAT(p.name || ' ' || u.unit_number, ', ')
            FROM units u JOIN properties p ON p.id = u.property_id
            WHERE u.contract_id = c.id OR u.owner_id = c.owner_id) AS units_label
    FROM owner_contracts c
    JOIN owners o ON o.id = c.owner_id
    WHERE 1 = 1 ${ownerScoped ? 'AND o.user_id = ?' : ''}
    ORDER BY c.renews_on`, ...(ownerScoped ? [session.userId] : []));

  const today = new Date();
  return json({
    generatedAt: new Date().toISOString(),
    data: rows.map(r => {
      const days = r.renews_on
        ? Math.round((new Date(r.renews_on).getTime() - today.getTime()) / 864e5)
        : null;
      return {
        id: r.id, ownerName: r.display_name, unitsLabel: r.units_label,
        managementFeePct: r.management_fee_pct,
        startsOn: r.starts_on, renewsOn: r.renews_on, endsOn: r.ends_on,
        daysToRenewal: days,
        // Server decides the tone so "renewing soon" means one thing everywhere.
        state: r.ends_on && new Date(r.ends_on) < today ? 'Ended'
             : days !== null && days < 180 ? 'Renewing soon' : 'Active',
      };
    }),
  });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!canSeeFinance(session.role)) return fail('FORBIDDEN', 'Finance or management access is required.', 403);

  const b = await request.json<any>();
  const fields: Record<string, string> = {};
  if (!b.ownerId) fields.ownerId = 'An owner is required.';
  if (typeof b.managementFeePct !== 'number' || b.managementFeePct < 0 || b.managementFeePct > 100) {
    fields.managementFeePct = 'Enter a percentage between 0 and 100.';
  }
  if (!b.startsOn) fields.startsOn = 'A start date is required.';
  if (Object.keys(fields).length) return fail('VALIDATION', 'Check the contract details.', 422, fields);

  const id = crypto.randomUUID();
  await run(env, `
    INSERT INTO owner_contracts (id, owner_id, management_fee_pct, starts_on, renews_on, ends_on, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id, b.ownerId, b.managementFeePct, b.startsOn, b.renewsOn ?? null, b.endsOn ?? null, nowIso());

  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'contract.create',
    entityTable: 'owner_contracts', entityId: id, after: b,
  });
  return json({ id }, 201);
};
