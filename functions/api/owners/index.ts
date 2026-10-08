import { maySee } from '../../_lib/access';
import { type Env, all, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { MASTER_ROLES } from '../../_lib/properties';
import { daysIn, todayMyt } from '../../_lib/ops';

const READ_ROLES = [...MASTER_ROLES, 'operations_staff'];

/** GET /api/owners?month=YYYY-MM&id= — every owner (or one, with `id`) with their units, contract and that
 *  month's figures (default: this month). Identity and bank numbers are shown only to roles that manage them. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!maySee(session, READ_ROLES)) return fail('FORBIDDEN', 'Owner records are visible to operations and finance roles.', 403);
  const banking = session.manage;

  const url = new URL(request.url);
  const month = url.searchParams.get('month') || todayMyt().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return fail('VALIDATION', 'Month must look like 2026-08.', 422);
  const days = daysIn(month);
  const id = url.searchParams.get('id');
  const owners = id
    ? await all<any>(env, 'SELECT * FROM owners WHERE id = ?', id)
    : await all<any>(env, 'SELECT * FROM owners ORDER BY display_name');
  const units = await all<any>(env, `
    SELECT u.id, u.owner_id, u.unit_number, u.split_kind, u.split_value, u.property_id, p.name AS property_name,
           c.model, c.management_fee_pct, c.grr_amount,
           COALESCE(SUM(r.collected_revenue), 0) AS revenue, COALESCE(SUM(r.check_out::date - r.check_in::date), 0) AS nights,
           (SELECT COALESCE(SUM(e.amount), 0) FROM expenses e WHERE e.unit_id = u.id AND e.charge_to = 'owner' AND substr(e.incurred_on, 1, 7) = ?) AS costs
    FROM units u JOIN properties p ON p.id = u.property_id
    LEFT JOIN owner_contracts c ON c.id = u.contract_id
    LEFT JOIN reservations r ON r.unit_id = u.id AND r.state IN ('confirmed','checked_in','checked_out')
      AND r.channel NOT IN ('maintenance_block','owner_stay') AND substr(r.check_in, 1, 7) = ?
    ${id ? 'WHERE u.owner_id = ?' : ''}
    GROUP BY u.id, p.id, p.name, c.model, c.management_fee_pct, c.grr_amount
    ORDER BY p.name, u.unit_number`, month, month, ...(id ? [id] : []));
  const contracts = await all<any>(env, `SELECT * FROM owner_contracts ${id ? 'WHERE owner_id = ?' : ''} ORDER BY starts_on DESC`, ...(id ? [id] : []));

  return json({
    generatedAt: nowIso(), month,
    data: owners.map(o => {
      const mine = contracts.find(c => c.owner_id === o.id) ?? null;
      // Owner-level default management fee (migration 0009). Absent until applied → null.
      const ownerDefault = o.default_management_fee_pct != null ? Number(o.default_management_fee_pct) : null;
      return {
        id: o.id, displayName: o.display_name, email: o.email, phone: o.phone,
        ic: banking ? o.ic_number : null, bankName: banking ? o.bank_name : null,
        bankAccount: banking ? o.bank_account_number : null, accountHolder: banking ? (o.bank_account_holder ?? o.display_name) : null,
        portalInvited: !!o.user_id,
        defaultManagementFeePct: ownerDefault,
        contract: mine ? { feePct: Number(mine.management_fee_pct), startedOn: mine.starts_on, renewsOn: mine.renews_on, endsOn: mine.ends_on ?? null } : null,
        units: units.filter(u => u.owner_id === o.id).map(u => {
          const grr = (u.model ?? (mine?.model ?? 'management')) === 'grr';
          // Fee resolution: the unit's own contract fee wins, then the owner default, then 25%.
          const unitPct = u.management_fee_pct != null ? Number(u.management_fee_pct) : null;
          const feePct = unitPct ?? ownerDefault ?? 25;
          const feeSource: 'unit' | 'owner-default' | 'fallback' = unitPct != null ? 'unit' : ownerDefault != null ? 'owner-default' : 'fallback';
          const revenue = Number(u.revenue), nights = Number(u.nights);
          const grrAmount = Number(u.grr_amount ?? mine?.grr_amount ?? 0);
          return {
            unitId: u.id, unitLabel: `${u.property_name} ${u.unit_number}`, buildingId: u.property_id, model: grr ? 'grr' : 'management',
            ...(grr ? { grrAmount } : { feePct }), feeSource,
            occupancy: Math.min(100, Math.round((nights / days) * 100)), adr: nights ? Math.round(revenue / nights) : 0,
            gross: revenue, net: grr ? grrAmount : revenue - Math.round(revenue * (feePct / 100)) - Number(u.costs),
          };
        }),
      };
    }),
  });
};

/** POST /api/owners { displayName, email, phone, ic, bankName, bankAccount, accountHolder } */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can add owners.', 403);

  const b = await request.json<any>().catch(() => null);
  const fields: Record<string, string> = {};
  if (!b?.displayName?.trim()) fields.displayName = 'Enter the owner name.';
  if (b?.email && !String(b.email).includes('@')) fields.email = 'Enter a valid email address.';
  if (Object.keys(fields).length) return fail('VALIDATION', 'Check the owner details.', 422, fields);
  if (b.email && await one(env, 'SELECT 1 AS x FROM owners WHERE lower(email) = lower(?)', b.email.trim())) return fail('DUPLICATE', 'An owner already uses that email address.', 409, { email: 'Already in use.' });

  const id = crypto.randomUUID(), now = nowIso();
  await run(env, `
    INSERT INTO owners (id, display_name, email, phone, ic_number, bank_name, bank_account_holder, bank_account_number, bank_account_last4, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, b.displayName.trim(), String(b.email ?? '').trim(), b.phone ?? null, b.ic ?? null, b.bankName ?? null, b.accountHolder ?? null,
    b.bankAccount ?? null, b.bankAccount ? String(b.bankAccount).slice(-4) : null, now, now);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'owner.create', entityTable: 'owners', entityId: id, after: { displayName: b.displayName } });
  return json({ id }, 201);
};
