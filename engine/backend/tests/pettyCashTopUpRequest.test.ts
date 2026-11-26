// A petty cash keeper's top-up ask is a payment request (chew, 26 Nov 2026): its key names the float it tops up.
import { describe, expect, test } from 'vitest';
import { TOP_UP_KEY, topUpFloatOf } from '../src/conts/petty-cash-topup';

describe('topUpFloatOf', () => {
  test('a top-up request names its float', () => {
    expect(topUpFloatOf(`${TOP_UP_KEY}1484447e-75eb-4dff-a2a7-30fa24dc1a71:1764150000000`)).toBe('1484447e-75eb-4dff-a2a7-30fa24dc1a71');
  });
  test('any other request is not a top-up', () => {
    expect(topUpFloatOf('utility:batch:TNB')).toBeNull();
    expect(topUpFloatOf(null)).toBeNull();
    expect(topUpFloatOf(TOP_UP_KEY)).toBeNull();
  });
});
