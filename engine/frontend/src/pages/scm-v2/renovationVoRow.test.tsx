import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VoRowLines, voContract, voPoImpact, voSignedSen, voWhatChanged } from './renovationVoRow';
import type { VoListDetail } from '../../vendor/scm/lib/so-amendment-queries';

const vo = (over: Partial<VoListDetail> = {}): VoListDetail => ({
  added: 1, changed: 1, removed: 1, netSen: 185000, beforeSen: 11593500, afterSen: 11778500,
  signedName: null, signedAt: null, poFixes: [], lines: [], ...over,
});

describe('VO list cells', () => {
  it('says what changed, leaving out what did not', () => {
    expect(voWhatChanged(vo())).toBe('1 added, 1 changed, 1 removed');
    expect(voWhatChanged(vo({ added: 0, removed: 0 }))).toBe('1 changed');
    expect(voWhatChanged(vo({ added: 0, changed: 0, removed: 0 }))).toBe('No line changes');
  });

  it('signs the net', () => {
    expect(voSignedSen(185000)).toBe('+RM 1,850.00');
    expect(voSignedSen(-64000)).toBe('-RM 640.00');
    expect(voSignedSen(null)).toBe('—');
  });

  it('shows the contract only when both figures exist', () => {
    expect(voContract(vo())).toBe('RM 115,935.00 → RM 117,785.00');
    expect(voContract(vo({ beforeSen: null, afterSen: null }))).toBe('—');
  });

  it('counts POs to fix, then Fixed, then None', () => {
    const fix = (poNumber: string, open: boolean) => ({ poNumber, action: 'AMEND' as const, newQty: 1, open });
    expect(voPoImpact(vo())).toBe('None');
    expect(voPoImpact(vo({ poFixes: [fix('P1', true), fix('P1', true), fix('P2', true)] }))).toBe('2 PO to fix');
    expect(voPoImpact(vo({ poFixes: [fix('P1', false)] }))).toBe('Fixed');
  });
});

describe('VO row dropdown', () => {
  it('shows a dash for a before the record does not hold, and None for an added line', () => {
    render(<VoRowLines reason="" vo={vo({ lines: [
      { change: 'Changed', room: 'Living', itemCode: 'A', description: '', before: null, after: { qty: 2, uom: 'SQFT', unitPriceSen: 800 }, amountSen: null },
      { change: 'Added', room: 'Kitchen', itemCode: 'B', description: '', before: null, after: { qty: 1, uom: 'LOT', unitPriceSen: 233000 }, amountSen: 233000 },
    ] })} />);
    const [, changed, added] = screen.getAllByRole('row');
    expect(changed.textContent).toContain('—2 SQFT × RM 8.00—');
    expect(added.textContent).toContain('None1 LOT × RM 2,330.00+RM 2,330.00');
  });

  it('lists the open PO fixes', () => {
    render(<VoRowLines reason="Kitchen" vo={vo({ poFixes: [
      { poNumber: 'TC-PO-27', action: 'AMEND', newQty: 160, open: true },
      { poNumber: 'TC-PO-31', action: 'CANCEL', newQty: 0, open: true },
      { poNumber: 'TC-PO-40', action: 'CANCEL', newQty: 0, open: false },
    ] })} />);
    expect(screen.getByText('TC-PO-27 change qty to 160 · TC-PO-31 cancel line')).toBeTruthy();
    expect(screen.getByText(/Reason: Kitchen/)).toBeTruthy();
  });
});
