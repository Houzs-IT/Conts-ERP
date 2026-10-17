import { type Env, all, one, run, json, fail, audit, nowIso, mytToday } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { notify } from '../../_lib/notify';
import { resolveUnit } from '../../_lib/ops';
import { windowsFor, staysOverlapping } from '../../_lib/cleaning';
import { CATEGORIES, URGENCIES, SOURCES, CHARGE_TO, JOB_TYPES, SEVERITIES, DAY, assigneeUserId, assigneeKindFor, hasBilling, toInstant, hasJobType, urgencyOf, approvalRules, ruleNeedsApproval } from '../../_lib/maintenance';
import { repairNotice } from '../../_lib/notices';
import { hasServicePrices, serviceBook } from '../../_lib/servicePrices';
import { layoutKey } from '../../_lib/cleaningPrices';
import { hasJobInvoices } from '../../_lib/jobProfit';
import { priceLines, linesTotal, writeLines, type Line } from '../../_lib/jobItems';

/** GET /api/maintenance/issues?state=&unitId= — every job, with its technician, category, urgency, source, repair
 *  windows (and the stays each overlaps), photo and document counts, and what it cost and who paid once done.
 *  A job waits for the owner only after the office sends it for approval. */
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
           (SELECT COALESCE(SUM(e.amount), 0) FROM expenses e WHERE e.maintenance_id = m.id) AS expensed,
           (SELECT min(e.incurred_on) FROM expenses e WHERE e.maintenance_id = m.id) AS expensed_on,
           (o.user_id IS NOT NULL) AS owner_has_login
    FROM maintenance_issues m
    JOIN units u ON u.id = m.unit_id
    JOIN properties p ON p.id = u.property_id
    LEFT JOIN owners o ON o.id = u.owner_id
    LEFT JOIN users r ON r.id = m.reported_by
    LEFT JOIN maintenance_skus s ON s.id = m.sku_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY m.reported_at DESC`, ...args);

  const windows = await windowsFor(env, rows.map(r => r.id));
  const money = session.manage || session.role === 'operations_manager';
  const billing = await hasBilling(env);
  return json({
    generatedAt: nowIso(),
    // False until migration 0108 is applied: the screen then hides billing date, collected and contractor payment.
    billing,
    // False until migration 0126: the screen then offers Normal and Urgent only, and no severity, parts or due date.
    jobTypes: await hasJobType(env),
    data: rows.map(r => ({
      id: r.id, unitId: r.unit_id, unitNumber: r.unit_number, propertyName: r.property_name, buildingId: r.property_id,
      title: r.title, detail: r.detail, state: r.state,
      category: r.category ?? 'other', urgency: r.urgency ?? 'normal',
      jobType: r.job_type ?? (r.urgency === 'urgent' ? 'urgent' : 'normal'), severity: r.severity ?? 'minor', dueOn: r.due_on ?? null,
      needsParts: !!r.needs_parts, partsArrivedAt: r.parts_arrived_at ?? null,
      // Needs owner approval / Approved / Not needed (owner, 17 Oct 2026).
      approvalStatus: r.owner_approved_at ? 'approved' : r.owner_approval_required && r.charge_to === 'owner' ? 'needed' : 'not_needed', source: r.source ?? 'staff', sourceTaskId: r.source_task_id ?? null,
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
      expensed: money ? Number(r.expensed) : null, expensedOn: money ? r.expensed_on ?? null : null,
      ownerHasLogin: !!r.owner_has_login,
      billingDate: money && billing ? r.billing_date ?? null : null, collectedAt: money && billing ? r.collected_at ?? null : null,
      contractorAmount: money && billing ? r.contractor_amount ?? null : null, contractorPaidAt: money && billing ? r.contractor_paid_at ?? null : null,
    })),
  });
};

/** POST /api/maintenance/issues — a job from the office, or damage reported from a clean or the field app.
 *  unitId may be a unit id or its display number (with propertyName when two buildings share a number).
 *  `ownerApprovalRequired: true` sends it to the owner at once; otherwise it waits for the owner only when management's
 *  approval rules say so for its category, severity or quote. jobType: urgent | normal | pass_key; severity: minor | major;
 *  needsParts and dueOn (YYYY-MM-DD) are the office's.
 *  The office may set who does it (assigneeName) and a first repair window ({ window: { startsAt, endsAt, note? } },
 *  same rules as POST /issues/:id/windows) in the same request; the answer lists the stays that window overlaps. */
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
  const cols = await hasJobType(env);
  const jobType = b.jobType ?? (b.urgency === 'urgent' ? 'urgent' : 'normal');
  if (!JOB_TYPES.includes(jobType) || (!cols && jobType === 'pass_key')) return fail('VALIDATION', 'Pick the job type.', 422, { jobType: 'Urgent, Normal or Pass key.' });
  const urgency = b.jobType ? urgencyOf(jobType) : b.urgency ?? 'normal';
  if (!URGENCIES.includes(urgency)) return fail('VALIDATION', 'Pick how urgent it is.', 422, { urgency: 'Normal or urgent.' });
  const severity = b.severity ?? 'minor';
  if (!SEVERITIES.includes(severity)) return fail('VALIDATION', 'Minor or major.', 422, { severity: 'Minor or major.' });
  if (b.dueOn != null && (typeof b.dueOn !== 'string' || !DAY.test(b.dueOn))) return fail('VALIDATION', 'Pick the due date.', 422, { dueOn: 'Pick the due date.' });
  if (field && (b.needsParts != null || b.dueOn != null)) return fail('FORBIDDEN', 'The office plans parts and due dates.', 403);
  const source = b.reportSource ?? (session.role === 'housekeeper' ? 'cleaner' : 'staff');
  if (!SOURCES.includes(source)) return fail('VALIDATION', 'Say who reported it.', 422, { reportSource: 'Guest, cleaner, inspection or staff.' });
  if (field && b.quotedAmount != null) return fail('FORBIDDEN', 'Cleaners and technicians cannot set amounts.', 403);
  if (b.quotedAmount != null && (!Number.isInteger(b.quotedAmount) || b.quotedAmount < 0)) return fail('VALIDATION', 'The amount must be a whole number of sen.', 422);

  let sourceTaskId: string | null = null;
  if (typeof b.sourceTaskId === 'string' && b.sourceTaskId) {
    const t = await one<{ id: string; unit_id: string; assignee_id: string | null }>(env, 'SELECT id, unit_id, assignee_id FROM tasks WHERE id = ?', b.sourceTaskId);
    if (!t || t.unit_id !== unit.id) return fail('VALIDATION', 'That cleaning job is not on this unit.', 422);
    if (field && t.assignee_id !== session.userId) return fail('FORBIDDEN', 'That job is assigned to someone else.', 403);
    sourceTaskId = t.id;
  }

  if (field && b.contractorAmount != null) return fail('FORBIDDEN', 'Cleaners and technicians cannot set amounts.', 403);
  if (b.contractorAmount != null && (!Number.isInteger(b.contractorAmount) || b.contractorAmount < 0)) return fail('VALIDATION', 'The internal cost must be a whole number of sen.', 422, { contractorAmount: 'Enter the internal cost.' });

  // Optional item from Service prices. When one is picked, its owner price in force today seeds the quote and its internal
  // cost the contractor amount, unless the office typed them; "Other" (no item) keeps what was typed.
  let skuId: string | null = null;
  let quoted: number | null = b.quotedAmount ?? null;
  let internal: number | null = b.contractorAmount ?? null;
  if (b.skuId) {
    const sku = await one<any>(env, 'SELECT id, default_price FROM maintenance_skus WHERE id = ?', String(b.skuId));
    if (!sku) return fail('NOT_FOUND', 'That catalog item does not exist.', 404, { skuId: 'Pick a catalog item that exists.' });
    skuId = sku.id;
    if (!field && await hasServicePrices(env)) {
      const u = await one<{ layout_type: string | null; bedrooms: number | null }>(env, 'SELECT * FROM units WHERE id = ?', unit.id);
      const a = (await serviceBook(env, [unit.id])).amounts(sku.id, unit.id, layoutKey(u?.layout_type, u?.bedrooms), mytToday());
      quoted ??= a.owner;
      internal ??= a.internal;
    } else if (quoted == null && !field) quoted = sku.default_price;
  }
  // The job's items (owner, 17 Oct 2026): picked from Service prices with a quantity; their total is the quote.
  let lines: Line[] = [];
  if (Array.isArray(b.items) && b.items.length && !field && await hasJobInvoices(env)) {
    const priced = await priceLines(env, unit.id, b.items);
    if ('error' in priced) return priced.error;
    lines = priced.lines;
    quoted = linesTotal(lines);
    skuId = lines.find(l => l.item_id)?.item_id ?? skuId;
  }
  const billingCols = internal != null && await hasBilling(env);

  let win: { startsAt: string; endsAt: string; note: string | null } | null = null;
  if (b.window != null) {
    if (field) return fail('FORBIDDEN', 'Cleaners and technicians cannot plan repair windows.', 403);
    const startsAt = toInstant(b.window.startsAt), endsAt = toInstant(b.window.endsAt);
    if (!startsAt) return fail('VALIDATION', 'Enter when the repair window starts.', 422, { windowStartsAt: 'Pick a start.' });
    if (!endsAt) return fail('VALIDATION', 'Enter when the repair window ends.', 422, { windowEndsAt: 'Pick an end.' });
    if (Date.parse(endsAt) <= Date.parse(startsAt)) return fail('VALIDATION', 'The window must end after it starts.', 422, { windowEndsAt: 'Pick a later end.' });
    if (Date.parse(endsAt) - Date.parse(startsAt) > 14 * 864e5) return fail('VALIDATION', 'Keep one window under 14 days.', 422, { windowEndsAt: 'Pick an earlier end.' });
    win = { startsAt, endsAt, note: typeof b.window.note === 'string' && b.window.note.trim() ? b.window.note.trim().slice(0, 300) : null };
  }

  // Sent to the owner on purpose, or held for the owner by management's approval rules (Maintenance > Approval rules).
  const asked = !!b.ownerApprovalRequired;
  const approval = asked || (cols && chargeTo === 'owner' && ruleNeedsApproval(await approvalRules(env), category, severity, quoted));
  const vendor = typeof b.assigneeName === 'string' && b.assigneeName.trim() && !field ? b.assigneeName.trim().slice(0, 80) : null;
  const state = approval ? 'waiting' : vendor ? 'assigned' : 'open';

  const id = crypto.randomUUID(), now = nowIso();
  const userId = await assigneeUserId(env, vendor);
  const withUser = userId !== undefined;
  await run(env, `
    INSERT INTO maintenance_issues
      (id, unit_id, reported_by, state, title, detail, sku_id, quoted_amount, owner_approval_required,
       blocks_unit, blocked_from, blocked_to, charge_to, category, urgency, source, source_task_id, vendor_name, assignee_kind,
       reported_at, created_at, updated_at${withUser ? ', assignee_user_id' : ''}${cols ? ', job_type, severity, needs_parts, due_on' : ''}${billingCols ? ', contractor_amount' : ''})
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${withUser ? ', ?' : ''}${cols ? ', ?, ?, ?, ?' : ''}${billingCols ? ', ?' : ''})`,
    id, unit.id, session.userId, state, b.title.trim().slice(0, 160), b.detail ? String(b.detail).slice(0, 2000) : null, skuId,
    quoted, approval ? 1 : 0,
    b.blocksUnit ? 1 : 0, b.blocksUnit ? (b.blockedFrom ?? mytToday()) : null, b.blockedTo ?? null,
    chargeTo, category, urgency, source, sourceTaskId, vendor, vendor ? await assigneeKindFor(env, vendor) : null,
    now, now, now, ...(withUser ? [userId] : []), ...(cols ? [jobType, severity, b.needsParts ? 1 : 0, b.dueOn ?? null] : []), ...(billingCols ? [internal] : []));

  if (lines.length) await writeLines(env, id, lines, session.userId);
  if (b.blocksUnit) await run(env, "UPDATE units SET readiness = 'maintenance', updated_at = ? WHERE id = ?", now, unit.id);
  let overlaps: unknown[] = [];
  if (win) {
    await run(env, `INSERT INTO maintenance_windows (id, issue_id, starts_at, ends_at, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(), id, win.startsAt, win.endsAt, win.note, session.userId, now);
    overlaps = await staysOverlapping(env, unit.id, win.startsAt, win.endsAt);
  }

  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'maintenance.create', entityTable: 'maintenance_issues', entityId: id, after: { unitId: unit.id, title: b.title, category, urgency, jobType, severity, needsParts: !!b.needsParts, dueOn: b.dueOn ?? null, approvalByRule: approval && !asked, source, sourceTaskId, blocksUnit: !!b.blocksUnit, approval, skuId, quotedAmount: quoted, internalCost: internal, items: lines, assignee: vendor, window: win }, source: field ? 'field_app' : b.source ?? 'web' });
  await notify(env, {
    template: 'ops.damage_reported', recipient: 'operations@theconts.com', channel: 'in_app',
    subject: b.blocksUnit ? 'Unit blocked' : urgency === 'urgent' ? 'Urgent repair reported' : 'Damage reported',
    body: `${b.title} reported by ${session.fullName}.${b.blocksUnit ? ' The unit is now out of service.' : ''}`,
    entityTable: 'maintenance_issues', entityId: id, urgent: !!b.blocksUnit || urgency === 'urgent',
  });
  await repairNotice(env, id, 'reported', session.userId);
  // Held by a rule with no quote yet: the office adds the quote and presses Send to owner, so the owner never sees a blank.
  if (approval && (asked || quoted != null)) await repairNotice(env, id, 'approval_requested', session.userId);
  return json({ id, state, ownerApprovalRequired: approval, overlaps }, 201);
};
