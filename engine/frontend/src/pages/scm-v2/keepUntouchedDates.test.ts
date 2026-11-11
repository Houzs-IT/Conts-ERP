import { describe, expect, it } from 'vitest';
import { keepUntouchedDates } from './SalesOrderDetail';

const line = (p: string | null, d: string | null = null, o = false) => ({ lineProcessingDate: p, lineDeliveryDate: d, lineDeliveryDateOverridden: o }) as never;

describe('a date set elsewhere while the order is in Edit', () => {
  it('follows the line when the operator did not touch it, so Save never blanks it', () => {
    const out = keepUntouchedDates(line(null), line(null), line('2026-11-11', '2026-11-14', true)) as { lineProcessingDate: string; lineDeliveryDate: string };
    expect(out.lineProcessingDate).toBe('2026-11-11');
    expect(out.lineDeliveryDate).toBe('2026-11-14');
  });
  it('keeps what the operator typed', () => {
    const out = keepUntouchedDates(line('2026-11-20'), line(null), line('2026-11-11')) as { lineProcessingDate: string };
    expect(out.lineProcessingDate).toBe('2026-11-20');
  });
});
