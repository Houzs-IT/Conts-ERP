/* A manual draft is thrown away; nothing else is (chew, 17 Nov 2026). */
import { describe, expect, test } from 'vitest';
import { fakeSb } from '../scm/lib/fake-postgrest';
import { discardDraftJournal } from './draft-journal';

const world = () => fakeSb({
  journal_entries: [
    { id: 'a', company_id: 1, je_no: 'JE-2611-0038', source_type: 'MANUAL', posted: false },
    { id: 'b', company_id: 1, je_no: 'JE-2611-0050', source_type: 'MANUAL', posted: true },
    { id: 'c', company_id: 1, je_no: 'JE-2611-0060', source_type: 'API', posted: false },
  ],
  journal_entry_lines: [
    { id: 1, journal_entry_id: 'a', account_code: '650-0020', debit_sen: 100, credit_sen: 0 },
    { id: 2, journal_entry_id: 'a', account_code: '420-0010', debit_sen: 0, credit_sen: 100 },
    { id: 3, journal_entry_id: 'b', account_code: '650-0020', debit_sen: 100, credit_sen: 0 },
  ],
});

describe('throwing away a draft journal', () => {
  test('a manual draft goes with its lines', async () => {
    const sb = world();
    expect(await discardDraftJournal(sb, 1, 'a')).toEqual({ ok: true, jeNo: 'JE-2611-0038' });
    expect(sb.tables.journal_entries.map((j) => j.id)).toEqual(['b', 'c']);
    expect(sb.tables.journal_entry_lines.map((l) => l.id)).toEqual([3]);
  });
  test('a posted one, a document entry, or another company\'s is refused', async () => {
    const sb = world();
    expect(await discardDraftJournal(sb, 1, 'b')).toMatchObject({ ok: false, status: 409 });
    expect(await discardDraftJournal(sb, 1, 'c')).toMatchObject({ ok: false, status: 409 });
    expect(await discardDraftJournal(sb, 2, 'a')).toMatchObject({ ok: false, status: 404 });
    expect(sb.tables.journal_entries).toHaveLength(3);
  });
});
