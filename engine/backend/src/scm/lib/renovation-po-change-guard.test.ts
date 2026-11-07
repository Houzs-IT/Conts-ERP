/* A VO's waiting PO change stops a receipt; an ordinary amendment's follow-up does not. */
import { describe, expect, it } from 'vitest';
import { voChangeWaiting } from './renovation-po-change-guard';

const fake = (tables: Record<string, unknown[]>, failing?: string) => ({
  from: (t: string) => {
    const q = {
      select: () => q, in: () => q, eq: () => q, not: () => q,
      then: (ok: (r: unknown) => void) => ok(t === failing ? { data: null, error: { message: 'down' } } : { data: tables[t] ?? [], error: null }),
    };
    return q;
  },
});
const open = { po_amendment_lines: [{ amendment_id: 'a1' }], po_amendments: [{ po_number: 'TC-PO-1', source_so_amendment_id: 's1' }] };

describe('voChangeWaiting', () => {
  it('passes a PO line with no amendment', async () => {
    expect(await voChangeWaiting(fake({}), ['l1'])).toBeNull();
    expect(await voChangeWaiting(fake({}), [null])).toBeNull();
  });
  it('stops on a VO amendment still waiting, in plain words', async () => {
    const r = await voChangeWaiting(fake({ ...open, so_amendments: [{ id: 's1' }] }), ['l1']);
    expect(r?.message).toMatch(/^Approve the PO change first/);
    expect(r?.message).toContain('TC-PO-1');
  });
  it('lets an ordinary SO amendment follow-up through', async () => {
    expect(await voChangeWaiting(fake({ ...open, so_amendments: [] }), ['l1'])).toBeNull();
  });
  it('refuses when it cannot read, rather than letting stock in', async () => {
    expect((await voChangeWaiting(fake(open, 'po_amendments'), ['l1']))?.message).toMatch(/could not be checked/);
  });
});
