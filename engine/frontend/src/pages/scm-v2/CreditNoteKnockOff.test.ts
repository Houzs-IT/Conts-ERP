/* The knock-off table's ticks (CreditNoteKnockOff.tsx, ported from Houzs): what
   the server's table already holds becomes the ticks, an untick (0) drops out of
   what is sent, and the sum is what the note gives away. */
import { describe, expect, test } from 'vitest';
import { pickFromRows, pickSen, pickTargets } from './CreditNoteKnockOff';
import type { KnockOffRow } from '../../vendor/scm/lib/credit-note-queries';

const row = (id: string, noteSen: number, over: Partial<KnockOffRow> = {}): KnockOffRow => ({
  kind: 'SI', id, number: `TC-SI-2611-${id}`, invoiceRef: null, invoiceDate: '2026-11-01', totalSen: 100_000, owedSen: 100_000, noteSen, status: 'SENT', ...over,
});

describe('the ticks', () => {
  test('a table with takes becomes the ticks; rows with none are not ticked', () => {
    const pick = pickFromRows([row('001', 30_000), row('002', 0), row('003', 5_000, { kind: 'API' })]);
    expect(Object.keys(pick)).toEqual(['001', '003']);
    expect(pickTargets(pick)).toEqual([{ kind: 'SI', id: '001', amountSen: 30_000 }, { kind: 'API', id: '003', amountSen: 5_000 }]);
    expect(pickSen(pick)).toBe(35_000);
  });

  test('an untick sends nothing for that invoice — the server gives it back', () => {
    const pick = { ...pickFromRows([row('001', 30_000)]), '001': { kind: 'SI' as const, id: '001', amountSen: 0 } };
    expect(pickTargets(pick)).toEqual([]);
    expect(pickSen(pick)).toBe(0);
    expect(pickFromRows(undefined)).toEqual({});
  });
});
