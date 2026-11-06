import { describe, expect, it } from 'vitest';
import { customizedKey, isCustomizedLine } from './so-line-customized';

describe('customized lines', () => {
  it('reads a blank remark as a plain line', () => {
    expect(isCustomizedLine(null)).toBe(false);
    expect(isCustomizedLine('   ')).toBe(false);
  });
  it('reads any remark as customized', () => {
    expect(isCustomizedLine('Longer legs')).toBe(true);
  });
  it('treats spaces and capitals as the same remark, and other words as different', () => {
    expect(customizedKey(' Longer   LEGS ')).toBe(customizedKey('longer legs'));
    expect(customizedKey('longer legs')).not.toBe(customizedKey('shorter legs'));
  });
});
