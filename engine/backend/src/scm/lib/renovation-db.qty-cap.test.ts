import { describe, expect, it } from 'vitest';
import { qtyCapRefusalOf } from './renovation-db';

/* The renovation routes answer a database quantity cap (migrations 0270-0275) with a 409, not "Something went wrong". */
describe('qtyCapRefusalOf', () => {
  it('names the SO and PO floors a VO can meet', () => {
    expect(qtyCapRefusalOf({ code: 'P0409', message: 'so_line_over_delivered: ...' })?.error).toBe('below_delivered');
    expect(qtyCapRefusalOf({ code: 'P0411' })?.error).toBe('below_received');
  });
  it('answers the other caps plainly', () => {
    for (const code of ['P0410', 'P0412', 'P0413']) expect(qtyCapRefusalOf({ code })?.error).toBe('qty_cap');
  });
  it('a deadlock Postgres broke (a VO meeting a DO confirm) is a "try again" 409, not a 500', () => {
    expect(qtyCapRefusalOf({ code: '40P01', message: 'deadlock detected' })?.error).toBe('busy_retry');
  });
  it('leaves every other error alone', () => {
    expect(qtyCapRefusalOf(new Error('boom'))).toBeNull();
    expect(qtyCapRefusalOf({ code: '23505' })).toBeNull();
    expect(qtyCapRefusalOf(null)).toBeNull();
  });
});
