import { type Env, one, run, json, fail, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { MASTER_ROLES, invalidUnit, saveExpenses, saveContract, auditUnit, type UnitInput } from '../../_lib/properties';

/** PATCH /api/units/:id — the Properties screen's Save. Sends the whole unit; only what is present is changed.
 *  Owner name, ID number and bank details belong to the owner, so they change for every unit that owner has. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MASTER_ROLES.includes(session.role)) return fail('FORBIDDEN', 'Only management, finance and operations managers can edit units.', 403);

  const id = String(params.id);
  const b = await request.json<UnitInput>().catch(() => null);
  if (!b) return fail('VALIDATION', 'Nothing to save.', 422);
  const bad = invalidUnit(b);
  if (bad) return fail('VALIDATION', bad.message, 422, { [bad.field]: bad.message });

  const cur = await one<any>(env, 'SELECT id, property_id, owner_id, unit_number, unit_code FROM units WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That unit no longer exists.', 404);

  const now = nowIso();
  let number = cur.unit_number as string;
  const code = typeof b.unitCode === 'string' ? b.unitCode.trim() : undefined;
  // A unit still carrying a placeholder number takes its code as its number; an established number is never renamed here.
  if (code && number.startsWith('NEW-')) {
    if (await one(env, 'SELECT 1 AS x FROM units WHERE property_id = ? AND lower(unit_number) = lower(?) AND id != ?', cur.property_id, code, id)) {
      return fail('CONFLICT', 'That building already has a unit with this code.', 409, { unitCode: 'This code is already used in the building.' });
    }
    number = code;
  }

  await run(env, `
    UPDATE units SET unit_number = ?, unit_code = COALESCE(?, unit_code), listing_name = COALESCE(?, listing_name), address = COALESCE(?, address),
                     package = COALESCE(?, package), term = COALESCE(?, term), split_kind = COALESCE(?, split_kind), split_value = ?, updated_at = ?
    WHERE id = ?`,
    number, code ?? null, b.listingName ?? null, b.address ?? null, b.pkg ?? null, b.term ?? null, b.split ?? null,
    b.splitValue === undefined ? null : b.splitValue, now, id);

  if (b.ownerName !== undefined || b.ic !== undefined || b.bankName !== undefined || b.bankAccount !== undefined || b.accountHolder !== undefined) {
    await run(env, `
      UPDATE owners SET display_name = COALESCE(NULLIF(?, ''), display_name), ic_number = COALESCE(?, ic_number), bank_name = COALESCE(?, bank_name),
                        bank_account_holder = COALESCE(?, bank_account_holder), bank_account_number = COALESCE(?, bank_account_number),
                        bank_account_last4 = COALESCE(?, bank_account_last4), updated_at = ?
      WHERE id = ?`,
      b.ownerName?.trim() ?? '', b.ic ?? null, b.bankName ?? null, b.accountHolder ?? null, b.bankAccount ?? null,
      typeof b.bankAccount === 'string' ? (b.bankAccount.slice(-4) || null) : null, now, cur.owner_id);
  }
  if (b.expenses) await saveExpenses(env, id, b.expenses);
  if (b.contract) await saveContract(env, id, cur.owner_id, b.contract);

  // Banking details are recorded as changed, never copied into the audit trail.
  await auditUnit(env, session, 'unit.update', id, { fields: Object.keys(b).filter(k => !['bankAccount', 'ic', 'accountHolder'].includes(k)), ownerDetailsChanged: b.bankAccount !== undefined || b.ic !== undefined });
  return json({ ok: true });
};
