/* The renovation close-out check (SOP 4.2.2; chew 2 Nov 2026; plan 2026-11-02-renovation-close-out Task 3). Pinned:
   all four done is Closed; each open condition says what is left in RM; a deposit the opening deposits have not
   tagged yet is unknown, and unknown is not closed; nothing owed is not unknown. */
import { describe, expect, it } from 'vitest';
import { closeOutOf, type CloseOutInput } from './reno-close-out';

const done: CloseOutInput = {
  allInstalmentsBilled: true, notInvoicedSen: 0, notReceivedSen: 0, hasProject: true,
  owedToSuppliersSen: 0, orderedNotBilledSen: 0,
  depositKnown: true, depositLeftSen: 0,
  hasAdvanceAccount: true, advanceLeftSen: 0,
};

describe('closeOutOf', () => {
  it('all four done is Closed', () => {
    const r = closeOutOf(done);
    expect(r.closed).toBe(true);
    expect(r.checks.map((c) => [c.key, c.ok, c.text])).toEqual([
      ['billed', true, 'Done'], ['suppliers', true, 'Done'], ['deposit', true, 'Done'], ['advance', true, 'Done'],
    ]);
  });

  it('each open condition says what is left, in RM', () => {
    const at = (over: Partial<CloseOutInput>) => closeOutOf({ ...done, ...over });
    expect(at({ notReceivedSen: 123_400 }).checks[0]).toEqual({ key: 'billed', ok: false, text: 'RM 1,234.00 not yet received' });
    expect(at({ allInstalmentsBilled: false, notInvoicedSen: 50_000, notReceivedSen: 50_000 }).checks[0].text).toBe('RM 500.00 not yet invoiced; RM 500.00 not yet received');
    expect(at({ allInstalmentsBilled: false }).checks[0].text).toBe('An instalment is not invoiced yet');
    expect(at({ owedToSuppliersSen: 20_000, orderedNotBilledSen: 5_000 }).checks[1].text).toBe('RM 200.00 owed to suppliers; RM 50.00 ordered, not billed');
    expect(at({ depositLeftSen: 20_000 }).checks[2]).toEqual({ key: 'deposit', ok: false, text: 'RM 200.00 deposit not returned' });
    expect(at({ depositLeftSen: -5_000 }).checks[2].text).toBe('RM 50.00 more returned than paid');
    expect(at({ advanceLeftSen: 100_000 }).checks[3].text).toBe('RM 1,000.00 left in the advance');
    expect(at({ advanceLeftSen: 100_000 }).closed).toBe(false);
  });

  it('unknown is not closed', () => {
    const r = closeOutOf({ ...done, depositKnown: false });
    expect(r.checks[2]).toEqual({ key: 'deposit', ok: null, text: 'Deposit unknown: opening deposits not uploaded' });
    expect(r.closed).toBe(false);
    const noProject = closeOutOf({ ...done, hasProject: false });
    expect(noProject.checks.map((c) => [c.ok, c.text]).slice(1, 3)).toEqual([[null, 'No project: suppliers not checked'], [null, 'No project: deposit not checked']]);
    expect(noProject.closed).toBe(false);
    expect(closeOutOf({ ...done, hasAdvanceAccount: false }).checks[3]).toEqual({ key: 'advance', ok: null, text: 'No advance account: seed the contract at go-live' });
  });
});
