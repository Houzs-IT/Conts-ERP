import { describe, expect, it } from 'vitest';
import { payloadDate } from './delivery-messages';

// Connect only shows delivery_date_N as text (WhatsApp template, contact panel),
// so it follows the house rule: day first, slashes (YH, 11 Nov 2026).
describe('payloadDate', () => {
  it('sends the delivery date day first', () => {
    expect(payloadDate('2026-04-03')).toBe('03/04/2026');
    expect(payloadDate('2026-11-16T00:00:00Z')).toBe('16/11/2026');
  });
  it('sends nothing for a missing date', () => {
    expect(payloadDate(null)).toBe('');
    expect(payloadDate('')).toBe('');
  });
});
