// A renovation contract's advance sub-account (finance, chew 30 Oct 2026; spec docs/superpowers/specs/2026-10-30-
// renovation-revenue-einvoice-design.md 2.1, 2.5). Each project keeps its unbilled contract on its own child of
// 480-0000 (Dream Crafter, renovation) or 481-0000 (The Conts, inhouse renovation), as AutoCount keeps them
// (480-S012 SKYLINE D-25-13). Opened inside the conversion's transaction; a missing parent refuses the conversion by
// name — finance adds it, never a guess.

import { nextPartyCode } from '../conts/parties';
import { refuse } from '../scm/lib/renovation-db';

type Db = { q<T = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<T[]> };

export type AdvanceKind = 'RENOVATION' | 'INHOUSE_RENOVATION';

/** The parent each kind's advance sub-accounts sit under. */
export const ADVANCE_PARENT: Record<AdvanceKind, { code: string; label: string }> = {
  RENOVATION: { code: '480-0000', label: 'renovation (Dream Crafter)' },
  INHOUSE_RENOVATION: { code: '481-0000', label: 'inhouse renovation (The Conts)' },
};

/** The letter of an advance code: the project name's first letter or digit, upper case; a digit (or nothing) is 0. */
export function projectLetter(name: string): string {
  const first = name.trim().toUpperCase().match(/[A-Z0-9]/)?.[0] ?? '0';
  return /[0-9]/.test(first) ? '0' : first;
}

/** Open the project's advance sub-account and return its code: parent prefix + the project's letter + the next running
    number (three digits at least, unbounded), named after the project, its type and section copied from the parent.
    A code taken a moment ago is skipped and the next tried, so the transaction never aborts on a clash. */
export async function openAdvanceAccountSql(db: Db, companyId: number, p: { kind: AdvanceKind; projectName: string }): Promise<string> {
  const parent = ADVANCE_PARENT[p.kind];
  const [row] = await db.q<{ account_code: string; account_type: string; section: string | null; is_active: boolean }>(
    'select account_code, account_type, section, is_active from scm.accounts where company_id = $1 and account_code = $2', [companyId, parent.code]);
  if (!row || row.is_active === false) {
    throw refuse(422, 'no_advance_parent',
      `Account ${parent.code} (advances for ${parent.label}) is ${row ? 'deactivated' : 'not in the chart of accounts'}. Finance must ${row ? 'reactivate' : 'add'} it before this quotation can be converted.`,
      { account: parent.code });
  }
  /* Project names often carry a leading "SO - " (chew, 30 Oct 2026): not part of the project's letter or name. */
  const name = p.projectName.trim().replace(/^so\s*-\s*/i, '').trim();
  if (!name) throw refuse(422, 'no_project_name', 'The project has no name to open its advance account with.');
  const prefix3 = parent.code.slice(0, 3);
  const letter = projectLetter(name);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const taken = await db.q<{ account_code: string }>(
      'select account_code from scm.accounts where company_id = $1 and account_code like $2', [companyId, `${prefix3}-${letter}%`]);
    const code = nextPartyCode(prefix3, letter, taken.map((t) => t.account_code));
    const [made] = await db.q<{ account_code: string }>(
      `insert into scm.accounts (company_id, account_code, account_name, account_type, parent_code, section, is_active)
       values ($1, $2, $3, $4, $5, $6, true) on conflict (company_id, account_code) do nothing returning account_code`,
      [companyId, code, name, row.account_type, parent.code, row.section]);
    if (made) return made.account_code;
  }
  throw new Error(`No free advance account code in ${prefix3}-${letter}; try again.`);
}
