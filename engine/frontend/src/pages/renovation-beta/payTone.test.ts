import { describe, expect, test } from 'vitest';
import { payTone } from './RenovationBetaHome';
import { TONES } from './renovationBetaTheme';

describe('the payment pill colour (chew, 19 Nov 2026)', () => {
  test('fully paid green, pending amber, some instalments paid blue, none paid grey', () => {
    expect(payTone('Fully paid')[1]).toBe(TONES.accent.soft);
    expect(payTone('Pending 1st payment')[1]).toBe(TONES.amber.soft);
    expect(payTone('1 of 4 paid')[1]).toBe(TONES.blue.soft);
    expect(payTone('3 of 4 paid')[1]).toBe(TONES.blue.soft);
    expect(payTone('0 of 4 paid')[1]).toBe(TONES.grey.soft);
  });
});
