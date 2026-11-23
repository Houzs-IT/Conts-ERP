import { describe, expect, it } from 'vitest';
import { writeSoPropertyColumns } from './customerProperty';
import type { Db, DbStmt } from './load';

/* Click sweep F3 (21 Nov 2026): on a renovation contract the property fields said saved but never changed, because
   the write only matched STANDARD orders and the project then took the unchanged SO's values. */
function fakeDb() {
  const writes: Array<{ sql: string; args: unknown[] }> = [];
  const db: Db = {
    prepare(sql: string): DbStmt {
      let args: unknown[] = [];
      const stmt: DbStmt = {
        bind: (...a: unknown[]) => { args = a; return stmt; },
        all: async <T,>() => ({ results: [] as T[] }),
        first: async () => null,
        run: async () => { writes.push({ sql, args }); return {}; },
      };
      return stmt;
    },
  };
  return { db, writes };
}

describe('writeSoPropertyColumns', () => {
  it('writes every kind of order, a renovation contract included', async () => {
    const { db, writes } = fakeDb();
    await writeSoPropertyColumns(db, 'TC-SO-2611-915', 7, {
      building: 'Tower A', unitNo: '12-3', propertyType: 'Condo', layoutLabel: '3 bed 2 bath',
      bedrooms: '3', bathrooms: '2', builtUpSqft: '951', landAreaSqft: null, landSize: '',
    } as Parameters<typeof writeSoPropertyColumns>[3]);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.sql).not.toMatch(/so_kind/);
    expect(writes[0]!.sql).toMatch(/WHERE doc_no = \?/);
    expect(writes[0]!.args).toContain('951');
    expect(writes[0]!.args.at(-1)).toBe('TC-SO-2611-915');
  });
});
