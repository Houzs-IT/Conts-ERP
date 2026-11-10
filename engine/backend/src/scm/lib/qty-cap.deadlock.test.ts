import { describe, expect, it } from 'vitest';
import { DEADLOCK_RETRY, isDeadlock } from './qty-cap';

/* Review of #856: a VO and a DO confirm taking the same lines' locks in the other order end in a deadlock Postgres
   breaks; the DO status route answers it with this "try again" 409 instead of a 500. */
describe('isDeadlock', () => {
  it('names 40P01 only', () => {
    expect(isDeadlock({ code: '40P01' })).toBe(true);
    expect(isDeadlock({ code: 'P0409' })).toBe(false);
    expect(isDeadlock(null)).toBe(false);
  });
  it('the answer says nothing was saved', () => {
    expect(DEADLOCK_RETRY.error).toBe('busy_retry');
    expect(DEADLOCK_RETRY.message).toMatch(/nothing was saved.*try again/);
  });
});
