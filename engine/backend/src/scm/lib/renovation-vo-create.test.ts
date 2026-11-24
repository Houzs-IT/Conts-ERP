import { describe, expect, it } from 'vitest';
import { createVoWithEdits } from './renovation-vo';
import type { RenoActor } from './renovation-quotation';

const actor = { companyId: 1, name: 'Tester' } as RenoActor;
const SAVE_REACHED = 'save step reached';

/** Answers the contract, the next number and the insert; stops at the first read of the new VO for saving. */
function scriptedDb(): { q: (text: string, params?: readonly unknown[]) => Promise<unknown[]>; calls: Array<{ text: string; params: readonly unknown[] }> } {
  const calls: Array<{ text: string; params: readonly unknown[] }> = [];
  return {
    calls,
    q: async (text, params = []) => {
      calls.push({ text, params });
      if (text.includes('from scm.mfg_sales_orders o')) return [{ doc_no: 'TC-SO-1', status: 'RENO_CONFIRMED', so_kind: 'RENOVATION', contract_version: 1, promo_lines: [] }];
      if (text.includes('max(seq)')) return [{ n: 2 }];
      if (text.includes('insert into scm.reno_variation_orders')) return [{ id: 'NEW', version: 1 }];
      if (text.includes('from scm.reno_variation_orders where id')) throw new Error(SAVE_REACHED);
      return [];
    },
  };
}

describe('createVoWithEdits (New VO saves once there is a change)', () => {
  it('with no edits: creates the VO and saves nothing else', async () => {
    const db = scriptedDb();
    await expect(createVoWithEdits(db as never, actor, 'TC-SO-1', { title: 'x' })).resolves.toEqual({ id: 'NEW', voNo: 'VO-TC-SO-1-03', version: 1 });
    expect(db.calls.some((c) => c.text.includes('from scm.reno_variation_orders where id'))).toBe(false);
  });

  it('with edits: saves them onto the VO it just created', async () => {
    const db = scriptedDb();
    await expect(createVoWithEdits(db as never, actor, 'TC-SO-1', { edits: { lines: [], adds: [] } })).rejects.toThrow(SAVE_REACHED);
    const save = db.calls.find((c) => c.text.includes('from scm.reno_variation_orders where id'));
    expect(save?.params).toEqual(['NEW', 1]);
  });
});
