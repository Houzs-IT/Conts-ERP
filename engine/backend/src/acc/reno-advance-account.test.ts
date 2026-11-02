// A renovation contract's advance sub-account (spec 2.1, 2.5): a child of 480-0000 (Dream Crafter, renovation) or
// 481-0000 (The Conts, inhouse renovation), coded parent prefix + the project's first letter + the next running number,
// named after the project. No parent in the chart refuses by name — never a guess.

import { describe, expect, test } from 'vitest';
import { RenoError } from '../scm/lib/renovation-db';
import { openAdvanceAccountSql, projectLetter } from './reno-advance-account';

type Acc = { company_id: number; account_code: string; account_name: string; account_type: string; parent_code: string | null; section: string | null; is_active: boolean };

/* The SQL the function sends, answered from memory. */
const fakeDb = (accounts: Acc[]) => ({
  accounts,
  async q<T>(text: string, params: readonly unknown[] = []): Promise<T[]> {
    if (/from scm.accounts where company_id = \$1 and account_code = \$2/.test(text)) {
      return accounts.filter((a) => a.company_id === params[0] && a.account_code === params[1]) as T[];
    }
    if (/from scm.accounts where company_id = \$1 and account_code like \$2/.test(text)) {
      const head = String(params[1]).replace('%', '');
      return accounts.filter((a) => a.company_id === params[0] && a.account_code.startsWith(head)).map((a) => ({ account_code: a.account_code })) as T[];
    }
    if (/insert into scm.accounts/.test(text)) {
      const [company_id, account_code, account_name, account_type, parent_code, section] = params as [number, string, string, string, string, string | null];
      if (accounts.some((a) => a.company_id === company_id && a.account_code === account_code)) return [] as T[];
      accounts.push({ company_id, account_code, account_name, account_type, parent_code, section, is_active: true });
      return [{ account_code }] as T[];
    }
    throw new Error(`unexpected ${text}`);
  },
});

const parent = (code: string): Acc => ({ company_id: 1, account_code: code, account_name: 'ADVANCE', account_type: 'LIABILITY', parent_code: null, section: 'CURRENT LIABILITIES', is_active: true });
const child = (code: string, p: string): Acc => ({ ...parent(code), parent_code: p, account_name: code });

describe('openAdvanceAccountSql', () => {
  test('the advance sub-account opens under the brand parent', async () => {
    const db = fakeDb([parent('480-0000'), parent('481-0000'), child('481-S011', '481-0000'), child('480-S020', '480-0000')]);
    const code = await openAdvanceAccountSql(db, 1, { kind: 'INHOUSE_RENOVATION', projectName: 'SKYLINE D-25-13' });
    expect(code).toBe('481-S012');
    expect(db.accounts.find((a) => a.account_code === '481-S012')).toMatchObject({
      parent_code: '481-0000', account_name: 'SKYLINE D-25-13', account_type: 'LIABILITY', section: 'CURRENT LIABILITIES', is_active: true,
    });

    /* Renovation (Dream Crafter) under 480; its own series. */
    expect(await openAdvanceAccountSql(db, 1, { kind: 'RENOVATION', projectName: 'skyline b-1-2' })).toBe('480-S021');
  });

  test('a code taken a moment ago is skipped, not fatal', async () => {
    const db = fakeDb([parent('481-0000')]);
    const q = db.q.bind(db);
    let first = true;
    db.q = async <T,>(text: string, params?: readonly unknown[]) => {
      if (first && /insert into scm.accounts/.test(text)) { first = false; db.accounts.push(child('481-T001', '481-0000')); }
      return q<T>(text, params);
    };
    expect(await openAdvanceAccountSql(db, 1, { kind: 'INHOUSE_RENOVATION', projectName: 'TROFI A-3-1' })).toBe('481-T002');
  });

  test('no parent account refuses by name', async () => {
    const db = fakeDb([parent('480-0000')]);
    const err = await openAdvanceAccountSql(db, 1, { kind: 'INHOUSE_RENOVATION', projectName: 'SKYLINE D-25-13' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RenoError);
    expect((err as RenoError).status).toBe(422);
    expect((err as RenoError).message).toContain('481-0000');
    expect(db.accounts).toHaveLength(1);
  });

  test('a leading "SO - " on the project name is not part of its letter or name', async () => {
    const db = fakeDb([parent('480-0000'), child('480-T004', '480-0000')]);
    expect(await openAdvanceAccountSql(db, 1, { kind: 'RENOVATION', projectName: 'SO - THE HIPSTER C10-05 MS IRIS' })).toBe('480-T005');
    expect(db.accounts.find((a) => a.account_code === '480-T005')?.account_name).toBe('THE HIPSTER C10-05 MS IRIS');
    expect(await openAdvanceAccountSql(db, 1, { kind: 'RENOVATION', projectName: 'so-trofi a-3-1' })).toBe('480-T006');
    expect(db.accounts.find((a) => a.account_code === '480-T006')?.account_name).toBe('trofi a-3-1');
    /* Only a leading "SO" followed by a dash: SOHO is a name. */
    expect(await openAdvanceAccountSql(db, 1, { kind: 'RENOVATION', projectName: 'SOHO SUITES' })).toBe('480-S001');
  });

  test('an inactive parent refuses too', async () => {
    const db = fakeDb([{ ...parent('480-0000'), is_active: false }]);
    await expect(openAdvanceAccountSql(db, 1, { kind: 'RENOVATION', projectName: 'A' })).rejects.toThrow(/480-0000/);
  });

  test('the letter is the project name\'s first letter or digit (a digit is 0)', () => {
    expect(projectLetter('skyline')).toBe('S');
    expect(projectLetter('  18, USJ')).toBe('0');
    expect(projectLetter('MS LEE HOUSE')).toBe('M');
    expect(projectLetter('—')).toBe('0');
  });
});
