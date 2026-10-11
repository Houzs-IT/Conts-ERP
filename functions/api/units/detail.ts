import { type Env, all, one, json, fail, mytToday } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { stampMyt } from '../../_lib/ops';
import { stayMonths, metrics, monthEndExclusive, daysInMonth as daysInMonthOf } from '../../_lib/revenue';
import { loadInputs, computeMonth, statementSettings, fmtPct, type Query } from '../../_lib/ownerStatement';
import { contractView, unitExample } from '../../_lib/unitContract';
import { MODEL_LABEL } from '../../_lib/revenueModel';
import { DEDUCTION_WORDS } from '../../_lib/unitCosts';
import { addressOf, ownerDetailsReady } from '../../_lib/ownerDetails';

const PAYER_LABEL: Record<string, string> = { the_conts: 'The Conts', tenant: 'Tenant', guest_deposit: 'Guest', warranty: 'Warranty' };
const CATEGORY_LABEL: Record<string, string> = {
  electricity: 'Electricity', water: 'Water', internet: 'Internet', sewerage: 'Indah Water', cleaning: 'Cleaning', housekeeping: 'Cleaning',
  maintenance: 'Maintenance', utilities: 'Utilities', other: 'Misc', consumables: 'Consumables', furniture: 'Furniture',
};

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
  const unit = await one<any>(env, `
    SELECT u.*, p.name AS property_name, p.address_line, p.city, p.state, p.postcode,
           o.id AS owner_id, o.display_name AS owner_name, o.email AS owner_email, o.phone AS owner_phone,
           ${ownerAddress ? 'o.address_lines, o.address_postcode, o.address_city, o.address_state, o.address_country,' : ''}
           c.management_fee_pct, c.renews_on, c.starts_on, c.id AS c_id, c.revenue_model, c.model, c.minimum_guarantee, c.grr_amount,
           c.agent_fee_pct, c.agent_name, c.tenant_name, c.deposit_amount, c.ends_on, c.guarantee_starts_on, c.guarantee_ends_on, c.misc_charges AS c_misc
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

  const money = session.manage;
  const month = mytToday().slice(0, 7);

  // Independent reads, so they go out together: each one is its own connection (db.ts).
  // Occupancy, ADR and RevPAR as everywhere else (functions/_lib/revenue.ts): gross value and nights split by night
  // into the month. The money chain is the month so far worked out the way the owner statement will be.
  const monthEndEx = monthEndExclusive(month), daysInMonth = daysInMonthOf(month);
  // The money chain, the worked example and the settings all read the same settings and month inputs: asked once
  // per request (27 queries became 20), since a Worker holds at most six connections at a time.
  const asked = new Map<string, Promise<any[]>>();
  const q: Query = (sql, ...args) => {
    const key = JSON.stringify([sql, args]);
    if (!asked.has(key)) asked.set(key, all(env, sql, ...args));
    return asked.get(key)! as Promise<any>;
  };
  const [channels, stays, tasks, maintenance, inventory, access, documents, activity, perfRows, rating, statement, settings, example, otherPaid] = await Promise.all([
    all<{ channel: string }>(env,
      'SELECT channel FROM unit_channels WHERE unit_id = ? AND is_active = 1', unitId),

    // The stay in the unit now and the next few. The full history is paged by /api/units/stays.
    all<any>(env, `
      SELECT r.id, r.channel, r.state, r.check_in, r.check_out, r.guests_count,
             r.external_ref, r.gross_booking_value, COALESCE(g.full_name,'') AS guest_name
      FROM reservations r LEFT JOIN guests g ON g.id = r.guest_id
      WHERE r.unit_id = ? AND r.state NOT IN ('cancelled')
        AND r.check_out >= to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD')
      ORDER BY r.check_in ASC LIMIT 6`, unitId),

    all<any>(env, `
      SELECT t.id, t.title, t.kind, t.state, t.due_at, t.completed_at,
             COALESCE(a.full_name,'') AS assignee_name
      FROM tasks t LEFT JOIN users a ON a.id = t.assignee_id
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
      SELECT id, kind, file_name, byte_size, created_at
      FROM documents
      WHERE unit_id = ?
        ${money ? '' : "AND kind NOT IN ('statement','invoice','payout_advice')"}
        ${session.role === 'owner' ? 'AND visible_to_owner = 1' : ''}
      ORDER BY created_at DESC LIMIT 100`, unitId),

    all<any>(env, `
      SELECT actor_label, action, before_state, after_state, source, occurred_at
      FROM audit_log WHERE entity_id = ? OR entity_table = 'units' AND entity_id = ?
      ORDER BY occurred_at DESC LIMIT 20`, unitId, unitId),

    stayMonths(env, `${month}-01`, monthEndEx, { unitId }),

    one<{ avg: number | null; n: number }>(env,
      'SELECT AVG(rating) AS avg, COUNT(*) AS n FROM reviews WHERE unit_id = ?', unitId),

    money ? Promise.all([statementSettings(q), loadInputs(q, `${month}-01`, monthEndEx, { unitId })])
      .then(([settings, inputs]) => {
        const m = computeMonth(month, inputs, settings, 'dated').find(x => x.unitId === unitId) ?? null;
        return m ? { m, channelOf: new Map(inputs.stays.map(st => [st.id, st.channel])) } : null;
      })
      : Promise.resolve(null),
    statementSettings(q),
    money ? unitExample(q, unitId, month) : Promise.resolve(null),
    // Costs on the unit paid by someone other than the owner: the unit's own profit and loss, never the statement.
    money ? all<any>(env, `SELECT category, charge_to, description, amount, incurred_on FROM expenses
      WHERE unit_id = ? AND charge_to <> 'owner' AND incurred_on >= ? AND incurred_on < ? ORDER BY incurred_on`, unitId, `${month}-01`, monthEndEx) : Promise.resolve([]),
  ]);
  const perf = metrics(perfRows, daysInMonth);

  // Under each P&L row, what makes it up, as an Airbnb earnings page lists it: every reservation (guest, dates, nights,
  // channel) under the income, every bill under its deduction, every credit or charge under Owner Adjustments.
  type Item = { label: string; amount: number };
  type PnlRow = { label: string; amount: number; type: string; items?: Item[] };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dm = (iso: string) => `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]}`;
  const CHANNEL: Record<string, string> = { airbnb: 'Airbnb', booking_com: 'Booking.com', agoda: 'Agoda', direct: 'Direct' };
  const m = statement?.m ?? null;
  const lineItems = (type: string, category: string | null): Item[] => (m?.lines ?? []).filter(l => l.type === type && (category == null || l.category === category)).map(l => {
    if (type === 'gross') {
      // The generator writes "<unit> · <guest> · <in> to <out>": the unit is already the page's, so it is left off.
      const s2 = /(?:^|· )([^·]*?) · (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})/.exec(l.description);
      const ch = l.reservationId ? CHANNEL[statement?.channelOf.get(l.reservationId) ?? ''] ?? null : null;
      const nights = l.quantity != null ? `${l.quantity} ${l.quantity === 1 ? 'night' : 'nights'}` : null;
      return { label: s2 ? [s2[1], `${dm(s2[2])} – ${dm(s2[3])}`, nights, ch].filter(Boolean).join(' · ') : l.description, amount: l.amount };
    }
    return { label: `${l.description} · ${dm(l.occurredOn)}`, amount: l.amount };
  });
  const ownerAdjustments = (m?.lines ?? []).filter(l => l.type === 'adjustment' && !['guarantee_top_up', 'fixed_rent'].includes(l.category ?? ''))
    .map(l => ({ label: `${l.description} · ${dm(l.occurredOn)}`, amount: l.amount }));

  let pnl: PnlRow[] | undefined;
  if (m) {
    pnl = m.terms.basis === 'none'
      ? [{ label: 'Master lease: no owner statement', amount: 0, type: 'gross' }]
      : m.terms.basis === 'fixed_rent'
      ? [{ label: 'Fixed monthly rent', amount: m.fixedRent, type: 'gross' }]
      : [
        { label: m.terms.model === 'long_term' ? 'Gross Income (monthly rent from tenant)' : 'Gross Income (reservations)', amount: m.gross, type: 'gross',
          items: m.terms.model === 'long_term' ? undefined : (r => (r.length ? r : [{ label: 'No reservations this month', amount: 0 }]))(lineItems('gross', null)) },
        ...m.deductionGroups.filter(g => g.amount).map(g => ({ label: DEDUCTION_WORDS[g.category] ?? g.label, amount: -g.amount, type: 'expense',
          items: g.category === 'misc' ? undefined : lineItems('expense', g.category) })),
        { label: m.terms.model === 'long_term' ? `${fmtPct(100 - (m.ownerPct ?? 0))} To Operator (of the rent)` : `${fmtPct(100 - (m.ownerPct ?? 0))} To Operator`, amount: -m.operatorShare, type: 'fee' },
        ...(m.topUp ? [{ label: 'Minimum Guarantee Top-up', amount: m.topUp, type: 'adjustment' }] : []),
      ];
    // The owner's credits and charges (owner_adjustments, e.g. the building's maintenance fee from the workbook) come off
    // after the split, as on every statement already sent.
    if (m.adjustmentsTotal) pnl.push({ label: m.adjustmentsTotal < 0 ? 'Owner Adjustments (charges), after the split' : 'Owner Adjustments (credits), after the split', amount: m.adjustmentsTotal, type: 'adjustment', items: ownerAdjustments });
    pnl.push({ label: 'Net Payout to Owner', amount: m.netPayout, type: 'net' });
  }
  // The company's side of the unit this month: what it keeps or pays under the contract, and the costs it (or a
  // tenant or guest) paid, which never reach the owner statement.
  let companyPnl: PnlRow[] | undefined;
  if (m && example) {
    // One row per kind and payer, largest first, with every bill under it.
    const byPayer = new Map<string, Item[]>();
    for (const r of otherPaid) {
      const k = `${CATEGORY_LABEL[r.category] ?? r.category} (paid by ${PAYER_LABEL[r.charge_to] ?? r.charge_to})`;
      byPayer.set(k, [...(byPayer.get(k) ?? []), { label: `${r.description || CATEGORY_LABEL[r.category] || r.category} · ${dm(String(r.incurred_on))}`, amount: -Number(r.amount) }]);
    }
    const others: PnlRow[] = [...byPayer.entries()].map(([label, items]) => ({ label, amount: items.reduce((n, i) => n + i.amount, 0), type: 'expense', items }))
      .sort((a, b) => a.amount - b.amount);
    const othersTotal = others.reduce((n, l) => n + l.amount, 0);
    if (example.company) {
      companyPnl = [
        { label: 'Unit income (reservations)', amount: example.company.income, type: 'gross' },
        { label: 'Costs on the unit (all payers)', amount: -example.company.costs, type: 'expense' },
        { label: m.terms.model === 'master_lease' ? 'Lease rent paid to owner' : 'Guaranteed rent paid to owner', amount: -example.company.rentToOwner, type: 'fee' },
        { label: "The Conts' result", amount: example.company.result, type: 'net' },
      ];
    } else {
      companyPnl = [
        { label: m.terms.model === 'long_term' ? 'Operator share' : `${fmtPct(100 - (m.ownerPct ?? 0))} To Operator (management and agent)`, amount: m.operatorShare, type: 'gross' },
        ...(m.topUp ? [{ label: 'Minimum guarantee top-up paid', amount: -m.topUp, type: 'fee' }] : []),
        ...others,
        { label: "The Conts' result", amount: m.operatorShare - m.topUp + othersTotal, type: 'net' },
      ];
    }
  }
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
      listedAt: unit.listed_at,
      fittedOutAt: unit.fitted_out_at,
      channels: channels.map(c => c.channel),
      owner: {
        id: unit.owner_id, name: unit.owner_name,
        email: session.manage ? unit.owner_email : null,
        // Contact details for the roles that manage owners; edited on the owner's page only.
        phone: session.manage ? unit.owner_phone ?? null : null,
        address: session.manage ? addressOf(unit) : null,
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
