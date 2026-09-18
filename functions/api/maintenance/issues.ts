import { type Env, all, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, canSeeFinance } from '../../_lib/auth';
import { notify } from '../../_lib/notify';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const url = new URL(request.url);
  const state = url.searchParams.get('state');
  const rows = await all(env, `
    SELECT m.*, u.unit_number, p.name AS property_name, COALESCE(r.full_name,'') AS reporter
    FROM maintenance_issues m
    JOIN units u ON u.id = m.unit_id
    JOIN properties p ON p.id = u.property_id
    LEFT JOIN users r ON r.id = m.reported_by
    WHERE 1 = 1 ${state ? 'AND m.state = ?' : ''}
    ORDER BY m.reported_at DESC`, ...(state ? [state] : []));

  const money = canSeeFinance(session.role);
  return json({
    generatedAt: new Date().toISOString(),
    data: rows.map((r: any) => ({
      id: r.id, title: r.title, detail: r.detail, state: r.state,
      unitNumber: r.unit_number, propertyName: r.property_name,
      vendorName: r.vendor_name, reportedAt: r.reported_at, resolvedAt: r.resolved_at,
      blocksUnit: !!r.blocks_unit, blockedFrom: r.blocked_from, blockedTo: r.blocked_to,
      ownerApprovalRequired: !!r.owner_approval_required, ownerApprovedAt: r.owner_approved_at,
      chargeTo: r.charge_to, reporter: r.reporter || null,
      // Amounts are omitted entirely for roles without finance access.
      ...(money ? { quotedAmount: r.quoted_amount, finalAmount: r.final_amount } : {}),
    })),
  });
};

/** POST /api/maintenance/issues — the field app's damage report lands here. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const b = await request.json<any>();
  if (!b.unitId || !b.title) return fail('VALIDATION', 'Unit and a short title are required.', 422);

  const id = crypto.randomUUID();
  const now = nowIso();
  await run(env, `
    INSERT INTO maintenance_issues
      (id, unit_id, reported_by, state, title, detail, quoted_amount, owner_approval_required,
       blocks_unit, blocked_from, blocked_to, charge_to, reported_at, created_at, updated_at)
    VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, b.unitId, session.userId, b.title, b.detail ?? null,
    b.quotedAmount ?? null, b.ownerApprovalRequired ? 1 : 0,
    b.blocksUnit ? 1 : 0, b.blockedFrom ?? null, b.blockedTo ?? null,
    b.chargeTo ?? 'owner', now, now, now);

  // A blocking issue takes the unit out of service immediately.
  if (b.blocksUnit) {
    await run(env, "UPDATE units SET readiness = 'maintenance', updated_at = ? WHERE id = ?", now, b.unitId);
  }

  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'maintenance.create',
    entityTable: 'maintenance_issues', entityId: id, after: b,
    source: b.source ?? 'web',
  });
  // A blocking issue is urgent: it overrides quiet hours because a unit just
  // went out of service and someone has to re-plan around it.
  await notify(env, {
    template: 'ops.damage_reported',
    recipient: 'operations@theconts.com',
    channel: 'in_app',
    subject: b.blocksUnit ? 'Unit blocked' : 'Damage reported',
    body: `${b.title} reported by ${session.fullName}.${b.blocksUnit ? ' The unit is now out of service.' : ''}`,
    entityTable: 'maintenance_issues', entityId: id,
    urgent: !!b.blocksUnit,
  });

  return json({ id }, 201);
};
