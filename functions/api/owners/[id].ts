import { type Env, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { MASK } from '../../_lib/properties';
import { checkEmail, checkPhone } from '../../_lib/validate';
import { DETAIL_TEXT, cleanText, ownerDetailsReady } from '../../_lib/ownerDetails';

/** PATCH /api/owners/:id — any of:
 *   { defaultManagementFeePct: number | null }  the owner-level default management fee (a unit's own contract overrides it)
 *   { bankName, bankAccount, accountHolder, ic } payout details, kept on the owner (owner, 11 Oct 2026: edited on the
 *                                                owner page, no longer on each unit). Blank or the masked value
 *                                                ("••••1234") for the account or IC keeps what is stored.
 *   { displayName, legalName, email, phone, notes,  the owner's details (owner page, Owner details card). The address
 *     address, postcode, city, stateOrRegion,       and alternate contact need migration 0110; until it is applied
 *     country, alternateContact,                    they are ignored and listed back in `ignored`.
 *     alternateContactPhone, alternateContactRelation }
 *  Management, finance and operations managers. Bank and IC numbers are recorded in the audit log as changed, never
 *  copied into it. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can change owner details.', 403);

  const id = String(params.id);
  const owner = await one<any>(env, 'SELECT * FROM owners WHERE id = ?', id);
  if (!owner) return fail('NOT_FOUND', 'That owner no longer exists.', 404);

  const b = await request.json<any>().catch(() => null);
  const payout = !!b && ['bankName', 'bankAccount', 'accountHolder', 'ic'].some(k => k in b);
  const DETAIL_KEYS = ['displayName', 'email', 'phone', 'alternateContactPhone', ...DETAIL_TEXT.map(f => f.key)];
  const details = !!b && DETAIL_KEYS.some(k => k in b);
  if (!b || (!('defaultManagementFeePct' in b) && !payout && !details)) return fail('VALIDATION', 'Nothing to save.', 422);
  const fields: Record<string, string> = {};
  const before: Record<string, unknown> = {}, after: Record<string, unknown> = {};
  const sets: string[] = [], args: unknown[] = [];

  if ('defaultManagementFeePct' in b) {
    const raw = b.defaultManagementFeePct;
    let pct: number | null = null;
    if (raw !== null && raw !== '') {
      pct = Number(raw);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) fields.defaultManagementFeePct = 'Enter 0 to 100, or leave blank.';
    }
    sets.push('default_management_fee_pct = ?'); args.push(pct);
    before.defaultManagementFeePct = owner.default_management_fee_pct == null ? null : Number(owner.default_management_fee_pct); after.defaultManagementFeePct = pct;
  }
  if (payout) {
    const text = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : null);
    // A value still carrying the mask (or left blank) means "keep what is stored".
    const secret = (v: unknown) => { const t = text(v); return t === null ? null : t === '' || t.includes(MASK.charAt(0)) ? undefined : t; };
    if ('bankName' in b) {
      const v = text(b.bankName);
      if (v === null || v.length > 60) fields.bankName = 'Pick the bank.';
      else if (v !== (owner.bank_name ?? '')) { sets.push('bank_name = ?'); args.push(v || null); before.bankName = owner.bank_name; after.bankName = v || null; }
    }
    if ('accountHolder' in b) {
      const v = text(b.accountHolder);
      if (v === null || v.length > 120) fields.accountHolder = 'Enter the account holder in up to 120 characters.';
      else if (v !== (owner.bank_account_holder ?? '')) { sets.push('bank_account_holder = ?'); args.push(v || null); before.accountHolder = owner.bank_account_holder; after.accountHolder = v || null; }
    }
    if ('bankAccount' in b) {
      const v = secret(b.bankAccount);
      if (v === null || (v !== undefined && !/^[0-9][0-9 -]{4,28}[0-9]$/.test(v))) fields.bankAccount = 'Enter the account number: digits, spaces or dashes.';
      else if (v !== undefined && v !== owner.bank_account_number) {
        sets.push('bank_account_number = ?', 'bank_account_last4 = ?'); args.push(v, v.replace(/[\s-]/g, '').slice(-4));
        before.bankAccount = 'unchanged'; after.bankAccount = 'changed';
      }
    }
    if ('ic' in b) {
      const v = secret(b.ic);
      if (v === null || (v !== undefined && (v.length < 5 || v.length > 30))) fields.ic = 'Enter the IC or passport number.';
      else if (v !== undefined && v !== owner.ic_number) { sets.push('ic_number = ?'); args.push(v); before.ic = 'unchanged'; after.ic = 'changed'; }
    }
  }
  const ignored: string[] = [];
  if (details) {
    const ready = await ownerDetailsReady(env);
    const set = (key: string, col: string, v: string) => {
      const was = owner[col] ?? '';
      if (v === was) return;
      sets.push(`${col} = ?`); args.push(v || null); before[key] = was || null; after[key] = v || null;
    };
    if ('displayName' in b) {
      const v = cleanText(b.displayName);
      if (!v || v.length > 120) fields.displayName = 'Enter the owner name, up to 120 characters.';
      else if (v !== owner.display_name) { sets.push('display_name = ?'); args.push(v); before.displayName = owner.display_name; after.displayName = v; }
    }
    if ('email' in b) {
      const v = cleanText(b.email);
      checkEmail(fields, 'email', v);
      if (v === null) fields.email = 'Email does not look right. Check it, or leave it blank.';
      else if (!fields.email && v.toLowerCase() !== String(owner.email ?? '').toLowerCase()) {
        if (v && await one(env, 'SELECT 1 AS x FROM owners WHERE lower(email) = lower(?) AND id <> ?', v, id)) fields.email = 'Another owner already uses that email address.';
        // email is NOT NULL on owners: no email is stored as ''.
        else { sets.push('email = ?'); args.push(v); before.email = owner.email || null; after.email = v || null; }
      }
    }
    for (const [key, col] of [['phone', 'phone'], ['alternateContactPhone', 'alt_contact_phone']] as const) {
      if (!(key in b)) continue;
      if (key !== 'phone' && !ready) { ignored.push(key); continue; }
      const v = cleanText(b[key]);
      checkPhone(fields, key, v, { label: key === 'phone' ? 'Phone' : 'Alternate contact phone' });
      if (v === null) fields[key] = 'Enter a phone number, or leave it blank.';
      else if (!fields[key]) set(key, col, v);
    }
    for (const f of DETAIL_TEXT) {
      if (!(f.key in b)) continue;
      if (f.details && !ready) { ignored.push(f.key); continue; }
      const v = cleanText(b[f.key], f.multiline);
      if (v === null || v.length > f.max) fields[f.key] = `${f.label}: up to ${f.max} characters.`;
      else set(f.key, f.col, v);
    }
  }
  if (Object.keys(fields).length) return fail('VALIDATION', Object.values(fields)[0], 422, fields);
  if (!sets.length) return json({ ok: true, changed: false, ...(ignored.length ? { ignored } : {}) });

  await run(env, `UPDATE owners SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, ...args, nowIso(), id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'owner.update', entityTable: 'owners', entityId: id, before, after });
  return json({ ok: true, changed: true, ...(ignored.length ? { ignored } : {}), ...('defaultManagementFeePct' in after ? { defaultManagementFeePct: after.defaultManagementFeePct } : {}) });
};

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
