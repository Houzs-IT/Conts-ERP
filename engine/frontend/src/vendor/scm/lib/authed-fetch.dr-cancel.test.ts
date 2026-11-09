import { describe, expect, it } from 'vitest';
import { humanApiError } from './authed-fetch';

/* Cancelling a Delivery Return whose units a later DO already re-shipped is
   refused by the server (lib/dr-cancel-cap.ts). The Sales Return screens (desk
   and phone) show err.message, so the refusal must read as a plain reason. */
describe('Delivery Return cancel refusals', () => {
  it('a re-shipped return names the Delivery Order to cancel first', () => {
    const msg = humanApiError(409, JSON.stringify({ error: 'cancel_over_delivers', message: 'x', lines: [] }));
    expect(msg).toMatch(/later Delivery Order already shipped these returned units again/);
    expect(msg).toMatch(/Cancel or reduce that Delivery Order first/);
  });
  it('a failed check says nothing was cancelled', () => {
    expect(humanApiError(503, JSON.stringify({ error: 'cancel_check_failed', message: 'x' }))).toMatch(/it was not cancelled/);
  });
});
