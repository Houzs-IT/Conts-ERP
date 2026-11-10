import { describe, expect, it } from 'vitest';
import { postFromGrnDraft } from './pi-from-grn-post';

/* Review of #856: the from-grn-items auto-post dropped every error but the cap, so a failed flip left the invoice
   DRAFT while the handler reported it POSTED; and an unresolved company scoped the write to company_id = undefined. */
type Call = { table: string; op: string; eqs: Array<[string, unknown]> };

function fake(update: { data: unknown; error: { code?: string; message: string } | null }) {
  const calls: Call[] = [];
  const sb = {
    from(table: string) {
      const call: Call = { table, op: '', eqs: [] };
      calls.push(call);
      const q = {
        update() { call.op = 'update'; return q; },
        delete() { call.op = 'delete'; return q; },
        eq(col: string, v: unknown) { call.eqs.push([col, v]); return q; },
        select() { return q; },
        maybeSingle: async () => update,
        then(res: (v: unknown) => unknown) { return Promise.resolve({ error: null }).then(res); },
      };
      return q;
    },
  };
  return { sb, calls };
}

describe('postFromGrnDraft', () => {
  it('posts, scoped to the company when there is one', async () => {
    const { sb, calls } = fake({ data: { id: 'pi-1' }, error: null });
    expect(await postFromGrnDraft(sb, 'pi-1', 7)).toEqual({ kind: 'posted' });
    expect(calls[0]!.eqs).toEqual([['id', 'pi-1'], ['company_id', 7]]);
  });

  it('an unresolved company leaves the write on the id alone, never company_id = undefined', async () => {
    const { sb, calls } = fake({ data: { id: 'pi-1' }, error: null });
    expect(await postFromGrnDraft(sb, 'pi-1', undefined)).toEqual({ kind: 'posted' });
    expect(calls[0]!.eqs).toEqual([['id', 'pi-1']]);
  });

  it('the database cap rolls the draft back', async () => {
    const { sb, calls } = fake({ data: null, error: { code: 'P0412', message: 'grn_line_over_invoiced' } });
    expect(await postFromGrnDraft(sb, 'pi-1', 7)).toEqual({ kind: 'capped' });
    expect(calls.map((c) => c.op)).toEqual(['update', 'delete']);
  });

  it('any other error, or no row, is a failure the caller reports', async () => {
    expect(await postFromGrnDraft(fake({ data: null, error: { code: '57014', message: 'timeout' } }).sb, 'pi-1', 7)).toEqual({ kind: 'failed', reason: 'timeout' });
    expect((await postFromGrnDraft(fake({ data: null, error: null }).sb, 'pi-1', 7)).kind).toBe('failed');
  });
});
