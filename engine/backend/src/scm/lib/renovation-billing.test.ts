/* An earlier instalment billed again after its invoice was cancelled, with a later one still live, comes to what the screen
   previews, and the schedule still adds up to the contract. */
import { describe, expect, it } from 'vitest';
import { billedBeforeInstalment, type BillingInstalment } from './renovation-billing';
import { instalmentPreview, nextInstalmentAmount } from '../shared/renovation-money';

const schedule = [{ seq: 1, pctBp: 3000 }, { seq: 2, pctBp: 4000 }, { seq: 3, pctBp: 3000 }];
const row = (seq: number, billedSen: number | null) => ({ seq, bill: billedSen === null ? null : { amountSen: billedSen } }) as unknown as BillingInstalment;

describe('billedBeforeInstalment', () => {
  it('leaves out later bills: #1 cancelled with #2 billed bills 30k, as the preview says', () => {
    const view = { billedSen: 40_000_00, instalments: [row(1, null), row(2, 40_000_00), row(3, null)] };
    const before = billedBeforeInstalment(view, 1);
    expect(before).toBe(0);
    const n = nextInstalmentAmount({ instalments: schedule, seq: 1, revisedContractSen: 100_000_00, billedSen: before });
    expect(n.amountSen).toBe(30_000_00);
    const preview = instalmentPreview(schedule, 100_000_00, new Map([[2, 40_000_00]]));
    expect(preview.find((p) => p.seq === 1)?.amountSen).toBe(n.amountSen);
    expect(preview.reduce((s, p) => s + p.amountSen, 0)).toBe(100_000_00);
  });
  it('keeps earlier bills, credits and all', () => {
    const view = { billedSen: 25_000_00, instalments: [row(1, 30_000_00), row(2, null), row(3, null)] };
    expect(billedBeforeInstalment(view, 2)).toBe(25_000_00);
  });
});
