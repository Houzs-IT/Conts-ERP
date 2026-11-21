import { describe, expect, it } from 'vitest';
import { resolvePoId } from './mfg-purchase-orders';

/* Click sweep F20 (21 Nov 2026): /scm/purchase-orders/TC-PO-2611-104 answered 500, the number compared to a uuid. */
function fakeSupabase(rows: Array<{ id: string; po_number: string }>, fail = false) {
  const calls: string[] = [];
  const supabase = {
    from(table: string) {
      calls.push(table);
      let match: string | null = null;
      const q = {
        select: () => q,
        eq: (col: string, v: string) => { if (col === 'po_number') match = v; return q; },
        limit: () => q,
        maybeSingle: async () => (fail
          ? { data: null, error: { message: 'boom' } }
          : { data: rows.find((r) => r.po_number === match) ?? null, error: null }),
      };
      return q;
    },
  };
  return { supabase, calls };
}
const scope = <T,>(q: T) => q;

describe('resolvePoId', () => {
  it('passes a uuid straight through without a lookup', async () => {
    const { supabase, calls } = fakeSupabase([]);
    const id = '0f6c2c1e-3d1b-4a51-9a0e-6c7f5f1f2a10';
    expect(await resolvePoId(id, scope, supabase)).toEqual({ ok: true, id });
    expect(calls).toEqual([]);
  });

  it('finds a PO by its number', async () => {
    const { supabase } = fakeSupabase([{ id: 'abc-uuid', po_number: 'TC-PO-2611-104' }]);
    expect(await resolvePoId('TC-PO-2611-104', scope, supabase)).toEqual({ ok: true, id: 'abc-uuid' });
  });

  it('answers 404 not found for an unknown number', async () => {
    const { supabase } = fakeSupabase([]);
    const r = await resolvePoId('TC-PO-2611-999', scope, supabase);
    expect(r).toMatchObject({ ok: false, status: 404, body: { error: 'not_found' } });
  });

  it('answers 500 only when the lookup itself fails', async () => {
    const { supabase } = fakeSupabase([], true);
    expect(await resolvePoId('TC-PO-2611-104', scope, supabase)).toMatchObject({ ok: false, status: 500 });
  });
});
