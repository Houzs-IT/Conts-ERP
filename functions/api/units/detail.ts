import { type Env, all, one, json, fail } from '../../_lib/db';
import { requireSession, canSeeFinance } from '../../_lib/auth';
import { stampMyt } from '../../_lib/ops';

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

  const unit = await one<any>(env, `
    SELECT u.*, p.name AS property_name, p.address_line, p.city, p.state, p.postcode,
           o.id AS owner_id, o.display_name AS owner_name, o.email AS owner_email,
           c.management_fee_pct, c.renews_on, c.starts_on
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

  const money = canSeeFinance(session.role);
  const month = new Date().toISOString().slice(0, 7);

  const channels = await all<{ channel: string }>(env,
    'SELECT channel FROM unit_channels WHERE unit_id = ? AND is_active = 1', unitId);

  const stays = await all<any>(env, `
    SELECT r.id, r.channel, r.state, r.check_in, r.check_out, r.guests_count,
           r.external_ref, r.gross_booking_value, COALESCE(g.full_name,'') AS guest_name
    FROM reservations r LEFT JOIN guests g ON g.id = r.guest_id
    WHERE r.unit_id = ? AND r.state NOT IN ('cancelled')
    ORDER BY r.check_in DESC LIMIT 12`, unitId);

  const tasks = await all<any>(env, `
    SELECT t.id, t.title, t.kind, t.state, t.due_at, t.completed_at,
           COALESCE(a.full_name,'') AS assignee_name
    FROM tasks t LEFT JOIN users a ON a.id = t.assignee_id
    WHERE t.unit_id = ? ORDER BY COALESCE(t.due_at, t.created_at) DESC LIMIT 12`, unitId);

  const maintenance = await all<any>(env, `
    SELECT id, title, detail, state, vendor_name, quoted_amount, final_amount,
           owner_approval_required, blocks_unit, charge_to, reported_at, resolved_at
    FROM maintenance_issues WHERE unit_id = ?
    ORDER BY reported_at DESC LIMIT 12`, unitId);

  const inventory = await all<any>(env, `
    SELECT id, name, quantity, condition, supplied_in_house, purchase_cost, installed_on, last_checked
    FROM inventory_items WHERE unit_id = ? ORDER BY name`, unitId);

  const access = await all<any>(env, `
    SELECT id, kind, label, instruction, rotates_after_stay, updated_at
    FROM access_credentials WHERE unit_id = ?`, unitId);

  const activity = await all<any>(env, `
    SELECT actor_label, action, before_state, after_state, source, occurred_at
    FROM audit_log WHERE entity_id = ? OR entity_table = 'units' AND entity_id = ?
    ORDER BY occurred_at DESC LIMIT 20`, unitId, unitId);

  const perf = await one<any>(env, `
    SELECT COALESCE(SUM(check_out::date - check_in::date),0) AS nights,
           COALESCE(SUM(collected_revenue),0) AS revenue,
           COALESCE(SUM(gross_booking_value),0) AS gross
    FROM reservations
    WHERE unit_id = ? AND state IN ('confirmed','checked_in','checked_out')
      AND channel NOT IN ('maintenance_block','owner_stay')
      AND substr(check_in, 1, 7) = ?`, unitId, month);

  const rating = await one<{ avg: number | null; n: number }>(env,
    'SELECT AVG(rating) AS avg, COUNT(*) AS n FROM reviews WHERE unit_id = ?', unitId);

  const nights = perf?.nights ?? 0;
  const revenue = perf?.revenue ?? 0;
  const daysInMonth = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();

  // The gross-to-net chain, only for finance-permitted roles.
  let pnl: { label: string; amount: number; type: string }[] | undefined;
  if (money) {
    const expenses = await all<{ category: string; total: number }>(env, `
      SELECT category, SUM(amount) AS total FROM expenses
      WHERE unit_id = ? AND substr(incurred_on, 1, 7) = ?
      GROUP BY category`, unitId, month);
    const feePct = unit.management_fee_pct ?? 25;
    const fee = Math.round(revenue * (feePct / 100));
    const expTotal = expenses.reduce((s, e) => s + e.total, 0);
    pnl = [
      { label: 'Gross booking value', amount: perf?.gross ?? 0, type: 'gross' },
      { label: `Management fee · ${feePct}%`, amount: -fee, type: 'fee' },
      ...expenses.map(e => ({
        label: e.category.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()),
        amount: -e.total, type: 'expense',
      })),
      { label: 'Net payout', amount: revenue - fee - expTotal, type: 'net' },
    ];
  }

  return json({
    generatedAt: new Date().toISOString(),
    unit: {
      id: unit.id,
      unitNumber: unit.unit_number,
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
      listedAt: unit.listed_at,
      fittedOutAt: unit.fitted_out_at,
      channels: channels.map(c => c.channel),
      owner: {
        id: unit.owner_id, name: unit.owner_name,
        email: canSeeFinance(session.role) ? unit.owner_email : null,
      },
      contract: unit.management_fee_pct != null ? {
        managementFeePct: unit.management_fee_pct,
        startsOn: unit.starts_on, renewsOn: unit.renews_on,
      } : null,
      ...(money ? { baseRate: unit.base_rate } : {}),
    },
    performance: {
      period: month,
      occupancy: Number(((nights / daysInMonth) * 100).toFixed(1)),
      occupiedNights: nights,
      adr: nights ? Math.round(revenue / nights) : 0,
      revpar: Math.round(revenue / daysInMonth),
      rating: rating?.avg != null ? Number(rating.avg.toFixed(2)) : null,
      reviewCount: rating?.n ?? 0,
      ...(money ? { revenue, gross: perf?.gross ?? 0 } : {}),
    },
    pnl,
    stays: stays.map(s => ({
      id: s.id, guestName: s.guest_name || null, channel: s.channel, state: s.state,
      checkIn: s.check_in, checkOut: s.check_out, guestsCount: s.guests_count,
      externalRef: s.external_ref,
      ...(money ? { grossBookingValue: s.gross_booking_value } : {}),
    })),
    tasks: tasks.map(t => ({
      id: t.id, title: t.title, kind: t.kind, state: t.state,
      dueAt: stampMyt(t.due_at), completedAt: stampMyt(t.completed_at), assigneeName: t.assignee_name || null,
    })),
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
