import { describe, expect, it } from 'vitest';
import { klToday, materialDates } from './production-material-dates';

describe('materialDates', () => {
  it('orders 7 days and arrives 1 day before the production order', () => {
    expect(materialDates('2026-11-20', '2026-11-05')).toEqual({ processingDate: '2026-11-13', deliveryDate: '2026-11-19' });
  });
  it('moves a past order date to today and keeps the arrival', () => {
    expect(materialDates('2026-11-08', '2026-11-05')).toEqual({ processingDate: '2026-11-05', deliveryDate: '2026-11-07' });
  });
  it('squeezes to order today, arrive today', () => {
    expect(materialDates('2026-11-05', '2026-11-05')).toEqual({ processingDate: '2026-11-05', deliveryDate: '2026-11-05' });
    expect(materialDates('2026-11-01', '2026-11-05')).toEqual({ processingDate: '2026-11-05', deliveryDate: '2026-11-05' });
  });
  it('has no dates without an order date', () => {
    expect(materialDates(null, '2026-11-05')).toEqual({ processingDate: null, deliveryDate: null });
  });
  it('reads today in Malaysia', () => {
    expect(klToday(new Date('2026-11-05T17:00:00Z'))).toBe('2026-11-06');
  });
});
