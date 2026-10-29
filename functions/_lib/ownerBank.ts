import { type Env, all } from './db';
import { hasColumn } from './auth';
import { MASK } from './properties';

/** Migration 0180 (several bank accounts per owner) is applied by hand per environment. Until it is, nothing reads or
 *  writes the new table or `units.bank_account_id`, and every payout goes to the owner's main account as before. */
export const bankAccountsReady = (env: Env): Promise<boolean> =>
  Promise.all([hasColumn(env, 'owner_bank_accounts', 'id'), hasColumn(env, 'units', 'bank_account_id')]).then(([a, b]) => a && b).catch(() => false);

/** The same shape the main account uses on the owner page. */
export const ACCOUNT_NUMBER = /^[0-9][0-9 -]{4,28}[0-9]$/;
export const last4Of = (account: string): string => account.replace(/[\s-]/g, '').slice(-4);

export interface AccountPatch { label?: string | null; bankName?: string | null; accountHolder?: string | null; accountNumber?: string }

/** The fields of an extra account from a request body. `create` needs a bank and a number; an edit takes only the
 *  keys present, and a blank or masked number keeps the stored one (same rule as the main account). */
export function parseAccountInput(b: Record<string, unknown>, create: boolean): { fields: Record<string, string>; set: AccountPatch } {
  const fields: Record<string, string> = {}, set: AccountPatch = {};
  const text = (v: unknown): string | null => (typeof v === 'string' ? v.trim() : v == null ? '' : null);
  if (create || 'label' in b) {
    const v = text(b.label);
    if (v === null || v.length > 60) fields.label = 'Enter a label of up to 60 characters, or leave it blank.';
    else set.label = v || null;
  }
  if (create || 'bankName' in b) {
    const v = text(b.bankName);
    if (!v || v.length > 60) fields.bankName = 'Pick the bank.';
    else set.bankName = v;
  }
  if (create || 'accountHolder' in b) {
    const v = text(b.accountHolder);
    if (v === null || v.length > 120) fields.accountHolder = 'Enter the account holder in up to 120 characters.';
    else set.accountHolder = v || null;
  }
  if (create || 'accountNumber' in b) {
    const v = text(b.accountNumber);
    const bad = 'Enter the account number: digits, spaces or dashes.';
    if (v === null) fields.accountNumber = bad;
    else if (v === '' || v.includes(MASK.charAt(0))) { if (create) fields.accountNumber = bad; }
    else if (!ACCOUNT_NUMBER.test(v)) fields.accountNumber = bad;
    else set.accountNumber = v;
  }
  return { fields, set };
}

/** SQL for the last four of the account a statement's payout goes to when the owner has no main account: the
 *  statement has lines and every line's unit has its own account (the first one's tail). null otherwise. */
export const extraLast4Sql = (statement: string): string => `(
  SELECT CASE WHEN COUNT(*) > 0 AND COUNT(*) = COUNT(a.account_last4) THEN (array_agg(a.account_last4 ORDER BY a.created_at, a.id))[1] END
  FROM statement_lines l LEFT JOIN units u ON u.id = l.unit_id
  LEFT JOIN owner_bank_accounts a ON a.id = u.bank_account_id AND a.owner_id = ${statement}.owner_id
  WHERE l.statement_id = ${statement}.id)`;

export interface AccountTail { bankName: string | null; last4: string }

/** The bank and last four of every account a statement is paid to (each line's unit account, else the owner's main),
 *  when any line goes to an extra account: [] when every line goes to the main account or the accounts table is not
 *  there yet. Never the number. */
export async function differingAccountTails(env: Env, statementId: string): Promise<AccountTail[]> {
  if (!(await bankAccountsReady(env))) return [];
  const rows = await all<{ bank_name: string | null; last4: string | null; extra: boolean }>(env, `
    SELECT DISTINCT CASE WHEN a.id IS NULL THEN o.bank_name ELSE a.bank_name END AS bank_name,
           CASE WHEN a.id IS NULL THEN o.bank_account_last4 ELSE a.account_last4 END AS last4, a.id IS NOT NULL AS extra
    FROM statement_lines l JOIN owner_statements s ON s.id = l.statement_id JOIN owners o ON o.id = s.owner_id
    LEFT JOIN units u ON u.id = l.unit_id LEFT JOIN owner_bank_accounts a ON a.id = u.bank_account_id AND a.owner_id = s.owner_id
    WHERE l.statement_id = ?`, statementId);
  if (!rows.some(r => r.extra)) return [];
  const tails = new Map<string, AccountTail>();
  for (const { bank_name: bankName, last4 } of rows) if (last4) tails.set(`${bankName}|${last4}`, { bankName, last4 });
  return [...tails.values()].sort((x, y) => (x.bankName ?? '').localeCompare(y.bankName ?? '') || x.last4.localeCompare(y.last4));
}
