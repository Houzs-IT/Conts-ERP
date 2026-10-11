import { type Env, all, one, run, json, fail, audit, nowIso, mytToday } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { notify } from '../../_lib/notify';
import { resolveUnit } from '../../_lib/ops';
import { windowsFor } from '../../_lib/cleaning';
import { CATEGORIES, URGENCIES, SOURCES, ASSIGNEE_KINDS, CHARGE_TO, approvalThreshold, needsApproval, assigneeUserId } from '../../_lib/maintenance';
import { repairNotice } from '../../_lib/notices';

/** GET /api/maintenance/issues?state=&unitId= — every job, with its technician, category, urgency, source, repair
 *  windows (and the stays each overlaps), photo and document counts, and what it cost and who paid once done.
 *  `threshold` is the quote above which a repair the owner pays waits for the owner's approval. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const sp = new URL(request.url).searchParams;
  const state = sp.get('state');
  const unitId = sp.get('unitId');
  const where: string[] = [], args: unknown[] = [];
  if (state) { where.push('m.state = ?'); args.push(state); }
  if (unitId) { where.push('m.unit_id = ?'); args.push(unitId); }
  const rows = await all<any>(env, `
    SELECT m.*, u.unit_number, p.id AS property_id, p.name AS property_name, COALESCE(r.full_name, '') AS reporter,
           s.code AS sku_code, s.name AS sku_name,
           (SELECT COUNT(*) FROM documents d WHERE d.maintenance_id = m.id AND d.kind IN ('photo','video')) AS photo_count,
           (SELECT COUNT(*) FROM documents d WHERE d.maintenance_id = m.id AND d.kind NOT IN ('photo','video')) AS document_count,
           (SELECT COALESCE(SUM(e.amount), 0) FROM expenses e WHERE e.maintenance_id = m.id) AS expensed
    FROM maintenance_issues m
    JOIN units u ON u.id = m.unit_id
    JOIN properties p ON p.id = u.property_id
    LEFT JOIN users r ON r.id = m.reported_by
    LEFT JOIN maintenance_skus s ON s.id = m.sku_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY m.reported_at DESC`, ...args);

  const windows = await windowsFor(env, rows.map(r => r.id));
  const money = session.manage || session.role === 'operations_manager';
  return json({
    generatedAt: nowIso(),
    threshold: await approvalThreshold(env),
    data: rows.map(r => ({
      id: r.id, unitId: r.unit_id, unitNumber: r.unit_number, propertyName: r.property_name, buildingId: r.property_id,
      title: r.title, detail: r.detail, state: r.state,
      category: r.category ?? 'other', urgency: r.urgency ?? 'normal', source: r.source ?? 'staff', sourceTaskId: r.source_task_id ?? null,
      vendorName: r.vendor_name, assigneeName: r.vendor_name, assigneeKind: r.assignee_kind ?? null,
      // Raw ISO: the screen formats.
      reportedAt: r.reported_at, resolvedAt: r.resolved_at,
      blocksUnit: !!r.blocks_unit, blockedFrom: r.blocked_from, blockedTo: r.blocked_to,
      ownerApprovalRequired: !!r.owner_approval_required, ownerApprovedAt: r.owner_approved_at,
      chargeTo: r.charge_to, reporter: r.reporter || null,
      skuId: r.sku_id, skuCode: r.sku_code ?? null, skuName: r.sku_name ?? null,
      startedAt: r.started_at, endedAt: r.ended_at,
      photoCount: Number(r.photo_count), documentCount: Number(r.document_count),
      windows: windows.get(r.id) ?? [],
      // Amounts are omitted entirely for roles without finance access.
      quotedAmount: money ? r.quoted_amount : null, finalAmount: money ? r.final_amount : null,
      expensed: money ? Number(r.expensed) : null,
    })),
  });
};

/** POST /api/maintenance/issues — a job from the office, or damage reported from a clean or the field app.
 *  unitId may be a unit id or its display number (with propertyName when two buildings share a number).
 *  A quote above the approval threshold on a repair the owner pays sends the job to the owner first. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const field = isFieldRole(session.role);

  const b = await request.json<any>().catch(() => null);
  if (!b?.title?.trim()) return fail('VALIDATION', 'A short title is required.', 422, { title: 'Enter a short title.' });
  const unit = await resolveUnit(env, b.unitId, b.propertyName);
  if (unit === 'ambiguous') return fail('VALIDATION', 'More than one unit has that number. Say which building.', 422, { unitNumber: 'Pick the building too.' });
  if (!unit) return fail('NOT_FOUND', 'That unit does not exist.', 404, { unitNumber: 'Pick a unit that exists.' });
  const chargeTo = b.chargeTo ?? 'owner';
  if (!CHARGE_TO.includes(chargeTo)) return fail('VALIDATION', 'Pick who pays.', 422, { chargeTo: 'Pick who pays.' });
  const category = b.category ?? 'other';
  if (!CATEGORIES.includes(category)) return fail('VALIDATION', 'Pick a category.', 422, { category: 'Pick a category.' });
  const urgency = b.urgency ?? 'normal';
  if (!URGENCIES.includes(urgency)) return fail('VALIDATION', 'Pick how urgent it is.', 422, { urgency: 'Normal or urgent.' });
  const source = b.reportSource ?? (field ? 'cleaner' : 'staff');
  if (!SOURCES.includes(source)) return fail('VALIDATION', 'Say who reported it.', 422, { reportSource: 'Guest, cleaner, inspection or staff.' });
  if (b.assigneeKind != null && !ASSIGNEE_KINDS.includes(b.assigneeKind)) return fail('VALIDATION', 'In-house or contractor.', 422, { assigneeKind: 'In-house or contractor.' });
  if (field && b.quotedAmount != null) return fail('FORBIDDEN', 'Field roles cannot set amounts.', 403);
  if (b.quotedAmount != null && (!Number.isInteger(b.quotedAmount) || b.quotedAmount < 0)) return fail('VALIDATION', 'The amount must be a whole number of sen.', 422);

  let sourceTaskId: string | null = null;
  if (typeof b.sourceTaskId === 'string' && b.sourceTaskId) {
    const t = await one<{ id: string; unit_id: string; assignee_id: string | null }>(env, 'SELECT id, unit_id, assignee_id FROM tasks WHERE id = ?', b.sourceTaskId);
    if (!t || t.unit_id !== unit.id) return fail('VALIDATION', 'That clean is not on this unit.', 422);
    if (field && t.assignee_id !== session.userId) return fail('FORBIDDEN', 'That job is assigned to someone else.', 403);
    sourceTaskId = t.id;
  }

  // Optional catalog item. When one is picked and no quote is supplied, its preset selling
  // price seeds the quote — the operator can still override it before completing the job.
  let skuId: string | null = null;
  let quoted: number | null = b.quotedAmount ?? null;
  if (b.skuId) {
    const sku = await one<any>(env, 'SELECT id, default_price FROM maintenance_skus WHERE id = ?', String(b.skuId));
    if (!sku) return fail('NOT_FOUND', 'That catalog item does not exist.', 404, { skuId: 'Pick a catalog item that exists.' });
    skuId = sku.id;
    if (quoted == null && !field) quoted = sku.default_price;
  }

  const threshold = await approvalThreshold(env);
  const approval = needsApproval(quoted, chargeTo, threshold) || !!b.ownerApprovalRequired;
  const vendor = typeof b.assigneeName === 'string' && b.assigneeName.trim() && !field ? b.assigneeName.trim().slice(0, 80) : null;
  const state = approval ? 'waiting' : vendor ? 'assigned' : 'open';

  const id = crypto.randomUUID(), now = nowIso();
  const userId = await assigneeUserId(env, vendor);
  const withUser = userId !== undefined;
  await run(env, `
    INSERT INTO maintenance_issues
      (id, unit_id, reported_by, state, title, detail, sku_id, quoted_amount, owner_approval_required,
       blocks_unit, blocked_from, blocked_to, charge_to, category, urgency, source, source_task_id, vendor_name, assignee_kind,
       reported_at, created_at, updated_at${withUser ? ', assignee_user_id' : ''})
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${withUser ? ', ?' : ''})`,
    id, unit.id, session.userId, state, b.title.trim().slice(0, 160), b.detail ? String(b.detail).slice(0, 2000) : null, skuId,
    quoted, approval ? 1 : 0,
    b.blocksUnit ? 1 : 0, b.blocksUnit ? (b.blockedFrom ?? mytToday()) : null, b.blockedTo ?? null,
    chargeTo, category, urgency, source, sourceTaskId, vendor, vendor ? (b.assigneeKind ?? 'contractor') : null,
    now, now, now, ...(withUser ? [userId] : []));

  if (b.blocksUnit) await run(env, "UPDATE units SET readiness = 'maintenance', updated_at = ? WHERE id = ?", now, unit.id);

  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'maintenance.create', entityTable: 'maintenance_issues', entityId: id, after: { unitId: unit.id, title: b.title, category, urgency, source, sourceTaskId, blocksUnit: !!b.blocksUnit, approval }, source: b.source ?? 'web' });
  await notify(env, {
    template: 'ops.damage_reported', recipient: 'operations@theconts.com', channel: 'in_app',
    subject: b.blocksUnit ? 'Unit blocked' : urgency === 'urgent' ? 'Urgent repair reported' : 'Damage reported',
    body: `${b.title} reported by ${session.fullName}.${b.blocksUnit ? ' The unit is now out of service.' : ''}`,
    entityTable: 'maintenance_issues', entityId: id, urgent: !!b.blocksUnit || urgency === 'urgent',
  });
  await repairNotice(env, id, 'reported', session.userId);
  return json({ id, state, ownerApprovalRequired: approval }, 201);
};
