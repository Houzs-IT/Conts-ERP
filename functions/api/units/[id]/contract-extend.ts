import { type Env, one, run, json, fail, audit, nowIso } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { checkDate } from '../../../_lib/validate';
import { modelOf } from '../../../_lib/revenueModel';
import { purposeReady, codesFor, codeOf, type Purpose } from '../../../_lib/unitPurpose';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const dayBefore = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);

/** POST /api/units/:id/contract-extend { documentId, startsOn, endsOn?, renewsOn? }
 *  Extends or renews the unit's contract for a new period on the same terms (staff sheet UNIT, 17 Oct 2026). The
 *  signed agreement or memo for the new period is required: upload it first (POST /api/documents, kind 'contract',
 *  this unit) and send its id. The current contract ends the day before the new period and stays in the unit's
 *  history; a contract record shared with other units keeps serving them unchanged. Different terms are a new
 *  contract on the Contract tab instead. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only finance and management can extend a contract.', 403);
  if (!(await purposeReady(env))) return fail('NOT_READY', 'Contract renewals need the latest database update. Ask an administrator to apply it.', 501);
  const id = String(params.id);
  const b = await request.json<{ documentId?: string; startsOn?: string; endsOn?: string | null; renewsOn?: string | null }>().catch(() => null);
  if (!b) return fail('VALIDATION', 'Nothing to save.', 422);

  const u = await one<any>(env, `SELECT u.id, u.purpose, u.package, u.contract_id, u.owner_id, p.name AS building, u.unit_number
    FROM units u JOIN properties p ON p.id = u.property_id WHERE u.id = ?`, id);
  if (!u) return fail('NOT_FOUND', 'That unit no longer exists.', 404);
  const cur = u.contract_id ? await one<any>(env, 'SELECT * FROM owner_contracts WHERE id = ?', u.contract_id) : null;
  if (!cur) return fail('NO_CONTRACT', 'This unit has no contract to extend. Set one up on its Contract tab first.', 409);

  const fields: Record<string, string> = {};
  if (!b.documentId) fields.documentId = 'Upload the signed agreement or memo for the new period.';
  if (!b.startsOn || !DATE.test(b.startsOn)) fields.startsOn = 'Enter the start of the new period.';
  else if (cur.starts_on && b.startsOn <= String(cur.starts_on).slice(0, 10)) fields.startsOn = `Start after ${String(cur.starts_on).slice(0, 10)}, when the current contract began.`;
  if (b.endsOn && (!DATE.test(b.endsOn) || (b.startsOn && b.endsOn < b.startsOn))) fields.endsOn = 'The end must be on or after the start.';
  if (b.renewsOn && (!DATE.test(b.renewsOn) || (b.startsOn && b.renewsOn <= b.startsOn))) fields.renewsOn = 'Renewal must be after the start.';
  for (const k of ['startsOn', 'endsOn', 'renewsOn'] as const) if (!fields[k]) checkDate(fields, k, b[k] || null);
  if (Object.keys(fields).length) return fail('VALIDATION', fields.documentId && Object.keys(fields).length === 1 ? fields.documentId : 'Check the renewal details.', 422, fields);

  const doc = await one<{ id: string; unit_id: string | null; file_name: string }>(env, 'SELECT id, unit_id, file_name FROM documents WHERE id = ?', b.documentId);
  if (!doc || doc.unit_id !== id) return fail('VALIDATION', 'Upload the agreement or memo to this unit first.', 422, { documentId: 'That file is not on this unit.' });
  if (await one(env, 'SELECT 1 AS x FROM owner_contracts WHERE agreement_document_id = ?', doc.id)) {
    return fail('VALIDATION', 'That file is already the agreement of another contract period. Upload the new one.', 422, { documentId: 'Already used for another period.' });
  }
  const code = codeOf(modelOf({ ...cur, contract_id: cur.id, package: u.package }), cur.contract_code);
  if (!codesFor(u.purpose as Purpose, code).includes(code)) {
    return fail('CONTRACT_MISMATCH', `A ${code} contract does not fit this ${u.purpose} unit. Start a new contract on the Contract tab instead.`, 409);
  }

  const shared = Number((await one<{ n: number }>(env, 'SELECT COUNT(*) AS n FROM units WHERE contract_id = ? AND id <> ?', cur.id, id))?.n ?? 0) > 0;
  const newId = crypto.randomUUID(), now = nowIso();
  // Same terms, new period. The guarantee window of the old period does not carry over.
  await run(env, `
    INSERT INTO owner_contracts (id, owner_id, unit_id, created_at, starts_on, ends_on, renews_on, agreement_document_id, contract_code,
      revenue_model, model, management_fee_pct, agent_fee_pct, agent_name, minimum_guarantee, minimum_guarantee_annual, grr_amount,
      deposit_amount, tenant_name, misc_charges)
    SELECT ?, owner_id, ?, ?, ?, ?, ?, ?, ?,
      ?, model, management_fee_pct, agent_fee_pct, agent_name, minimum_guarantee, minimum_guarantee_annual, grr_amount,
      deposit_amount, tenant_name, misc_charges
    FROM owner_contracts WHERE id = ?`,
    newId, id, now, b.startsOn, b.endsOn || null, b.renewsOn || null, doc.id, code, modelOf({ ...cur, contract_id: cur.id, package: u.package }), cur.id);
  if (!shared) {
    if (!cur.ends_on || String(cur.ends_on).slice(0, 10) >= b.startsOn!) await run(env, 'UPDATE owner_contracts SET ends_on = ? WHERE id = ?', dayBefore(b.startsOn!), cur.id);
    if (!cur.unit_id) await run(env, 'UPDATE owner_contracts SET unit_id = ? WHERE id = ?', id, cur.id);
  }
  await run(env, 'UPDATE units SET contract_id = ?, updated_at = ? WHERE id = ?', newId, now, id);
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'contract.extend', entityTable: 'owner_contracts', entityId: newId,
    before: { id: cur.id, startsOn: cur.starts_on, endsOn: cur.ends_on },
    after: { unitId: id, code, startsOn: b.startsOn, endsOn: b.endsOn || null, renewsOn: b.renewsOn || null, agreement: doc.file_name, previous: cur.id, sharedPrevious: shared },
  });
  return json({ id: newId, code }, 201);
};
