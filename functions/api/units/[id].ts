import { type Env, one, run, json, fail, nowIso } from '../../_lib/db';
import { changedFields } from '../../_lib/history';
import { requireSession } from '../../_lib/auth';
import { invalidUnit, typed, saveExpenses, saveContract, auditUnit, type UnitInput } from '../../_lib/properties';

/** PATCH /api/units/:id — the Units screen's Save. Sends the whole unit; only what is present is changed.
 *  Owner name, ID number and bank details belong to the owner, so they change for every unit that owner has.
 *  A unit moved to another building takes its sub-units with it; a sub-unit cannot leave its parent's building. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can edit units.', 403);

  const id = String(params.id);
  const b = await request.json<UnitInput>().catch(() => null);
  if (!b) return fail('VALIDATION', 'Nothing to save.', 422);
  const bad = invalidUnit(b);
  if (bad) return fail('VALIDATION', bad.message, 422, { [bad.field]: bad.message });

  const cur = await one<any>(env, 'SELECT id, property_id, parent_unit_id, owner_id, unit_number, unit_code FROM units WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That unit no longer exists.', 404);

  const target = typeof b.buildingId === 'string' && b.buildingId && b.buildingId !== cur.property_id ? b.buildingId : null;
  if (target) {
    if (cur.parent_unit_id) return fail('VALIDATION', "A sub-unit stays in its parent unit's building. Move the parent unit instead.", 422, { buildingId: 'Move the parent unit instead.' });
    if (!(await one(env, 'SELECT 1 AS x FROM properties WHERE id = ?', target))) return fail('NOT_FOUND', 'That building does not exist.', 404, { buildingId: 'Pick a building.' });
  }
  const propertyId: string = target ?? cur.property_id;
  const was = await snapshot(env, id);

  const now = nowIso();
  if (typeof (b as { ownerId?: string }).ownerId === 'string') {
    const to = (b as { ownerId: string }).ownerId;
    if (!(await one(env, 'SELECT 1 AS x FROM owners WHERE id = ?', to))) return fail('NOT_FOUND', 'That owner does not exist.', 404, { ownerId: 'Pick an owner.' });
    // A contract belongs to one owner, so it does not follow the unit to the next.
    if (to !== cur.owner_id) {
      await run(env, 'UPDATE units SET owner_id = ?, contract_id = NULL, updated_at = ? WHERE id = ?', to, now, id);
      cur.owner_id = to;
    }
  }
  let number = cur.unit_number as string;
  const code = typeof b.unitCode === 'string' ? b.unitCode.trim() : undefined;
  // A unit still carrying a placeholder number takes its code as its number; an established number is never renamed here.
  if (code && number.startsWith('NEW-')) number = code;
  if ((number !== cur.unit_number || target) && await one(env, 'SELECT 1 AS x FROM units WHERE property_id = ? AND lower(unit_number) = lower(?) AND id != ?', propertyId, number, id)) {
    return fail('CONFLICT', 'That building already has a unit with this code.', 409, { unitCode: 'This code is already used in the building.' });
  }
  if (target && await one(env, `
    SELECT 1 AS x FROM units s JOIN units t ON t.property_id = ? AND lower(t.unit_number) = lower(s.unit_number) AND t.id != s.id
    WHERE s.parent_unit_id = ?`, propertyId, id)) {
    return fail('CONFLICT', 'A sub-unit of this unit has the same code as a unit already in that building.', 409, { buildingId: 'A sub-unit code is already used there.' });
  }

  await run(env, `
    UPDATE units SET property_id = ?, unit_number = ?, unit_code = COALESCE(?, unit_code), listing_name = COALESCE(?, listing_name), address = COALESCE(?, address),
                     package = COALESCE(?, package), term = COALESCE(?, term), split_kind = COALESCE(?, split_kind), split_value = ?,
                     guarantee_period = COALESCE(?, guarantee_period), bedrooms = COALESCE(?, bedrooms), bathrooms = COALESCE(?, bathrooms),
                     size_sqft = CASE WHEN ? THEN ? ELSE size_sqft END, layout_type = CASE WHEN ? THEN ? ELSE layout_type END, updated_at = ?
    WHERE id = ?`,
    propertyId, number, code ?? null, b.listingName ?? null, b.address ?? null, b.pkg ?? null, b.term ?? null, b.split ?? null,
    b.splitValue === undefined ? null : b.splitValue, b.guaranteePeriod ?? null, b.bedrooms ?? null, b.bathrooms ?? null,
    b.sizeSqft !== undefined, b.sizeSqft ?? null, b.layoutType !== undefined, b.layoutType ?? null, now, id);
  if (target) await run(env, 'UPDATE units SET property_id = ?, updated_at = ? WHERE parent_unit_id = ?', propertyId, now, id);

  // The form shows IC and bank number masked; sent back unchanged they keep the stored value.
  const ic = typed(b.ic), bankAccount = typed(b.bankAccount);
  if (b.ownerName !== undefined || ic !== undefined || b.bankName !== undefined || bankAccount !== undefined || b.accountHolder !== undefined) {
    await run(env, `
      UPDATE owners SET display_name = COALESCE(NULLIF(?, ''), display_name), ic_number = COALESCE(?, ic_number), bank_name = COALESCE(?, bank_name),
                        bank_account_holder = COALESCE(?, bank_account_holder), bank_account_number = COALESCE(?, bank_account_number),
                        bank_account_last4 = COALESCE(?, bank_account_last4), updated_at = ?
      WHERE id = ?`,
      b.ownerName?.trim() ?? '', ic ?? null, b.bankName ?? null, b.accountHolder ?? null, bankAccount ?? null,
      typeof bankAccount === 'string' ? (bankAccount.slice(-4) || null) : null, now, cur.owner_id);
  }
  if (b.expenses) await saveExpenses(env, id, b.expenses);
  if (b.contract) await saveContract(env, id, cur.owner_id, b.contract);

  // Banking details are recorded as changed, never copied into the audit trail.
  const { before, after } = changedFields(was, await snapshot(env, id));
  if (bankAccount !== undefined || ic !== undefined) { before.ownerBankOrId = 'unchanged'; after.ownerBankOrId = 'changed'; }
  await auditUnit(env, session, 'unit.update', id, after, before);
  return json({ ok: true });
};

/** The unit as the History panel shows it: names rather than ids, the contract in force. */
async function snapshot(env: Env, id: string): Promise<Record<string, unknown>> {
  const r = await one<Record<string, unknown>>(env, `
    SELECT p.name AS building, u.unit_number AS "unitNumber", u.unit_code AS "unitCode", u.listing_name AS "listingName", u.address,
           u.package, u.term, u.split_kind AS split, u.split_value AS "splitValue", u.guarantee_period AS "guaranteePeriod", u.bedrooms, u.bathrooms,
           u.size_sqft AS "sizeSqft", u.layout_type AS "layoutType",
           o.display_name AS owner, c.management_fee_pct AS "managementFeePct", c.starts_on AS "contractStartsOn", c.renews_on AS "contractRenewsOn",
           (SELECT string_agg(e.category || ' RM ' || to_char(e.amount / 100.0, 'FM999,990.00'), ', ' ORDER BY e.sort_order) FROM unit_expenses e WHERE e.unit_id = u.id) AS "monthlyCosts"
    FROM units u LEFT JOIN properties p ON p.id = u.property_id LEFT JOIN owners o ON o.id = u.owner_id LEFT JOIN owner_contracts c ON c.id = u.contract_id
    WHERE u.id = ?`, id);
  return r ?? {};
}
