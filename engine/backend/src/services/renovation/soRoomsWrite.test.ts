import { describe, expect, it } from 'vitest';
import { writeSoRooms } from './customerProperty';
import type { Db, DbStmt } from './load';

/* A room swap must land whole: the room list and the lines' rooms in ONE statement (TC-SO-2611-028, 21 Nov 2026). */
function fakeDb(lineIds: string[]) {
  const writes: Array<{ sql: string; args: unknown[] }> = [];
  const db: Db = {
    prepare(sql: string): DbStmt {
      let args: unknown[] = [];
      const stmt: DbStmt = {
        bind: (...a: unknown[]) => { args = a; return stmt; },
        all: async <T,>() => ({ results: lineIds.map((id) => ({ id })) as T[] }),
        first: async () => null,
        run: async () => { writes.push({ sql, args }); return {}; },
      };
      return stmt;
    },
  };
  return { db, writes };
}

describe('writeSoRooms', () => {
  it('writes the room order and every line room in one statement', async () => {
    const a = '11111111-1111-4111-8111-111111111111';
    const b = '22222222-2222-4222-8222-222222222222';
    const { db, writes } = fakeDb([a, b]);
    await writeSoRooms(db, 'TC-SO-1', ['Bedroom 1', 'Living hall'], [{ id: a, room: 'Living hall' }, { id: b, room: 'Bedroom 1' }]);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.sql).toMatch(/UPDATE scm\.mfg_sales_orders SET room_sections/);
    expect(writes[0]!.sql).toMatch(/UPDATE scm\.mfg_sales_order_items/);
    expect(JSON.parse(String(writes[0]!.args[0]))).toEqual(['Bedroom 1', 'Living hall']);
    expect(writes[0]!.args[1]).toBe('TC-SO-1');
    expect(JSON.parse(String(writes[0]!.args[2]))).toEqual([{ id: a, room: 'Living hall' }, { id: b, room: 'Bedroom 1' }]);
  });

  it('drops a line that is not on the order and still saves the room order alone', async () => {
    const { db, writes } = fakeDb([]);
    await writeSoRooms(db, 'TC-SO-1', ['Bathroom 1', 'Common area'], [{ id: '33333333-3333-4333-8333-333333333333', room: 'Bathroom 1' }]);
    expect(writes).toHaveLength(1);
    expect(JSON.parse(String(writes[0]!.args[2]))).toEqual([]);
  });
});
