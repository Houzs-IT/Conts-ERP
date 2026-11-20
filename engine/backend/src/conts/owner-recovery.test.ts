import { describe, expect, test } from 'vitest';
import { readRecoveries } from './owner-recovery';
import type { LineRow } from './claims-lines';

const line = (unit_id: string | null, amount_sen: number): LineRow =>
  ({ department: 'rental', unit_id, maintenance_issue_id: null, project_id: null, account_code: null, amount_sen, description: null, sort: 0 });

describe('what the owner pays back (chew, 20 Nov 2026)', () => {
  test('the whole line or part of it, on a line for a unit; two lines of one unit add up', () => {
    const r = readRecoveries([{ recoverSen: 50000 }, { recoverSen: 3000 }, {}, { recoverSen: 1000 }],
      [line('U1', 50000), line('U2', 10000), line('U2', 4000), line('U1', 2000)]);
    expect(r).toEqual({ ok: true, byUnit: new Map([['U1', 51000], ['U2', 3000]]) });
  });
  test('refused: no unit, more than the line, nothing or less', () => {
    expect(readRecoveries([{ recoverSen: 100 }], [line(null, 500)])).toMatchObject({ ok: false });
    expect(readRecoveries([{ recoverSen: 600 }], [line('U1', 500)])).toMatchObject({ ok: false });
    expect(readRecoveries([{ recoverSen: -1 }], [line('U1', 500)])).toMatchObject({ ok: false });
    expect(readRecoveries(undefined, [line('U1', 500)])).toEqual({ ok: true, byUnit: new Map() });
  });
});
