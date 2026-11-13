/* The line under a payment request's status on finance's list (chew, 13 Nov 2026: a withdrawn or rejected request is
   changed and sent again under its own number): why it was rejected or closed, and for one sent again after a rejection,
   that it was rejected before and why, so finance checks what changed. */
import { describe, expect, test } from 'vitest';
import { requestStatusNote } from './claimsQueries';

describe('the line under a request status', () => {
  test('rejected or closed: the reason as it is', () => {
    expect(requestStatusNote({ status: 'REJECTED', reason: 'Wrong amount', decidedBy: 'Chew' })).toBe('Wrong amount');
    expect(requestStatusNote({ status: 'CLOSED', reason: 'Supplier gave a discount', decidedBy: 'Chew' })).toBe('Supplier gave a discount');
  });
  test('sent again after a rejection: rejected before, by whom, and why', () => {
    expect(requestStatusNote({ status: 'SUBMITTED', reason: 'Wrong amount', decidedBy: 'Chew' })).toBe('Rejected before by Chew: Wrong amount');
    expect(requestStatusNote({ status: 'PAID', reason: 'Wrong amount', decidedBy: null })).toBe('Rejected before: Wrong amount');
  });
  test('no reason, no line', () => {
    expect(requestStatusNote({ status: 'SUBMITTED', reason: null, decidedBy: null })).toBeNull();
  });
});
