import { type Env, one, all, run, json, fail, audit, nowIso } from '../../_lib/db';
import { changedFields } from '../../_lib/history';
import { requireSession } from '../../_lib/auth';
import { invalidUnit, ownerFieldIn, saveExpenses, saveCleaningPrice, saveContract, auditUnit, type UnitInput } from '../../_lib/properties';
import { purposeReady, saveBays, codesFor, codeOf, PURPOSE_LABEL, CODE_LABEL, type Purpose } from '../../_lib/unitPurpose';
import { modelOf } from '../../_lib/revenueModel';
import { todayMyt } from '../../_lib/ops';

/** PATCH /api/units/:id — the Units screen's Save. Sends the whole unit; only what is present is changed.
 *  The owner is picked by ownerId; their name, ID number and bank details are edited on the owner's page only, so a
 *  request carrying any of them is refused (422).
 *  A unit moved to another building takes its sub-units with it; a sub-unit cannot leave its parent's building. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can edit units.', 403);

  const id = String(params.id);
  const b = await request.json<UnitInput>().catch(() => null);
  if (!b || typeof b !== 'object') return fail('VALIDATION', 'Nothing to save.', 422);
  const ownerField = ownerFieldIn(b);
  if (ownerField) return fail('VALIDATION', "The owner's name, IC and bank details are edited on the owner's page, not on the unit.", 422, { [ownerField]: "Edit this on the owner's page." });
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
  const ready = await purposeReady(env);
  // A purpose change (0125). A showroom or warehouse is never on the channels, and its contract can only be a lease.
  const purpose = ready && typeof b.purpose === 'string' ? b.purpose as Purpose : undefined;
  let endContract: { id: string; code: string; shared: boolean } | null = null;
  if (purpose) {
    const now0 = await one<any>(env, `SELECT u.purpose, u.channex_property_id, c.id AS c_id, c.revenue_model, c.model, c.minimum_guarantee, c.contract_code, u.package,
      (SELECT COUNT(*) FROM units x WHERE x.contract_id = c.id AND x.id <> u.id) AS shared
      FROM units u LEFT JOIN owner_contracts c ON c.id = u.contract_id WHERE u.id = ?`, id);
    if (now0 && now0.purpose !== purpose) {
      if (purpose !== 'rental' && now0.channex_property_id) {
        return fail('CHANNEL_LINKED', `This unit is connected to the channels. Disconnect it on the Overview tab before making it a ${PURPOSE_LABEL[purpose].toLowerCase()}.`, 409, { purpose: 'Disconnect the channels first.' });
      }
      if (now0.c_id) {
        const code = codeOf(modelOf({ ...now0, contract_id: now0.c_id }), now0.contract_code);
        if (!codesFor(purpose).includes(code)) {
          if (!b.endContract) {
            return fail('CONTRACT_MISMATCH', `Its ${code} contract (${CODE_LABEL[code]}) does not fit a ${PURPOSE_LABEL[purpose].toLowerCase()} unit. To go ahead, end it today (it stays in the contract history), then add a ${codesFor(purpose).join(' or ')} contract.`, 409, { purpose: 'The contract does not fit.', endContract: code });
          }
          endContract = { id: now0.c_id, code, shared: Number(now0.shared) > 0 };
        }
      }
    }
  }
  const was = await snapshot(env, id);

  const now = nowIso();
  if (typeof b.ownerId === 'string') {
    const to = b.ownerId;
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
  if (ready && (purpose || b.usedBy !== undefined || b.beds !== undefined)) {
    await run(env, `UPDATE units SET purpose = COALESCE(?, purpose), used_by = CASE WHEN ? THEN ? ELSE used_by END,
      beds = CASE WHEN ? THEN ?::text::jsonb ELSE beds END, updated_at = ? WHERE id = ?`,
      purpose ?? null, b.usedBy !== undefined, b.usedBy ?? null, b.beds !== undefined, JSON.stringify(b.beds ?? []), now, id);
    // Not sold anywhere: off the channel list, and nothing left waiting to be sent to Channex.
    if (purpose && purpose !== 'rental') {
      await run(env, 'UPDATE units SET is_listed = 0 WHERE id = ?', id);
      await run(env, "DELETE FROM channex_outbox WHERE unit_id = ? AND status IN ('queued','failed')", id);
    }
  }
  if (ready && b.parkingBays !== undefined) await saveBays(env, id, b.parkingBays);
  if (endContract) {
    const today = todayMyt();
    // The contract stays in the unit's history; a record shared with other units keeps serving them unchanged.
    if (!endContract.shared) await run(env, 'UPDATE owner_contracts SET ends_on = CASE WHEN ends_on IS NULL OR ends_on > ? THEN ? ELSE ends_on END, unit_id = COALESCE(unit_id, ?) WHERE id = ?', today, today, id, endContract.id);
    await run(env, 'UPDATE units SET contract_id = NULL, updated_at = ? WHERE id = ?', now, id);
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'contract.end', entityTable: 'owner_contracts', entityId: endContract.id,
      after: { unitId: id, endsOn: today, reason: `Unit made a ${purpose}`, code: endContract.code, shared: endContract.shared } });
  }
  if (b.cleaningPrice !== undefined) await saveCleaningPrice(env, id, b.cleaningPrice ?? 0);
  if (b.deepCleaningPrice !== undefined) await saveCleaningPrice(env, id, b.deepCleaningPrice ?? 0, 'cleaning_deep');

  if (b.expenses) await saveExpenses(env, id, b.expenses);
  if (b.contract) await saveContract(env, id, cur.owner_id, b.contract);

  const { before, after } = changedFields(was, await snapshot(env, id));
  await auditUnit(env, session, 'unit.update', id, after, before);
  return json({ ok: true });
};

/** The unit as the History panel shows it: names rather than ids, the contract in force. */
async function snapshot(env: Env, id: string): Promise<Record<string, unknown>> {
  const r = await one<Record<string, unknown>>(env, `
    SELECT p.name AS building, u.unit_number AS "unitNumber", u.unit_code AS "unitCode", u.listing_name AS "listingName", u.address,
           u.package, u.term, u.split_kind AS split, u.split_value AS "splitValue", u.guarantee_period AS "guaranteePeriod", u.bedrooms, u.bathrooms, u.size_sqft AS "sizeSqft", u.layout_type AS "layoutType",
           ${(await purposeReady(env)) ? `u.purpose, u.used_by AS "usedBy", u.beds::text AS beds, (SELECT string_agg(b.lot_number || COALESCE(' (' || b.level || ')', ''), ', ' ORDER BY b.sort_order) FROM unit_parking_bays b WHERE b.unit_id = u.id) AS "parkingBays",` : ''}
           o.display_name AS owner, (SELECT e.amount FROM unit_expenses e WHERE e.unit_id = u.id AND e.category = 'cleaning' ORDER BY e.sort_order LIMIT 1) AS "cleaningPrice",
           (SELECT e.amount FROM unit_expenses e WHERE e.unit_id = u.id AND e.category = 'cleaning_deep' ORDER BY e.sort_order LIMIT 1) AS "deepCleaningPrice", c.management_fee_pct AS "managementFeePct", c.starts_on AS "contractStartsOn", c.renews_on AS "contractRenewsOn",
           (SELECT string_agg(e.category || ' RM ' || to_char(e.amount / 100.0, 'FM999,990.00'), ', ' ORDER BY e.sort_order) FROM unit_expenses e WHERE e.unit_id = u.id) AS "monthlyCosts"
    FROM units u LEFT JOIN properties p ON p.id = u.property_id LEFT JOIN owners o ON o.id = u.owner_id LEFT JOIN owner_contracts c ON c.id = u.contract_id
    WHERE u.id = ?`, id);
  return r ?? {};
}

/** DELETE /api/units/:id — removes a unit added by mistake (staff sheet UNIT, 17 Oct 2026). Only a unit nothing real
 *  hangs off: no sub-units, reservations, statements, expenses, contracts, cleaning or maintenance jobs, owner credits
 *  or charges, Agent-to-let records, and not connected to the channels. Otherwise it is refused with what is in the
 *  way, and the unit can be taken out of use instead (its state set to Blocked). What exists only for the unit (its
 *  settings, prices, car park bays, access codes and files) goes with it. Audited. */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can delete units.', 403);
  const id = String(params.id);
  const u = await one<any>(env, `SELECT u.id, u.unit_number, u.unit_code, u.listing_name, u.contract_id, u.channex_property_id, u.owner_id, p.name AS building
    FROM units u JOIN properties p ON p.id = u.property_id WHERE u.id = ?`, id);
  if (!u) return fail('NOT_FOUND', 'That unit no longer exists.', 404);

  const lettings = await one<{ x: number }>(env, "SELECT 1 AS x FROM information_schema.tables WHERE table_schema = 'pos' AND table_name = 'unit_lettings'");
  // Everything that would be lost or left pointing at nothing, counted in one query.
  const c = await one<Record<string, number>>(env, `SELECT
      (SELECT COUNT(*) FROM units WHERE parent_unit_id = $1) AS sub_units,
      (SELECT COUNT(*) FROM reservations WHERE unit_id = $1) AS reservations,
      (SELECT COUNT(*) FROM statement_units WHERE unit_id = $1) + (SELECT COUNT(*) FROM statement_lines WHERE unit_id = $1) AS statements,
      (SELECT COUNT(*) FROM expenses WHERE unit_id = $1) AS expenses,
      (SELECT COUNT(*) FROM owner_contracts WHERE unit_id = $1) + (SELECT COUNT(*) FROM units WHERE id = $1 AND contract_id IS NOT NULL) AS contracts,
      (SELECT COUNT(*) FROM tasks WHERE unit_id = $1) + (SELECT COUNT(*) FROM maintenance_issues WHERE unit_id = $1) AS jobs,
      (SELECT COUNT(*) FROM owner_adjustments WHERE unit_id = $1) AS adjustments
      ${lettings ? ', (SELECT COUNT(*) FROM unit_lettings WHERE unit_id = $1) AS lettings' : ''}`, id);
  const label = `${u.building} ${u.unit_code || u.unit_number}`;
  const found = ([
    ['HAS_SUB_UNITS', 'sub_units', 'sub-unit'], ['HAS_RESERVATIONS', 'reservations', 'reservation'], ['HAS_STATEMENTS', 'statements', 'owner statement line'],
    ['HAS_EXPENSES', 'expenses', 'expense'], ['HAS_CONTRACT', 'contracts', 'contract'], ['HAS_JOBS', 'jobs', 'cleaning or maintenance job'],
    ['HAS_ADJUSTMENTS', 'adjustments', 'owner adjustment'], ['HAS_LETTINGS', 'lettings', 'Agent-to-let record'],
  ] as const).map(([code, key, what]) => ({ code: code as string, n: Number(c?.[key] ?? 0), what: what as string })).filter(f => f.n > 0);
  if (u.channex_property_id) found.push({ code: 'CHANNEL_LINKED', n: 1, what: 'channel connection' });
  if (found.length) {
    const list = found.map(f => `${f.n} ${f.what}${f.n === 1 ? '' : 's'}`).join(', ');
    return fail(found[0].code, `${label} has ${list}, so it cannot be deleted. Set its state to Blocked to take it out of use instead.`, 409);
  }

  const docs = await all<{ storage_key: string }>(env, 'SELECT storage_key FROM documents WHERE unit_id = ?', id);
  const before = await snapshot(env, id);
  await run(env, 'DELETE FROM units WHERE id = ?', id);
  // Files are removed after the record; a storage hiccup leaves an orphan file, never a half-deleted unit.
  if (env.MEDIA) for (const d of docs) await env.MEDIA.delete(d.storage_key).catch(() => {});
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'unit.delete', entityTable: 'units', entityId: id, before: { ...before, label, files: docs.length } });
  return json({ ok: true });
};
