import { describe, expect, test } from 'vitest';
import type { RenoDb } from './renovation-db';
import { contractBrand } from './renovation-so';

interface Call { sql: string; params: readonly unknown[] }

function fakeDb(rows: unknown[]): { db: RenoDb; calls: Call[] } {
  const calls: Call[] = [];
  const db = { q: async (sql: string, params: readonly unknown[] = []) => { calls.push({ sql, params }); return rows; } } as unknown as RenoDb;
  return { db, calls };
}

describe('contractBrand', () => {
  test('usesTheQuotationBrandWhenItHasOne', async () => {
    const { db, calls } = fakeDb([{ id: '3', name: 'The Conts' }]);
    expect(await contractBrand(db, 3, 97)).toEqual({ id: 3, name: 'The Conts' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.params).toEqual([3]);
  });

  test('fallsBackToTheProjectBrandWhenTheQuotationHasNone', async () => {
    const { db, calls } = fakeDb([{ id: '2', name: 'Dream Crafter' }]);
    expect(await contractBrand(db, null, 97)).toEqual({ id: 2, name: 'Dream Crafter' });
    expect(calls[0]?.sql).toMatch(/from public\.projects p\s+join public\.project_brands b/i);
    expect(calls[0]?.params).toEqual([97]);
  });

  test('isNullWhenNeitherHasABrand', async () => {
    expect(await contractBrand(fakeDb([]).db, null, 97)).toBeNull();
    const { db, calls } = fakeDb([]);
    expect(await contractBrand(db, null, null)).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
