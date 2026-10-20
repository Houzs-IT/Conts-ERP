import { maySee } from '../../_lib/access';
import { type Env, all, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { MASTER_ROLES } from '../../_lib/properties';
import { todayMyt } from '../../_lib/ops';
import { loadInputs, withYearToDate, computeMonth, statementSettings, type Query, type UnitRow } from '../../_lib/ownerStatement';
import { contractView } from '../../_lib/unitContract';
import { DEDUCTION_WORDS } from '../../_lib/unitCosts';
import { monthEndExclusive } from '../../_lib/revenue';
import { checkPhone } from '../../_lib/validate';
import { addressOf, altContactOf, ownerDetailsReady } from '../../_lib/ownerDetails';
import { purposeReady, codeOf, type ContractCode } from '../../_lib/unitPurpose';

const READ_ROLES = [...MASTER_ROLES, 'operations_staff'];
/** Last four characters, ignoring spaces and dashes ("680606-08-5101" -> "5101"). */
const tail = (v: unknown) => String(v).replace(/[\s-]/g, '').slice(-4);

/** GET /api/owners?month=YYYY-MM&id= — every owner (or one, with `id`) with their units, each unit's revenue model and
 *  terms, and that month's figures (default: this month) worked out by the statement engine (ownerStatement.ts), so
 *  the list, the profile cards and the statement never disagree. Identity and bank numbers are shown only to roles
 *  that manage them; money only to roles that see it. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!maySee(session, READ_ROLES)) return fail('FORBIDDEN', 'Owner records are visible to operations and finance roles.', 403);
  const banking = session.manage;

  const url = new URL(request.url);
  const month = url.searchParams.get('month') || todayMyt().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return fail('VALIDATION', 'Month must look like 2026-08.', 422);
  const id = url.searchParams.get('id');
  const ownersRead = id
    ? all<any>(env, 'SELECT * FROM owners WHERE id = ?', id)
    : all<any>(env, 'SELECT * FROM owners ORDER BY display_name');
  const q: Query = (sql, ...args) => all(env, sql, ...args);
  const settingsRead = statementSettings(q);
  const inputsRead = loadInputs(q, `${month}-01`, monthEndExclusive(month), id ? { ownerIds: [id] } : {});
  const [owners, settings, inputs, monthInputs, contracts, statements, detailsReady, portalOf, contractCodes, unitProperties] = await Promise.all([
    ownersRead, settingsRead, inputsRead,
    Promise.all([inputsRead, settingsRead]).then(([i, st]) => withYearToDate(q, i, month, st)),
    all<any>(env, `SELECT * FROM owner_contracts ${id ? 'WHERE owner_id = ?' : ''} ORDER BY starts_on DESC`, ...(id ? [id] : [])),
    // hasUnits: built by the workbook rules, so it has an Owner Income Report; months paid before Property OS carry only the payout.
    all<any>(env, `SELECT s.id, s.owner_id, s.state, EXISTS (SELECT 1 FROM statement_units su WHERE su.statement_id = s.id) AS has_units
      FROM owner_statements s WHERE s.period_start = ? ${id ? 'AND s.owner_id = ?' : ''}`, `${month}-01`, ...(id ? [id] : [])),
    ownerDetailsReady(env),
    ownersRead.then(o => portalStates(env, o)),
    purposeReady(env).then(ready => ready ? all<{ id: string; contract_code: string | null }>(env, 'SELECT id, contract_code FROM owner_contracts WHERE contract_code IS NOT NULL') : []),
    all<any>(env, `SELECT id, property_id FROM units ${id ? 'WHERE owner_id = ?' : ''}`, ...(id ? [id] : [])),
  ]);
  const months = new Map(computeMonth(month, monthInputs, settings, 'dated').map(m => [m.unitId, m]));
  const statementOf = new Map(statements.map(s => [s.owner_id, s]));
  const unitsOf = new Map<string, UnitRow[]>();
  for (const u of inputs.units) { const l = unitsOf.get(u.owner_id); if (l) l.push(u); else unitsOf.set(u.owner_id, [u]); }
  // The staff's contract codes (0125); MANAGE and PS share a model, so the stored code is read when there is one.
  const codeById = new Map(contractCodes.map(r => [r.id, r.contract_code]));
  const propertyOf = new Map(unitProperties.map(r => [r.id, r.property_id]));

  return json({
    generatedAt: nowIso(), month,
    // false until migration 0110 is applied: the owner page then hides the address and alternate contact.
    detailsReady,
    data: owners.map(o => {
      const mine = contracts.find(c => c.owner_id === o.id) ?? null;
      // Owner-level default management fee (migration 0009). Absent until applied → null.
      const ownerDefault = o.default_management_fee_pct != null ? Number(o.default_management_fee_pct) : null;
      const st = statementOf.get(o.id);
      return {
        id: o.id, displayName: o.display_name, email: o.email, phone: o.phone,
        legalName: o.legal_name ?? null, notes: o.notes ?? null, address: addressOf(o), altContact: altContactOf(o),
        // Identity and bank numbers leave the server only as their last four characters; the full value needs an
        // audited reveal (GET /api/owners/:id/reveal), the same rule as access codes and the Payouts screen.
        ic: null, bankAccount: null,
        icLast4: banking && o.ic_number ? tail(o.ic_number) : null,
        bankAccountLast4: banking ? (o.bank_account_last4 ?? (o.bank_account_number ? tail(o.bank_account_number) : null)) : null,
        // For the list's filter: whether payout details are on file (never the numbers themselves).
        hasBankDetails: !!(o.bank_name && (o.bank_account_number || o.bank_account_last4)),
        bankName: banking ? o.bank_name : null, accountHolder: banking ? (o.bank_account_holder ?? o.display_name) : null,
        portalInvited: !!o.user_id,
        portal: portalOf.get(o.id) ?? { state: 'none', invitedAt: null, lastLoginAt: null },
        defaultManagementFeePct: ownerDefault,
        contract: mine ? { feePct: Number(mine.management_fee_pct), startedOn: mine.starts_on, renewsOn: mine.renews_on, endsOn: mine.ends_on ?? null } : null,
        statement: st ? { id: st.id, state: st.state, hasUnits: !!st.has_units } : null,
        units: (unitsOf.get(o.id) ?? []).map(u => {
          const m = months.get(u.id)!;
          const view = contractView(u.contract_id ? { ...u, id: u.contract_id, misc_charges: u.contract_misc } : null, { ...u, misc_charges: u.unit_misc }, settings.defaultFeePct);
          const fixed = m.terms.basis !== 'share';
          const unitPct = u.management_fee_pct != null ? Number(u.management_fee_pct) : null;
          return {
            unitId: u.id, unitLabel: `${u.property_name} ${u.unit_number}`, buildingId: propertyOf.get(u.id),
            // model: the two-way split older screens filter on; revenueModel: the five models.
            model: m.terms.model === 'grr' ? 'grr' : 'management', revenueModel: m.terms.model, termsLabel: view.termsLabel,
            contractCode: u.contract_id ? codeOf(m.terms.model, codeById.get(u.contract_id)) as ContractCode : null,
            ...(fixed ? { grrAmount: m.terms.fixedRent } : { feePct: 100 - (m.ownerPct ?? 0) }),
            feeSource: unitPct != null ? 'unit' : ownerDefault != null ? 'owner-default' : 'fallback',
            occupancy: Math.min(100, Math.round(m.occupancy * 100)), adr: m.nights ? Math.round(m.gross / m.nights) : 0,
            gross: m.gross, net: m.netPayout,
            ...(banking ? {
              figures: {
                income: m.gross, costs: m.deductions, operatorShare: m.operatorShare, guarantee: m.guarantee, topUp: m.topUp, fixedRent: m.terms.model === 'master_lease' ? 0 : m.fixedRent,
                payoutBeforeAdjustments: m.payoutBeforeAdjustments, adjustments: m.adjustmentsTotal, netPayout: m.netPayout, nights: m.nights,
                costLines: m.deductionGroups.filter(g => g.amount).map(g => ({ label: DEDUCTION_WORDS[g.category] ?? g.label, amount: g.amount })),
              },
            } : {}),
          };
        }),
      };
    }),
  });
};

/** Where each owner's portal login stands: none yet, invited and never signed in (on its temporary password),
 *  in use, or switched off; and when the newest invitation went out (owner.invite / owner.resend_invite). */
async function portalStates(env: Env, owners: any[]) {
  const ids = owners.filter(o => o.user_id).map(o => o.id);
  const out = new Map<string, { state: 'none' | 'invited' | 'active' | 'off'; invitedAt: string | null; lastLoginAt: string | null }>();
  if (!ids.length) return out;
  const rows = await all<any>(env, `
    SELECT o.id, u.must_change_password, u.last_login_at, u.is_active, u.created_at,
      (SELECT max(a.occurred_at) FROM audit_log a WHERE a.entity_table = 'owners' AND a.entity_id = o.id
         AND a.action IN ('owner.invite', 'owner.resend_invite')) AS invited_at
    FROM owners o JOIN users u ON u.id = o.user_id
    WHERE o.id IN (${ids.map(() => '?').join(', ')})`, ...ids);
  for (const r of rows) {
    const state = !r.is_active ? 'off' : r.must_change_password && !r.last_login_at ? 'invited' : 'active';
    out.set(r.id, { state, invitedAt: r.invited_at ?? r.created_at, lastLoginAt: r.last_login_at ?? null });
  }
  return out;
}

/** POST /api/owners { displayName, email, phone, ic, bankName, bankAccount, accountHolder } */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can add owners.', 403);

  const b = await request.json<any>().catch(() => null);
  const fields: Record<string, string> = {};
  if (!b?.displayName?.trim()) fields.displayName = 'Enter the owner name.';
  if (b?.email && !String(b.email).includes('@')) fields.email = 'Enter a valid email address.';
  checkPhone(fields, 'phone', b?.phone);
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
