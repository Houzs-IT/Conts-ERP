import { type Env, all, one, json, fail, mytToday } from '../../_lib/db';
import { purposeReady } from '../../_lib/unitPurpose';
import { requireSession } from '../../_lib/auth';
import { can } from '../../_lib/access';
import { stampMyt } from '../../_lib/ops';
import { stayMonths, metrics, monthEndExclusive, daysInMonth as daysInMonthOf } from '../../_lib/revenue';
import { statementSettings } from '../../_lib/ownerStatement';
import { contractView } from '../../_lib/unitContract';
import { MODEL_LABEL } from '../../_lib/revenueModel';
import { unitMonthPnl, cachedQuery } from '../../_lib/unitPnl';
import { addressOf, ownerDetailsReady } from '../../_lib/ownerDetails';
import { taskCleanersReady, cleanerNamesSql } from '../../_lib/taskCleaners';

/**
 * The whole unit record in one request. Seven tabs of a detail page firing seven
 * round-trips is worse than one query set — an operations manager opens this
 * dozens of times a day.
 *
 * Financial sections are omitted entirely for roles without finance access, not
 * hidden in the UI.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const url = new URL(request.url);
  const unitId = url.searchParams.get('unitId');
  if (!unitId) return fail('VALIDATION', 'A unit is required.', 422);

  const ownerAddress = await ownerDetailsReady(env);
  const purposeCols = await purposeReady(env);
  const unit = await one<any>(env, `
    SELECT u.*, p.name AS property_name, p.address_line, p.city, p.state, p.postcode,
           o.id AS owner_id, o.display_name AS owner_name, o.email AS owner_email, o.phone AS owner_phone,
           ${ownerAddress ? 'o.address_lines, o.address_postcode, o.address_city, o.address_state, o.address_country,' : ''}
           c.management_fee_pct, c.renews_on, c.starts_on, c.id AS c_id, c.revenue_model, c.model, c.minimum_guarantee, c.grr_amount,
           c.agent_fee_pct, c.agent_name, c.tenant_name, c.deposit_amount, c.ends_on, c.guarantee_starts_on, c.guarantee_ends_on, c.misc_charges AS c_misc, c.minimum_guarantee_annual${purposeCols ? ', c.contract_code' : ''}
    FROM units u
    JOIN properties p ON p.id = u.property_id
    JOIN owners o ON o.id = u.owner_id
    LEFT JOIN owner_contracts c ON c.id = u.contract_id
    WHERE u.id = ?`, unitId);

  if (!unit) return fail('NOT_FOUND', 'That unit no longer exists.', 404);

  // An owner may only open their own unit. Not an empty response — a refusal.
  if (session.role === 'owner') {
    const owned = await one<{ n: number }>(env,
      'SELECT COUNT(*) AS n FROM owners WHERE id = ? AND user_id = ?', unit.owner_id, session.userId);
    if (!owned?.n) return fail('FORBIDDEN', 'This unit is not on your account.', 403);
  }

  const money = session.manage || can(session, 'finance', 'view');
  const month = mytToday().slice(0, 7);

  // Independent reads, so they go out together: each one is its own connection (db.ts).
  // Occupancy, ADR and RevPAR as everywhere else (functions/_lib/revenue.ts): gross value and nights split by night
  // into the month. The money chain is the month so far worked out the way the owner statement will be.
  const monthEndEx = monthEndExclusive(month), daysInMonth = daysInMonthOf(month);
  // The P and L and the settings read the same settings and month inputs: asked once per request.
  const q = cachedQuery(env);
  const ready = await taskCleanersReady(env);
  const [channels, stays, tasks, maintenance, inventory, access, documents, activity, perfRows, rating, money2, settings, openJobs] = await Promise.all([
    all<{ channel: string }>(env,
      'SELECT channel FROM unit_channels WHERE unit_id = ? AND is_active = 1', unitId),

    // The stay in the unit now and the next few. The full history is paged by /api/units/stays.
    all<any>(env, `
      SELECT r.id, r.channel, r.state, r.check_in, r.check_out, r.guests_count, r.block_reason,
             r.external_ref, r.gross_booking_value, COALESCE(g.full_name,'') AS guest_name
      FROM reservations r LEFT JOIN guests g ON g.id = r.guest_id
      WHERE r.unit_id = ? AND r.state NOT IN ('cancelled')
        AND r.check_out >= to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD')
      ORDER BY r.check_in ASC LIMIT 6`, unitId),

    all<any>(env, `
      SELECT t.id, t.title, t.kind, t.state, t.due_at, t.completed_at,
             COALESCE(${cleanerNamesSql(ready)}, cl.full_name, a.full_name, '') AS assignee_name
      FROM tasks t LEFT JOIN users a ON a.id = t.assignee_id LEFT JOIN cleaners cl ON cl.id = t.cleaner_id
      WHERE t.unit_id = ? ORDER BY COALESCE(t.due_at, t.created_at) DESC LIMIT 12`, unitId),

    all<any>(env, `
      SELECT id, title, detail, state, vendor_name, quoted_amount, final_amount,
             owner_approval_required, blocks_unit, charge_to, reported_at, resolved_at
      FROM maintenance_issues WHERE unit_id = ?
      ORDER BY reported_at DESC LIMIT 12`, unitId),

    all<any>(env, `
      SELECT id, name, quantity, condition, supplied_in_house, purchase_cost, installed_on, last_checked
      FROM inventory_items WHERE unit_id = ? ORDER BY name`, unitId),

    all<any>(env, `
      SELECT id, kind, label, instruction, rotates_after_stay, updated_at
      FROM access_credentials WHERE unit_id = ?`, unitId),

    // Statements, invoices and payout advice carry money, so they follow the same rule as the P and L.
    // An owner sees only what has been released to them.
    all<any>(env, `
      SELECT id, kind, file_name, byte_size, created_at, maintenance_id, task_id, mime_type
      FROM documents
      WHERE unit_id = ?
        ${money ? '' : "AND kind NOT IN ('statement','invoice','payout_advice')"}
        ${session.role === 'owner' ? 'AND visible_to_owner = 1' : ''}
      ORDER BY created_at DESC LIMIT 100`, unitId),

    all<any>(env, `
      SELECT actor_label, action, before_state, after_state, source, occurred_at
      FROM audit_log WHERE entity_id = ?
      ORDER BY occurred_at DESC LIMIT 20`, unitId),

    stayMonths(env, `${month}-01`, monthEndEx, { unitId }),

    one<{ avg: number | null; n: number }>(env,
      'SELECT AVG(rating) AS avg, COUNT(*) AS n FROM reviews WHERE unit_id = ?', unitId),

    // The month to date as the owner statement will work it out (functions/_lib/unitPnl.ts); any month on /units/financials.
    money ? unitMonthPnl(env, q, unitId, month) : Promise.resolve(null),
    statementSettings(q),

    // Every open job, not only the latest 12 listed above (the Overview's "Open maintenance jobs").
    one<{ n: number }>(env, `SELECT COUNT(*)::int AS n FROM maintenance_issues WHERE unit_id = ? AND state != 'resolved'`, unitId),
  ]);
  const perf = metrics(perfRows, daysInMonth);

  const pnl = money2?.pnl, companyPnl = money2?.companyPnl;
  const terms = contractView(unit.c_id ? { ...unit, id: unit.c_id, misc_charges: unit.c_misc } : null, unit, settings.defaultFeePct);

  return json({
    generatedAt: new Date().toISOString(),
    unit: {
      id: unit.id,
      unitNumber: unit.unit_number,
      channexLinked: !!unit.channex_property_id,
      propertyId: unit.property_id,
      propertyName: unit.property_name,
      addressLine: unit.address_line,
      city: unit.city,
      state: unit.state,
      postcode: unit.postcode,
      readiness: unit.readiness,
      bedrooms: unit.bedrooms,
      bathrooms: unit.bathrooms,
      maxGuests: unit.max_guests,
      sizeSqft: unit.size_sqft,
      isListed: !!unit.is_listed,
      // 0125: a showroom or warehouse is never on the channels; the screen hides the channel and occupancy parts.
      purpose: unit.purpose ?? 'rental', usedBy: unit.used_by ?? null, contractCode: unit.c_id ? terms.contractCode : null,
      listedAt: unit.listed_at,
      fittedOutAt: unit.fitted_out_at,
      channels: channels.map(c => c.channel),
      owner: {
        id: unit.owner_id, name: unit.owner_name,
        email: money ? unit.owner_email : null,
        // Contact details for the roles that manage owners; edited on the owner's page only.
        phone: money ? unit.owner_phone ?? null : null,
        address: money ? addressOf(unit) : null,
      },
      contract: unit.management_fee_pct != null ? {
        id: unit.c_id ?? null,
        managementFeePct: unit.management_fee_pct,
        startsOn: unit.starts_on, renewsOn: unit.renews_on,
      } : null,
      revenueModel: terms.revenueModel, revenueModelLabel: MODEL_LABEL[terms.revenueModel], termsLabel: terms.termsLabel,
      ...(money ? { baseRate: unit.base_rate } : {}),
    },
    performance: {
      period: month,
      occupancy: perf.occupancy,
      occupiedNights: perf.nights,
      adr: perf.adr,
      revpar: perf.revpar,
      rating: rating?.avg != null ? Number(rating.avg.toFixed(2)) : null,
      reviewCount: rating?.n ?? 0,
      ...(money ? { revenue: perf.collected, gross: perf.gross } : {}),
    },
    pnl,
    companyPnl,
    stays: stays.map(s => ({
      id: s.id, guestName: s.guest_name || null, channel: s.channel, state: s.state,
      checkIn: s.check_in, checkOut: s.check_out, guestsCount: s.guests_count,
      externalRef: s.external_ref, blockReason: s.block_reason ?? null,
      ...(money ? { grossBookingValue: s.gross_booking_value } : {}),
    })),
    tasks: tasks.map(t => ({
      id: t.id, title: t.title, kind: t.kind, state: t.state,
      dueAt: stampMyt(t.due_at), completedAt: stampMyt(t.completed_at), assigneeName: t.assignee_name || null,
    })),
    openMaintenanceCount: Number(openJobs?.n ?? 0),
    maintenance: maintenance.map(m => ({
      id: m.id, title: m.title, detail: m.detail, state: m.state,
      vendorName: m.vendor_name, ownerApprovalRequired: !!m.owner_approval_required,
      blocksUnit: !!m.blocks_unit, chargeTo: m.charge_to,
      // Raw ISO — UnitRecordPage formats these with dateShort(); a pre-formatted value would be
      // re-parsed there. (dueAt/completedAt/occurredAt below are rendered as-is, so they stay stamped.)
      reportedAt: m.reported_at, resolvedAt: m.resolved_at,
      ...(money ? { quotedAmount: m.quoted_amount, finalAmount: m.final_amount } : {}),
    })),
    inventory: inventory.map(i => ({
      id: i.id, name: i.name, quantity: i.quantity, condition: i.condition,
      suppliedInHouse: !!i.supplied_in_house, installedOn: i.installed_on, lastChecked: i.last_checked,
      ...(money ? { purchaseCost: i.purchase_cost } : {}),
    })),
    // The unit's cover: its newest photo added on the Units screen, not a photo from a cleaning or repair job.
    coverPhotoId: documents.find(d => d.kind === 'photo' && !d.maintenance_id && !d.task_id && String(d.mime_type).startsWith('image/'))?.id ?? null,
    documents: documents.map(d => ({
      id: d.id, name: d.file_name, kind: d.kind, sizeLabel: sizeLabel(d.file_name, Number(d.byte_size)), updatedAt: d.created_at,
    })),
    // Secrets are never in this payload. Reveal is a separate, audited request.
    access: access.map(a => ({
      id: a.id, kind: a.kind, label: a.label, instruction: a.instruction,
      rotatesAfterStay: !!a.rotates_after_stay, updatedAt: a.updated_at,
    })),
    activity: activity.map(a => ({
      actorLabel: a.actor_label, action: a.action, source: a.source,
      occurredAt: stampMyt(a.occurred_at) ?? a.occurred_at,
      before: a.before_state ? JSON.parse(a.before_state) : null,
      after: a.after_state ? JSON.parse(a.after_state) : null,
    })),
  });
};

function sizeLabel(fileName: string, bytes: number): string {
  const ext = /\.([a-z0-9]{1,5})$/i.exec(fileName)?.[1];
  const type = ext ? ext.toUpperCase() : 'File';
  const size = bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${type} · ${size}`;
}
