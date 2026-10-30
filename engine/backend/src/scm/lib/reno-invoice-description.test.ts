import { describe, expect, it } from 'vitest';
import { ordinal, renderRenoDescription } from './reno-invoice-description';

const CHEW = '1st Progress Billing for Interior Design & Renovation Works (15% Deposit & Design Fee as per Sales Order, refer to attached breakdown)';

describe('renovation invoice description', () => {
  it("chew's example", () => {
    expect(renderRenoDescription(null, { seq: 1, pctBp: 1500, label: 'Deposit & Design Fee', soDocNo: 'SO-1' })).toBe(CHEW);
    expect(renderRenoDescription('  ', { seq: 1, pctBp: 1500, label: 'Deposit & Design Fee', soDocNo: 'SO-1' })).toBe(CHEW);
  });

  it('ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st', '111th']);
  });

  it('a percentage with decimals keeps them', () => {
    expect(renderRenoDescription('{pct}', { seq: 1, pctBp: 1250, label: '', soDocNo: 'SO-1' })).toBe('12.5%');
    expect(renderRenoDescription('{seq} {so}', { seq: 3, pctBp: 1000, label: '', soDocNo: 'SO-9' })).toBe('3 SO-9');
  });

  it('description never exceeds 300 characters', () => {
    const r = renderRenoDescription(null, { seq: 1, pctBp: 1500, label: 'x'.repeat(400), soDocNo: 'SO-1' });
    expect(r.length).toBeLessThanOrEqual(300);
    expect(r.startsWith('1st Progress Billing for')).toBe(true);
    expect(r.endsWith('refer to attached breakdown)')).toBe(true);
    expect(r).toContain('x…');
  });

  it('a template too long by itself is cut at 300', () => {
    expect(renderRenoDescription('y'.repeat(350), { seq: 1, pctBp: 1500, label: 'L', soDocNo: 'SO-1' })).toHaveLength(300);
  });

  it('empty label drops cleanly', () => {
    expect(renderRenoDescription(null, { seq: 2, pctBp: 2000, label: '', soDocNo: 'SO-1' }))
      .toBe('2nd Progress Billing for Interior Design & Renovation Works (20% as per Sales Order, refer to attached breakdown)');
  });
});
