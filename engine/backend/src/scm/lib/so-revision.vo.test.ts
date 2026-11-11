/* reviseBoundPo re-derives a PO from the order at furniture cost. A contract VO's amendment does not go that way: it applies
   its own lines, price untouched, on the one PO being approved, and closes the flags on them. */
import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ applied: [] as unknown[][], flags: [] as unknown[] }));
vi.mock('./po-revision', () => ({
  applyPoAmendment: async (...a: unknown[]) => { h.applied.push(a); return { poId: 'po1', poNumber: 'TC-PO-1', revision: 2, linesUpdated: 1, linesAdded: 0, linesRemoved: 1, warnings: ['w'] }; },
}));

import { reviseBoundPo } from './so-revision';

function fake(resolution: string) {
  const rows: Record<string, unknown> = {
    so_amendments: { id: 'a1', so_doc_no: 'TC-SO-1', status: 'SENT', resolution },
    po_amendments: [{ id: 'pa1' }],
    po_amendment_lines: [{ purchase_order_item_id: 'l1' }],
  };
  const from = (t: string) => {
    const q: Record<string, unknown> = {
      select: () => q, eq: () => q, in: () => q,
      update: (r: unknown) => { h.flags.push([t, r]); return q; },
      maybeSingle: async () => ({ data: rows[t], error: null }),
      then: (ok: (v: unknown) => unknown) => ok({ data: rows[t], error: null }),
    };
    return q;
  };
  return { from };
}

describe('reviseBoundPo for a contract VO', () => {
  it('applies the amendment lines of that PO and closes their flags', async () => {
    h.applied.length = 0;
    h.flags.length = 0;
    const r = await reviseBoundPo(fake('RENOVATION_VO') as never, 'a1', 'u1', undefined, { onlyPoId: 'po1' });
    expect(h.applied).toEqual([[expect.anything(), 'pa1', 'u1', undefined, { fromVo: true }]]);
    expect(r.perPo).toEqual([{ poId: 'po1', poNumber: 'TC-PO-1', revision: 2, linesRederived: 1, linesRemoved: 1, linesAdded: 0 }]);
    expect(h.flags).toEqual([['reno_po_line_flags', expect.objectContaining({ status: 'RESOLVED' })]]);
  });
  it('does nothing on the unscoped path: each PO is approved on its own', async () => {
    h.applied.length = 0;
    const r = await reviseBoundPo(fake('RENOVATION_VO') as never, 'a1', 'u1');
    expect(h.applied).toEqual([]);
    expect(r.perPo).toEqual([]);
  });
});
