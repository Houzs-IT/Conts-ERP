import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { lineDiscountShare } from './line-discount-share';

describe('the two copies of line-discount-share are the same file', () => {
  test('backend/src/scm/shared/line-discount-share.ts is byte-identical to this one', () => {
    const norm = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n');
    const here = norm('src/vendor/shared/line-discount-share.ts');
    expect(here).toContain('lineDiscountShare');
    expect(norm('../backend/src/scm/shared/line-discount-share.ts')).toBe(here);
    expect(lineDiscountShare(4000, 2, 0, 1)).toBe(2000);
  });
});
