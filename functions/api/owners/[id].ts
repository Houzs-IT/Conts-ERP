import { type Env, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, type Session } from '../../_lib/auth';
import { mayRun } from '../../_lib/access';
import { checkEmail, checkPhone, invalid } from '../../_lib/validate';

/** PATCH /api/owners/:id — three kinds of change, one per request:
 *   { defaultManagementFeePct: number | null }  the owner-level default fee (a unit's own contract overrides it)
 *   { details: { displayName, legalName, ic, phone, email, address, notes } }     the owner's details
 *   { payout: { bankName, bankAccount, accountHolder } }                          where payouts go
 *  Details and payout details are the owner's alone: the Units screen shows them read-only and links here. Every
 *  change is audited; identity and bank numbers are recorded as changed, never copied into the audit log. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can change owner fees.', 403);

  const id = String(params.id);
  const owner = await one<{ id: string; display_name: string; default_management_fee_pct: number | null }>(env, 'SELECT id, display_name, default_management_fee_pct FROM owners WHERE id = ?', id);
  if (!owner) return fail('NOT_FOUND', 'That owner no longer exists.', 404);

  const b = await request.json<any>().catch(() => null);
  if (b && (b.details || b.payout)) {
    if (!mayRun(session, ['management', 'finance_admin'])) return fail('FORBIDDEN', 'Only management and finance can change owner details and payout details.', 403);
    return b.details ? saveDetails(env, session, id, b.details) : savePayout(env, session, id, b.payout);
  }
  if (!b || !('defaultManagementFeePct' in b)) return fail('VALIDATION', 'Provide a default management fee, or null to clear it.', 422);
  const raw = b.defaultManagementFeePct;
  let pct: number | null;
  if (raw === null || raw === '') {
    pct = null;
  } else {
    pct = Number(raw);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return fail('VALIDATION', 'The fee must be between 0 and 100.', 422, { defaultManagementFeePct: 'Enter 0 to 100, or leave blank.' });
  }

  await run(env, 'UPDATE owners SET default_management_fee_pct = ?, updated_at = ? WHERE id = ?', pct, nowIso(), id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'owner.update', entityTable: 'owners', entityId: id, before: { defaultManagementFeePct: owner.default_management_fee_pct == null ? null : Number(owner.default_management_fee_pct) }, after: { defaultManagementFeePct: pct } });
  return json({ ok: true, defaultManagementFeePct: pct });
};

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

async function saveDetails(env: Env, session: Session, id: string, d: Record<string, unknown>) {
  const f: Record<string, string> = {};
  const name = text(d.displayName);
  if (!name) f.displayName = 'Enter the owner\'s name.';
  checkEmail(f, 'email', text(d.email) || null);
  checkPhone(f, 'phone', text(d.phone) || null);
  for (const [k, max] of [['displayName', 120], ['legalName', 160], ['ic', 40], ['address', 400], ['notes', 2000]] as const) if (text(d[k]).length > max) f[k] = `Keep it under ${max} characters.`;
  const bad = invalid(f, 'Check the owner details.');
  if (bad) return bad;
  const cur = await one<any>(env, 'SELECT display_name, legal_name, email, phone, address, notes, ic_number FROM owners WHERE id = ?', id);
  const ic = text(d.ic);
  const icChanged = d.ic !== undefined && ic !== '' && !ic.includes('•') && ic !== (cur.ic_number ?? '');
  await run(env, `UPDATE owners SET display_name = ?, legal_name = ?, email = ?, phone = ?, address = ?, notes = ?, ic_number = CASE WHEN ? THEN ? ELSE ic_number END, updated_at = ? WHERE id = ?`,
    name, text(d.legalName) || null, text(d.email).toLowerCase(), text(d.phone) || null, text(d.address) || null, text(d.notes) || null, icChanged, ic, nowIso(), id);
  const after = { displayName: name, legalName: text(d.legalName) || null, email: text(d.email).toLowerCase() || null, phone: text(d.phone) || null, address: text(d.address) || null, notes: text(d.notes) || null };
  const before = { displayName: cur.display_name, legalName: cur.legal_name ?? null, email: cur.email || null, phone: cur.phone ?? null, address: cur.address ?? null, notes: cur.notes ?? null };
  const changedB: Record<string, unknown> = {}, changedA: Record<string, unknown> = {};
  for (const k of Object.keys(after) as (keyof typeof after)[]) if ((before[k] ?? null) !== (after[k] ?? null)) { changedB[k] = before[k]; changedA[k] = after[k]; }
  if (icChanged) { changedB.ownerBankOrId = 'unchanged'; changedA.ownerBankOrId = 'IC or passport changed'; }
  if (Object.keys(changedA).length) await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'owner.update', entityTable: 'owners', entityId: id, before: changedB, after: changedA });
  return json({ ok: true });
}

async function savePayout(env: Env, session: Session, id: string, p: Record<string, unknown>) {
  const f: Record<string, string> = {};
  const account = text(p.bankAccount).replace(/[\s-]/g, '');
  const accountChanged = account !== '' && !account.includes('•');
  if (accountChanged && !/^\d{6,20}$/.test(account)) f.bankAccount = 'Enter the account number: 6 to 20 digits.';
  if (text(p.accountHolder).length > 160) f.accountHolder = 'Keep it under 160 characters.';
  if (text(p.bankName).length > 60) f.bankName = 'Pick the bank from the list.';
  const bad = invalid(f, 'Check the payout details.');
  if (bad) return bad;
  const cur = await one<any>(env, 'SELECT bank_name, bank_account_holder FROM owners WHERE id = ?', id);
  await run(env, `UPDATE owners SET bank_name = ?, bank_account_holder = ?,
      bank_account_number = CASE WHEN ? THEN ? ELSE bank_account_number END, bank_account_last4 = CASE WHEN ? THEN ? ELSE bank_account_last4 END, updated_at = ? WHERE id = ?`,
    text(p.bankName) || null, text(p.accountHolder) || null, accountChanged, account, accountChanged, account.slice(-4), nowIso(), id);
  const before: Record<string, unknown> = {}, after: Record<string, unknown> = {};
  if ((cur.bank_name ?? '') !== text(p.bankName)) { before.bankName = cur.bank_name ?? null; after.bankName = text(p.bankName) || null; }
  if ((cur.bank_account_holder ?? '') !== text(p.accountHolder)) { before.accountHolder = cur.bank_account_holder ?? null; after.accountHolder = text(p.accountHolder) || null; }
  if (accountChanged) { before.ownerBankOrId = 'unchanged'; after.ownerBankOrId = 'Bank account changed'; }
  if (Object.keys(after).length) await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'owner.payout_details', entityTable: 'owners', entityId: id, before, after });
  return json({ ok: true });
}

/** DELETE /api/owners/:id — only when the owner has no units, contract, statements or payouts.
 *  An owner with any real history is never deleted here; reassign their units first. */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can delete owners.', 403);

  const id = String(params.id);
  const owner = await one<{ id: string; display_name: string; email: string; user_id: string | null }>(env, 'SELECT id, display_name, email, user_id FROM owners WHERE id = ?', id);
  if (!owner) return fail('NOT_FOUND', 'That owner no longer exists.', 404);

  const units = await one<{ n: number }>(env, 'SELECT COUNT(*) AS n FROM units WHERE owner_id = ?', id);
  if (Number(units?.n) > 0) return fail('HAS_UNITS', `${owner.display_name} still has ${units!.n} unit${Number(units!.n) === 1 ? '' : 's'} linked. Move them to another owner first.`, 409);

  const contracts = await one<{ n: number }>(env, 'SELECT COUNT(*) AS n FROM owner_contracts WHERE owner_id = ?', id);
  if (Number(contracts?.n) > 0) return fail('HAS_CONTRACT', `${owner.display_name} has a contract on file, so this record cannot be deleted.`, 409);

  const statements = await one<{ n: number }>(env, 'SELECT COUNT(*) AS n FROM owner_statements WHERE owner_id = ?', id);
  if (Number(statements?.n) > 0) return fail('HAS_STATEMENTS', `${owner.display_name} has statement history and cannot be deleted.`, 409);

  const payouts = await one<{ n: number }>(env, 'SELECT COUNT(*) AS n FROM payouts WHERE owner_id = ?', id);
  if (Number(payouts?.n) > 0) return fail('HAS_PAYOUTS', `${owner.display_name} has payout history and cannot be deleted.`, 409);

  const adjustments = await one<{ n: number }>(env, 'SELECT COUNT(*) AS n FROM owner_adjustments WHERE owner_id = ?', id);
  if (Number(adjustments?.n) > 0) return fail('HAS_ADJUSTMENTS', `${owner.display_name} has credits or charges on record and cannot be deleted.`, 409);

  // The login exists only for this owner's portal access, so it goes with the record.
  if (owner.user_id) await run(env, "DELETE FROM users WHERE id = ? AND role = 'owner'", owner.user_id);
  await run(env, 'DELETE FROM owners WHERE id = ?', id);

  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'owner.delete', entityTable: 'owners', entityId: id, before: { displayName: owner.display_name, email: owner.email } });
  return json({ ok: true });
};
