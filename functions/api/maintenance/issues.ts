import { type Env, all, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, canSeeFinance, isFieldRole } from '../../_lib/auth';
import { notify } from '../../_lib/notify';
import { resolveUnit } from '../../_lib/ops';

const CHARGE_TO = ['owner', 'guest_deposit', 'the_conts', 'warranty'];

/** GET /api/maintenance/issues?state= — every job, with its technician, photo and document counts. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const state = new URL(request.url).searchParams.get('state');
  const rows = await all<any>(env, `
    SELECT m.*, u.unit_number, p.name AS property_name, COALESCE(r.full_name, '') AS reporter,
           s.code AS sku_code, s.name AS sku_name,
           (SELECT COUNT(*) FROM documents d WHERE d.maintenance_id = m.id AND d.kind = 'photo') AS photo_count,
           (SELECT COUNT(*) FROM documents d WHERE d.maintenance_id = m.id AND d.kind != 'photo') AS document_count
    FROM maintenance_issues m
    JOIN units u ON u.id = m.unit_id
    JOIN properties p ON p.id = u.property_id
    LEFT JOIN users r ON r.id = m.reported_by
    LEFT JOIN maintenance_skus s ON s.id = m.sku_id
    WHERE 1 = 1 ${state ? 'AND m.state = ?' : ''}
    ORDER BY m.reported_at DESC`, ...(state ? [state] : []));

  const money = canSeeFinance(session.role) || session.role === 'operations_manager';
  return json({
    generatedAt: nowIso(),
    data: rows.map(r => ({
      id: r.id, unitId: r.unit_id, unitNumber: r.unit_number, propertyName: r.property_name,
      title: r.title, detail: r.detail, state: r.state,
      vendorName: r.vendor_name, assigneeName: r.vendor_name,
      // Raw ISO, like resolvedAt beside it: MaintenancePage formats with dateShort(). Sending a
      // pre-formatted "16 Sept" made the frontend re-parse its own display string.
      reportedAt: r.reported_at, resolvedAt: r.resolved_at,
      blocksUnit: !!r.blocks_unit, blockedFrom: r.blocked_from, blockedTo: r.blocked_to,
      ownerApprovalRequired: !!r.owner_approval_required, ownerApprovedAt: r.owner_approved_at,
      chargeTo: r.charge_to, reporter: r.reporter || null,
      skuId: r.sku_id, skuCode: r.sku_code ?? null, skuName: r.sku_name ?? null,
      startedAt: r.started_at, endedAt: r.ended_at,
      photoCount: Number(r.photo_count), documentCount: Number(r.document_count),
      // Amounts are omitted entirely for roles without finance access.
      quotedAmount: money ? r.quoted_amount : null, finalAmount: money ? r.final_amount : null,
    })),
  });
};

/** POST /api/maintenance/issues — a job from the office or a damage report from the field app.
 *  unitId may be a unit id or its display number (with propertyName when two buildings share a number). */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const b = await request.json<any>().catch(() => null);
  if (!b?.title?.trim()) return fail('VALIDATION', 'A short title is required.', 422, { title: 'Enter a short title.' });
  const unit = await resolveUnit(env, b.unitId, b.propertyName);
  if (unit === 'ambiguous') return fail('VALIDATION', 'More than one unit has that number. Say which building.', 422, { unitNumber: 'Pick the building too.' });
  if (!unit) return fail('NOT_FOUND', 'That unit does not exist.', 404, { unitNumber: 'Pick a unit that exists.' });
  const chargeTo = b.chargeTo ?? 'owner';
  if (!CHARGE_TO.includes(chargeTo)) return fail('VALIDATION', 'Pick who is charged.', 422);
  if (isFieldRole(session.role) && b.quotedAmount != null) return fail('FORBIDDEN', 'Field roles cannot set amounts.', 403);
  if (b.quotedAmount != null && (!Number.isInteger(b.quotedAmount) || b.quotedAmount < 0)) return fail('VALIDATION', 'The amount must be a whole number of sen.', 422);

  // Optional catalog item. When one is picked and no quote is supplied, its preset selling
  // price seeds the quote — the operator can still override it before completing the job.
  let skuId: string | null = null;
  let quoted: number | null = b.quotedAmount ?? null;
  if (b.skuId) {
    const sku = await one<any>(env, 'SELECT id, default_price FROM maintenance_skus WHERE id = ?', String(b.skuId));
    if (!sku) return fail('NOT_FOUND', 'That catalog item does not exist.', 404, { skuId: 'Pick a catalog item that exists.' });
    skuId = sku.id;
    if (quoted == null && !isFieldRole(session.role)) quoted = sku.default_price;
  }

  const id = crypto.randomUUID(), now = nowIso();
  await run(env, `
    INSERT INTO maintenance_issues
      (id, unit_id, reported_by, state, title, detail, sku_id, quoted_amount, owner_approval_required,
       blocks_unit, blocked_from, blocked_to, charge_to, reported_at, created_at, updated_at)
    VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, unit.id, session.userId, b.title.trim(), b.detail ?? null, skuId,
    quoted, b.ownerApprovalRequired ? 1 : 0,
    b.blocksUnit ? 1 : 0, b.blocksUnit ? (b.blockedFrom ?? now.slice(0, 10)) : null, b.blockedTo ?? null,
    chargeTo, now, now, now);

  if (b.blocksUnit) await run(env, "UPDATE units SET readiness = 'maintenance', updated_at = ? WHERE id = ?", now, unit.id);

  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'maintenance.create', entityTable: 'maintenance_issues', entityId: id, after: { unitId: unit.id, title: b.title, blocksUnit: !!b.blocksUnit }, source: b.source ?? 'web' });
  await notify(env, {
    template: 'ops.damage_reported', recipient: 'operations@theconts.com', channel: 'in_app',
    subject: b.blocksUnit ? 'Unit blocked' : 'Damage reported',
    body: `${b.title} reported by ${session.fullName}.${b.blocksUnit ? ' The unit is now out of service.' : ''}`,
    entityTable: 'maintenance_issues', entityId: id, urgent: !!b.blocksUnit,
  });
  return json({ id }, 201);
};
