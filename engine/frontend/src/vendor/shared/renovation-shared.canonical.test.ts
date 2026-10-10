import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { RENOVATION_GROUPS } from './renovation-catalog';
import { RENO_STAGES } from './renovation-stages';
import { nextInstalmentAmount } from './renovation-money';

describe('the browser copies of the renovation modules are the backend files', () => {
  const norm = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  for (const name of ['renovation-catalog.ts', 'renovation-stages.ts', 'renovation-money.ts']) {
    test(`${name} is byte-identical to backend/src/scm/shared/${name}`, () => {
      const here = resolve(process.cwd(), `src/vendor/shared/${name}`);
      const there = resolve(process.cwd(), `../backend/src/scm/shared/${name}`);
      expect(norm(there).length).toBeGreaterThan(500);
      expect(norm(there)).toBe(norm(here));
    });
  }

  test('both copies carry real data', () => {
    expect(RENOVATION_GROUPS.length).toBe(7);
    expect(RENO_STAGES[0]).toBe('design');
    expect(nextInstalmentAmount({ instalments: [{ seq: 1, pctBp: 10000 }], seq: 1, revisedContractSen: 5, billedSen: 0 }).amountSen).toBe(5);
  });
});
