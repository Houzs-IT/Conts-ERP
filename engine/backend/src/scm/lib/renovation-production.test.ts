import { describe, expect, it } from 'vitest';
import {
  allocateIssue, bucketOf, checkReturn, claimShortfall, holidaySet, isOverdue, materialPoWarehouse, materialVerdict, openDemandOf, progressOf, scheduleDays, stockStatusOf, validHours, wholeNeed,
} from './renovation-production';
import { issueMaterials, returnMaterial, reverseIssues, PRODUCTION_DOC } from './renovation-production-stock';

const none = new Set<string>();

describe('schedule days', () => {
  it('leaves out Sundays: 3 to 10 Nov 2026 is 7 days', () => {
    expect(scheduleDays('2026-11-03', '2026-11-10', none)).toEqual(['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-09', '2026-11-10']);
  });
  it('leaves out a public holiday', () => {
    expect(scheduleDays('2026-11-03', '2026-11-10', new Set(['2026-11-09']))).toHaveLength(6);
  });
  it('is empty without both dates, or with the dates the wrong way round', () => {
    expect(scheduleDays(null, '2026-11-10', none)).toEqual([]);
    expect(scheduleDays('2026-11-10', '2026-11-03', none)).toEqual([]);
  });
  it('counts a holiday for the whole country and for the project state only', () => {
    const rows = [{ holiday_date: '2026-02-01', state: 'Kuala Lumpur' }, { holiday_date: '2026-08-31', state: null }];
    expect([...holidaySet(rows, 'Kuala Lumpur')].sort()).toEqual(['2026-02-01', '2026-08-31']);
    expect([...holidaySet(rows, 'Johor')]).toEqual(['2026-08-31']);
    expect([...holidaySet(rows, null)]).toEqual(['2026-08-31']);
  });
});

describe('progress', () => {
  const running = { status: 'SUBMITTED', plan_start: '2026-11-03', expected_at: '2026-11-10', actual_start_at: '2026-11-03T02:00:00Z' };
  it('reads Day 4 of 7 on the 6th', () => {
    const p = progressOf(running, '2026-11-06', none);
    expect(p).toMatchObject({ label: 'Day 4 of 7', dayNo: 4, daysLeft: 3, pct: 57, statusLabel: 'In Progress', overdue: false });
  });
  it('a Sunday inside the plan adds no day', () => {
    expect(progressOf(running, '2026-11-08', none).dayNo).toBe(progressOf(running, '2026-11-07', none).dayNo);
  });
  it('keeps counting past plan finish and reads Overdue', () => {
    const p = progressOf(running, '2026-11-13', none);
    expect(p.overdue).toBe(true);
    expect(p.statusLabel).toBe('Overdue');
    expect(p.label).toBe('Day 10 of 7');
    expect(p.pct).toBe(100);
  });
  it('a pending order has no progress but can be overdue', () => {
    const pending = { ...running, actual_start_at: null };
    expect(progressOf(pending, '2026-11-05', none)).toMatchObject({ label: '', dayNo: null, statusLabel: 'Pending' });
    expect(isOverdue(pending, '2026-11-11')).toBe(true);
  });
  it('held and cancelled orders are not overdue', () => {
    expect(isOverdue({ ...running, on_hold: true }, '2026-12-01')).toBe(false);
    expect(isOverdue({ ...running, status: 'CANCELLED' }, '2026-12-01')).toBe(false);
  });
  it('a completed order reads how long it took', () => {
    const done = { ...running, status: 'RECEIVED', received_at: '2026-11-07T08:00:00Z' };
    expect(bucketOf(done)).toBe('completed');
    expect(progressOf(done, '2026-11-20', none)).toMatchObject({ label: 'Done in 5 days', pct: 100, overdue: false, statusLabel: 'Completed' });
  });
});

describe('issue quantities', () => {
  it('rounds a fractional need up', () => {
    expect(wholeNeed(12.5)).toBe(13);
    expect(wholeNeed('12.000')).toBe(12);
  });
  it('walks the warehouses holding the most', () => {
    expect(allocateIssue(10, [{ warehouseId: 'a', qty: 4 }, { warehouseId: 'b', qty: 8 }], 'a')).toEqual({ picks: [{ warehouseId: 'b', qty: 8 }, { warehouseId: 'a', qty: 2 }], short: 0 });
  });
  it('still issues what the pool cannot cover, off the fallback', () => {
    expect(allocateIssue(10, [{ warehouseId: 'a', qty: 4 }], 'a')).toEqual({ picks: [{ warehouseId: 'a', qty: 10 }], short: 6 });
    expect(allocateIssue(5, [], 'blk')).toEqual({ picks: [{ warehouseId: 'blk', qty: 5 }], short: 5 });
  });
  it('ignores a negative balance', () => {
    expect(allocateIssue(3, [{ warehouseId: 'a', qty: -7 }], 'a')).toEqual({ picks: [{ warehouseId: 'a', qty: 3 }], short: 3 });
  });
  it('two materials on one SKU share the pool, not each the whole of it', () => {
    const pool = [{ warehouseId: 'a', qty: 5 }];
    expect(allocateIssue(3, pool, 'a').short).toBe(0);
    expect(allocateIssue(3, pool, 'a').short).toBe(1);
  });
});

describe('return check', () => {
  const m = new Map([['m1', { item_code: 'DOR-1', qty_issued: 10, qty_returned: 4 }]]);
  it('passes within what is out', () => expect(checkReturn([{ materialId: 'm1', qty: 6, warehouseId: 'w' }], m)).toBeNull());
  it('refuses more than is out, across lines', () => {
    expect(checkReturn([{ materialId: 'm1', qty: 4, warehouseId: 'w' }, { materialId: 'm1', qty: 3, warehouseId: 'x' }], m)).toMatch(/only 6/);
  });
  it('refuses a fraction, a missing warehouse and a stranger', () => {
    expect(checkReturn([{ materialId: 'm1', qty: 1.5, warehouseId: 'w' }], m)).toMatch(/whole number/);
    expect(checkReturn([{ materialId: 'm1', qty: 1, warehouseId: '' }], m)).toMatch(/warehouse/);
    expect(checkReturn([{ materialId: 'zz', qty: 1, warehouseId: 'w' }], m)).toMatch(/no longer/);
  });
});

describe('MRP demand', () => {
  it('before Start a material asks for all of it, received or not', () => {
    expect(openDemandOf({ qty_needed: 12.5, qty_issued: 0, qty_issued_short: 0 })).toEqual({ unissued: 13, shortfall: 0 });
  });
  it('after Start only the shortfall stays asked for', () => {
    expect(openDemandOf({ qty_needed: 12, qty_issued: 12, qty_issued_short: 5 })).toEqual({ unissued: 0, shortfall: 5 });
  });
  it('a shortfall moves from the balance onto the line', () => {
    const rows = [{ qty: 5 }];
    expect(claimShortfall(rows, -5)).toEqual({ kept: [{ qty: 5 }], balance: 0 });
  });
  it('asks for nothing once the balance has recovered', () => {
    expect(claimShortfall([{ qty: 5 }], 0)).toEqual({ kept: [], balance: 0 });
    expect(claimShortfall([{ qty: 5 }], 3)).toEqual({ kept: [], balance: 3 });
  });
  it('a partly covered shortfall asks for the rest, earliest line first', () => {
    const rows = [{ qty: 5 }, { qty: 5 }];
    const { kept, balance } = claimShortfall(rows, -7);
    expect(kept.map((r) => r.qty)).toEqual([5, 2]);
    expect(balance).toBe(0);
  });
});

describe('material verdict', () => {
  const m = { id: 'm', qty_needed: 10, qty_issued: 0, qty_issued_short: 0 };
  const po = { qty: 10, received_qty: 4, delivery_date: '2026-11-10', purchase_order_id: 'p1', po: { po_number: 'PO-1', expected_at: '2026-11-12' } };
  it('reads PO number and ETA from the same PO, not the pool', () => {
    const v = materialVerdict(m, [po], { source: 'po', shortageQty: 0, poNumber: 'PO-OTHER', poEta: '2026-12-01' });
    expect(v).toMatchObject({ state: 'po', poNumber: 'PO-1', eta: '2026-11-10', received: 4, onOrder: 6 });
  });
  it('falls back to the pool only when the material has no PO of its own', () => {
    expect(materialVerdict(m, [], { source: 'po', shortageQty: 0, poNumber: 'PO-OTHER', poEta: '2026-12-01' })).toMatchObject({ poNumber: 'PO-OTHER', eta: '2026-12-01', poId: null });
  });
  it('a material MRP no longer plans still says what it has', () => {
    expect(materialVerdict(m, [], undefined)).toMatchObject({ state: 'short', shortQty: 10 });
    expect(materialVerdict(m, [po], undefined)).toMatchObject({ state: 'po' });
    expect(materialVerdict({ ...m, qty_issued: 10 }, [], undefined)).toMatchObject({ state: 'stock', shortQty: null });
  });
  it('a shortfall on an issued material reads Short', () => {
    expect(materialVerdict({ ...m, qty_issued: 10, qty_issued_short: 3 }, [], { source: 'shortage', shortageQty: 3, poNumber: null, poEta: null })).toMatchObject({ state: 'short', shortQty: 3 });
  });
  it('rolls up to READY or NOT READY', () => {
    expect(stockStatusOf(['stock', 'received'])).toBe('READY');
    expect(stockStatusOf(['stock', 'po'])).toBe('NOT READY');
    expect(stockStatusOf([])).toBeNull();
  });
});

describe('hours', () => {
  it('takes a number, a blank, and refuses the rest', () => {
    expect(validHours('20')).toBe(20);
    expect(validHours('')).toBeNull();
    expect(validHours('x')).toBe('bad');
    expect(validHours(-1)).toBe('bad');
  });
});

/* A database small enough to read: the tables the stock code touches, and the few PostgREST verbs it uses. */
type Row = Record<string, any>;
function fakeDb(tables: Record<string, Row[]>, opts: { failInsertOn?: string } = {}) {
  const writes: Row[] = [];
  const from = (name: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let patch: Row | null = null;
    const run = async () => {
      const rows = (tables[name] ?? []).filter((r) => filters.every((f) => f(r)));
      if (patch) for (const r of rows) Object.assign(r, patch);
      return { data: rows.map((r) => ({ ...r })), error: null };
    };
    const q: any = {
      select: () => q,
      eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return q; },
      in: (k: string, v: unknown[]) => { filters.push((r) => v.includes(r[k])); return q; },
      order: () => q,
      limit: () => q,
      update: (p: Row) => { patch = p; return q; },
      insert: async (rows: Row[]) => {
        if (opts.failInsertOn === name) return { error: { message: 'the database said no' } };
        tables[name] = [...(tables[name] ?? []), ...rows.map((r) => ({ company_id: 1, ...r }))];
        writes.push(...rows);
        return { error: null };
      },
      maybeSingle: async () => { const r = await run(); return { data: r.data[0] ?? null, error: null }; },
      then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => run().then(ok, bad),
    };
    return q;
  };
  return { from, writes, tables };
}

const seed = () => ({
  warehouses: [{ id: 'blk', code: 'BLK', is_default: true, company_id: 1 }, { id: 'kl', code: 'KL', is_default: false, company_id: 1 }, { id: 'on', code: 'ONSITE', is_default: false, company_id: 1 }],
  inventory_balances: [
    { warehouse_id: 'blk', item_code: 'PLY', variant_key: '', qty: 8, company_id: 1 },
    { warehouse_id: 'kl', item_code: 'PLY', variant_key: '', qty: 3, company_id: 1 },
    { warehouse_id: 'on', item_code: 'PLY', variant_key: '', qty: 100, company_id: 1 },
  ],
  inventory_movements: [] as Row[],
  production_order_materials: [
    { id: 'm1', production_order_id: 'o1', item_code: 'PLY', description: 'Plywood', qty_needed: 12.5, qty_issued: 0, qty_returned: 0, qty_issued_short: 0 },
    { id: 'm2', production_order_id: 'o1', item_code: 'GLASS', description: 'Glass', qty_needed: 2, qty_issued: 0, qty_returned: 0, qty_issued_short: 0 },
  ],
});
const start = (db: ReturnType<typeof fakeDb>) => issueMaterials(db, { orderId: 'o1', poNumber: 'TC-PRO-1', companyId: 1, performedBy: 'staff' });

describe('Start', () => {
  it('issues whole units from the pool, never from on-site, and goes negative for the rest', async () => {
    const db = fakeDb(seed());
    expect(await start(db)).toEqual({ ok: true, issuedLines: 2, shortLines: 2 });
    const out = db.tables.inventory_movements!.map((m) => [m.item_code, m.warehouse_id, m.qty, m.movement_type]);
    expect(out).toEqual([['PLY', 'blk', 10, 'OUT'], ['PLY', 'kl', 3, 'OUT'], ['GLASS', 'blk', 2, 'OUT']]);
    expect(db.tables.inventory_movements!.every((m) => m.source_doc_type === PRODUCTION_DOC)).toBe(true);
    const m1 = db.tables.production_order_materials!.find((m) => m.id === 'm1')!;
    expect(m1).toMatchObject({ qty_issued: 13, qty_issued_short: 2 });
  });
  it('a second run issues nothing', async () => {
    const db = fakeDb(seed());
    await start(db);
    const before = db.tables.inventory_movements!.length;
    await start(db);
    expect(db.tables.inventory_movements!).toHaveLength(before);
  });
  it('a stop after the movements but before the stamp does not issue twice', async () => {
    const db = fakeDb(seed());
    await start(db);
    for (const m of db.tables.production_order_materials!) m.qty_issued = 0;
    await start(db);
    expect(db.tables.inventory_movements!).toHaveLength(3);
    expect(db.tables.production_order_materials!.find((m) => m.id === 'm1')!.qty_issued).toBe(13);
  });
  it('a failed stock write stops Start and says so', async () => {
    const db = fakeDb(seed(), { failInsertOn: 'inventory_movements' });
    const r = await start(db);
    expect(r).toMatchObject({ ok: false });
    expect((r as { reason: string }).reason).toMatch(/did not move/);
    expect(db.tables.production_order_materials!.every((m) => m.qty_issued === 0)).toBe(true);
  });
  it('a material added after Start issues on the next run, alone', async () => {
    const db = fakeDb(seed());
    await start(db);
    db.tables.production_order_materials!.find((m) => m.id === 'm2')!.qty_needed = 5;
    await start(db);
    expect(db.tables.inventory_movements!.filter((m) => m.item_code === 'GLASS').map((m) => m.qty)).toEqual([2, 3]);
  });
});

describe('Request more', () => {
  it('issues the one requested material, and with no stock it is short', async () => {
    const db = fakeDb(seed());
    db.tables.production_order_materials!.push({ id: 'm3', production_order_id: 'o1', item_code: 'NAILS', description: 'Nails', qty_needed: 20, qty_issued: 0, qty_returned: 0, qty_issued_short: 0 });
    const r = await issueMaterials(db, { orderId: 'o1', poNumber: 'TC-PRO-1', companyId: 1, performedBy: 'staff', only: ['m3'] });
    expect(r).toEqual({ ok: true, issuedLines: 1, shortLines: 1 });
    expect(db.tables.inventory_movements!.map((m) => m.item_code)).toEqual(['NAILS']);
    expect(db.tables.production_order_materials!.find((m) => m.id === 'm3')!.qty_issued_short).toBe(20);
  });
});

describe('Return stock', () => {
  const m = () => ({ id: 'm1', item_code: 'PLY', description: 'Plywood', qty_needed: 12, qty_issued: 10, qty_returned: 0, qty_issued_short: 0 });
  const go = (db: ReturnType<typeof fakeDb>, qty: number, warehouseId = 'kl') => returnMaterial(db, { m: m(), qty, warehouseId, poNumber: 'TC-PRO-1', companyId: 1, performedBy: 'staff' });

  it('writes an IN to the warehouse picked, at what the stock cost', async () => {
    const db = fakeDb({ production_order_materials: [m()], inventory_movements: [{ source_doc_type: PRODUCTION_DOC, source_doc_id: 'm1', movement_type: 'OUT', qty: 10, unit_cost_sen: 250 }] });
    expect(await go(db, 3)).toBeNull();
    expect(db.tables.inventory_movements!.at(-1)).toMatchObject({ movement_type: 'IN', warehouse_id: 'kl', qty: 3, unit_cost_sen: 250 });
    expect(db.tables.production_order_materials![0]).toMatchObject({ qty_returned: 3 });
  });
  it('a second return from the same read is refused, not doubled', async () => {
    const db = fakeDb({ production_order_materials: [m()], inventory_movements: [] });
    expect(await go(db, 3)).toBeNull();
    expect(await go(db, 3)).toMatch(/changed/);
    expect(db.tables.inventory_movements!).toHaveLength(1);
  });
  it('a failed write gives the count back', async () => {
    const db = fakeDb({ production_order_materials: [m()], inventory_movements: [] }, { failInsertOn: 'inventory_movements' });
    expect(await go(db, 3)).toMatch(/did not go back/);
    expect(db.tables.production_order_materials![0]).toMatchObject({ qty_returned: 0 });
  });
});

describe('reversal', () => {
  it('puts everything back, and the next Start issues again', async () => {
    const db = fakeDb(seed());
    await start(db);
    expect(await reverseIssues(db, 'o1', 'staff')).toEqual({ ok: true });
    const net = db.tables.inventory_movements!.reduce((t, r) => t + (r.movement_type === 'OUT' ? -r.qty : r.qty), 0);
    expect(net).toBe(0);
    expect(db.tables.production_order_materials!.every((m) => m.qty_issued === 0 && m.qty_returned === 0 && m.qty_issued_short === 0)).toBe(true);
    await start(db);
    expect(db.tables.production_order_materials!.find((m) => m.id === 'm1')!.qty_issued).toBe(13);
  });
  it('repeating it moves nothing more', async () => {
    const db = fakeDb(seed());
    await start(db);
    await reverseIssues(db, 'o1', 'staff');
    const n = db.tables.inventory_movements!.length;
    await reverseIssues(db, 'o1', 'staff');
    expect(db.tables.inventory_movements!).toHaveLength(n);
  });
});

describe('materialPoWarehouse', () => {
  const list = [{ id: 'a', code: 'AAA' }, { id: 'b', code: 'BLK', is_default: true }, { id: 's', code: 'ONSITE' }];
  it('keeps a warehouse that counts stock', () => {
    expect(materialPoWarehouse(['a', 'b'], list)).toBe('a');
  });
  it('skips On-site for the next wanted one, then the default', () => {
    expect(materialPoWarehouse(['s', 'a'], list)).toBe('a');
    expect(materialPoWarehouse(['s', 's'], list)).toBe('b');
    expect(materialPoWarehouse([null, null], list)).toBe('b');
  });
  it('has nothing to give with only On-site', () => {
    expect(materialPoWarehouse(['s'], [list[2]!])).toBeNull();
  });
});
