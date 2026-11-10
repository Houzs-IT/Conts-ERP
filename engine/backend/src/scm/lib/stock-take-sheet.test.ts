// Reading a counted paper sheet back (owner 2026-10-06) and moving goods to the
// counted rack at post. Both are pure here; the routes only do I/O.
import { describe, expect, test, vi } from 'vitest';
import { matchSheetRows, normalizeSheetRows, normCode, resolveRack } from './stock-take-sheet';
import { planStockTakeRackMoves, applyStockTakeRacks, reverseStockTakeRacks } from './stock-take-racks';
import { fakeSb, type Row } from './fake-postgrest';

vi.mock('./my-time', () => ({ todayMyt: () => '2026-10-08' }));

const LINES = [
  { id: 'a', item_code: 'AK-HP SL MOB MATT (Q) -2F', variant_label: null },
  { id: 'b1', item_code: '1025-(SS)', variant_label: 'fabriccode pc151-01' },
  { id: 'b2', item_code: '1025-(SS)', variant_label: 'fabriccode pc151-02' },
  { id: 'c', item_code: 'PILLOW', variant_label: null },
];
const RACKS = [{ id: 'r1', rack: 'Rack L5.1' }, { id: 'r2', rack: 'Rack R12.2' }];
const row = (over: Partial<{ no: number | null; itemCode: string | null; variant: string | null; counted: number | null; rack: string | null; unclear: boolean }>) =>
  ({ no: null, itemCode: null, counted: null, rack: null, unclear: false, ...over });

describe('normalizing what the model read', () => {
  test('rows with nothing written are dropped; a non-integer count is no count, flagged unclear', () => {
    const rows = normalizeSheetRows({ rows: [
      { no: 1, itemCode: 'A', counted: 3, rack: null },
      { no: 2, itemCode: 'B', counted: null, rack: '' },
      { no: 3, itemCode: 'C', counted: 2.5, rack: 'L5.1' },
      { no: 4, itemCode: 'D', counted: '7', rack: null, unclear: true },
    ] });
    expect(rows).toEqual([
      { no: 1, itemCode: 'A', counted: 3, rack: null, unclear: false },
      { no: 3, itemCode: 'C', counted: null, rack: 'L5.1', unclear: true },
      { no: 4, itemCode: 'D', counted: 7, rack: null, unclear: true },
    ]);
    expect(normalizeSheetRows('garbage')).toEqual([]);
  });

  test('codes compare without case or spacing; rack labels without the word "Rack"', () => {
    expect(normCode('ak-hp  sl mob matt (q) -2f')).toBe(normCode('AK-HP SL MOB MATT (Q) -2F'));
    expect(resolveRack('l5.1', RACKS)).toBe('r1');
    expect(resolveRack('Rack R12.2', RACKS)).toBe('r2');
    expect(resolveRack('L9.9', RACKS)).toBeNull();
    expect(resolveRack(null, RACKS)).toBeNull();
  });
});

describe('matching rows to the take', () => {
  test('the printed # names the line when its code and variant agree; the rack resolves', () => {
    const { proposals, unmatched } = matchSheetRows([row({ no: 3, itemCode: '1025-(SS)', variant: 'FABRICCODE PC151-02', counted: 2, rack: 'L5.1' })], LINES, RACKS);
    expect(unmatched).toEqual([]);
    expect(proposals).toEqual([expect.objectContaining({ lineId: 'b2', counted: 2, rackId: 'r1' })]);
  });

  test('a # shifted onto a sibling variant by a later-added line: the printed variant wins', () => {
    // The sheet's row 3 was printed as pc151-01; since then the take's row 3 has become pc151-02.
    const { proposals } = matchSheetRows([row({ no: 3, itemCode: '1025-(SS)', variant: 'fabriccode pc151-01', counted: 7 })], LINES, RACKS);
    expect(proposals.map((p) => [p.lineId, p.counted])).toEqual([['b1', 7]]);
  });

  test('a shared code with no variant read is never matched by its # alone', () => {
    const { proposals, unmatched } = matchSheetRows([row({ no: 3, itemCode: '1025-(SS)', counted: 7 })], LINES, RACKS);
    expect(proposals).toEqual([]);
    expect(unmatched.map((u) => u.reason)).toEqual(['ambiguous_code']);
  });

  test('the model\'s variant is kept when it reads one', () => {
    expect(normalizeSheetRows({ rows: [{ no: 1, itemCode: 'A', variant: ' pc151-01 ', counted: 1 }] })[0]!.variant).toBe('pc151-01');
  });

  test('a # shifted by a later-added line falls back to a unique code', () => {
    const { proposals } = matchSheetRows([row({ no: 1, itemCode: 'PILLOW', counted: 4 })], LINES, RACKS);
    expect(proposals[0]!.lineId).toBe('c');
  });

  test('never guesses: a code on two variant lines with a wrong #, a code not on the sheet, a repeated line', () => {
    const { proposals, unmatched } = matchSheetRows([
      row({ no: 1, itemCode: '1025-(SS)', counted: 1 }),
      row({ no: 9, itemCode: 'NOT-HERE', counted: 1 }),
      row({ no: 4, itemCode: 'PILLOW', counted: 1 }),
      row({ no: 4, itemCode: 'PILLOW', counted: 2 }),
      row({ no: null, itemCode: null, counted: 5 }),
    ], LINES, RACKS);
    expect(proposals.map((p) => p.lineId)).toEqual(['c']);
    expect(unmatched.map((u) => u.reason)).toEqual(['ambiguous_code', 'not_on_sheet', 'duplicate_row', 'no_code']);
  });
});

describe('moving goods to the counted rack at post', () => {
  const existing = [
    { id: 'p1', rack_id: 'old', item_code: 'BED', product_name: 'Bed', qty: 3 },
    { id: 'p2', rack_id: 'old', item_code: 'MATT', product_name: 'Matt', qty: 2 },
  ];

  test('a pair whose every counted line names a rack: its old placements off, counted qty on', () => {
    const plan = planStockTakeRackMoves([
      { item_code: 'BED', variant_key: '', product_name: 'Bed', counted_qty: 3, rack_id: 'r1' },
    ], existing);
    expect(plan.remove.map((p) => p.id)).toEqual(['p1']);
    expect(plan.place).toEqual([{ rack_id: 'r1', variant_key: '', qty: 3, item_code: 'BED', product_name: 'Bed' }]);
  });

  test('counting some variants of a code leaves the placements of the variants nobody counted', () => {
    const placed = [
      { id: 'v1', rack_id: 'old', item_code: 'BED', variant_key: 'f=1', product_name: 'Bed', qty: 4 },
      { id: 'v2', rack_id: 'old', item_code: 'BED', variant_key: 'f=2', product_name: 'Bed', qty: 5 },
      { id: 'v3', rack_id: 'old', item_code: 'BED', variant_key: 'f=3', product_name: 'Bed', qty: 6 },
      { id: 'g0', rack_id: 'old', item_code: 'BED', variant_key: '', product_name: 'Bed', qty: 7 },
    ];
    const plan = planStockTakeRackMoves([
      { item_code: 'BED', variant_key: 'f=1', product_name: 'Bed', counted_qty: 2, rack_id: 'r1' },
      // f=2 is on the sheet but was not counted (null) and f=3 counted 0: neither is touched.
      { item_code: 'BED', variant_key: 'f=2', product_name: 'Bed', counted_qty: null, rack_id: null },
      { item_code: 'BED', variant_key: 'f=3', product_name: 'Bed', counted_qty: 0, rack_id: 'r1' },
    ], placed);
    expect(plan.remove.map((p) => p.id)).toEqual(['v1']);
    expect(plan.place.map((p) => [p.variant_key, p.qty])).toEqual([['f=1', 2]]);
  });

  test('per variant: each counted variant goes on its rack', () => {
    const plan = planStockTakeRackMoves([
      { item_code: 'BED', variant_key: 'f=1', product_name: 'Bed', counted_qty: 2, rack_id: 'r1' },
      { item_code: 'BED', variant_key: 'f=2', product_name: 'Bed', counted_qty: 1, rack_id: 'r1' },
    ], existing);
    // p1 is the variant-less placement and '' was not counted: it stays.
    expect(plan.remove).toEqual([]);
    expect(plan.place).toEqual([
      { rack_id: 'r1', variant_key: 'f=1', qty: 2, item_code: 'BED', product_name: 'Bed' },
      { rack_id: 'r1', variant_key: 'f=2', qty: 1, item_code: 'BED', product_name: 'Bed' },
    ]);
    expect(plan.skippedCodes).toEqual([]);
  });

  test('a pair with a counted line WITHOUT a rack is left alone, and named; other pairs still move', () => {
    const plan = planStockTakeRackMoves([
      { item_code: 'BED', variant_key: '', product_name: 'Bed', counted_qty: 2, rack_id: 'r1' },
      { item_code: 'BED', variant_key: 'x', product_name: 'Bed', counted_qty: 1, rack_id: 'r1' },
      { item_code: 'BED', variant_key: 'x', product_name: 'Bed', counted_qty: 1, rack_id: null },
      { item_code: 'MATT', variant_key: '', product_name: 'Matt', counted_qty: 5, rack_id: null },
    ], existing);
    // The '' pair moves; the 'x' pair has one line without a rack and is left alone.
    expect(plan.remove.map((p) => p.id)).toEqual(['p1']);
    expect(plan.place.map((p) => [p.variant_key, p.rack_id])).toEqual([['', 'r1']]);
    expect(plan.skippedCodes).toEqual(['BED (x)']);
  });

  test('a zero count names no placement', () => {
    const plan = planStockTakeRackMoves([
      { item_code: 'BED', variant_key: '', product_name: 'Bed', counted_qty: 0, rack_id: 'r1' },
    ], existing);
    expect(plan.place).toEqual([]);
    expect(plan.remove).toEqual([]);
  });
});

describe('reverse puts the racks back as the post found them', () => {
  test('post moves the counted pair and records it; reverse takes it off and restores the old rows', async () => {
    const sb = fakeSb({
      stock_take_lines: [
        { stock_take_id: 't1', company_id: 1, item_code: 'BED', variant_key: 'f=1', product_name: 'Bed', counted_qty: 2, rack_id: 'r-new' },
      ],
      stock_takes: [{ id: 't1', company_id: 1, rack_moves: null }],
      warehouse_racks: [
        { id: 'r-old', rack: 'A-1', warehouse_id: 'wh', company_id: 1, reserved: false, status: 'OCCUPIED' },
        { id: 'r-new', rack: 'B-2', warehouse_id: 'wh', company_id: 1, reserved: false, status: 'EMPTY' },
      ],
      warehouse_rack_items: [
        { id: 'old-1', company_id: 1, rack_id: 'r-old', item_code: 'BED', variant_key: 'f=1', product_name: 'Bed', qty: 3,
          source_doc_no: 'GRN-1', stocked_in_date: '2026-09-01', notes: null },
        { id: 'old-2', company_id: 1, rack_id: 'r-old', item_code: 'BED', variant_key: 'f=2', product_name: 'Bed', qty: 4,
          source_doc_no: 'GRN-1', stocked_in_date: '2026-09-01', notes: null },
      ],
      warehouse_rack_movements: [],
    });
    const args = { takeId: 't1', takeNo: 'ST-1', warehouseId: 'wh', companyId: 1, performedBy: 'u1' };
    const items = () => (sb.tables.warehouse_rack_items as Row[]).map((r) => [r.id, r.rack_id, r.variant_key, r.qty]);

    const posted = await applyStockTakeRacks(sb, args);
    expect(posted.error).toBeNull();
    // f=2 was not counted: still where it was.
    expect(items()).toEqual([['old-2', 'r-old', 'f=2', 4], [expect.any(String), 'r-new', 'f=1', 2]]);

    const reversed = await reverseStockTakeRacks(sb, args);
    expect(reversed).toEqual({ restored: 1, removed: 1, error: null });
    expect(items().sort()).toEqual([['old-1', 'r-old', 'f=1', 3], ['old-2', 'r-old', 'f=2', 4]]);
    const restored = (sb.tables.warehouse_rack_items as Row[]).find((r) => r.id === 'old-1')!;
    expect(restored.source_doc_no).toBe('GRN-1');
    expect((sb.tables.warehouse_rack_movements as Row[]).map((m) => m.movement_type))
      .toEqual(['STOCK_OUT', 'STOCK_IN', 'STOCK_OUT', 'STOCK_IN']);
  });

  test('a take whose post moved nothing reverses nothing', async () => {
    const sb = fakeSb({ stock_takes: [{ id: 't1', company_id: 1, rack_moves: null }], warehouse_rack_items: [] });
    const r = await reverseStockTakeRacks(sb, { takeId: 't1', takeNo: 'ST-1', warehouseId: 'wh', companyId: 1, performedBy: 'u1' });
    expect(r).toEqual({ restored: 0, removed: 0, error: null });
  });
});

describe('rack moves at post stay inside the Worker budget and read every line', () => {
  const world = (n: number, racks: number, maxRows: number | null = null) => fakeSb({
    stock_take_lines: Array.from({ length: n }, (_, i) => ({
      id: `l${i}`, stock_take_id: 't1', company_id: 1, item_code: `SKU-${String(i).padStart(4, '0')}`, variant_key: '',
      product_name: null, counted_qty: 1, rack_id: `r${i % racks}`,
    })),
    stock_takes: [{ id: 't1', company_id: 1, rack_moves: null }],
    warehouse_racks: Array.from({ length: racks * 2 }, (_, i) => ({ id: i < racks ? `r${i}` : `old${i - racks}`, rack: `R${i}`, warehouse_id: 'wh', company_id: 1, reserved: false, status: 'OCCUPIED' })),
    warehouse_rack_items: Array.from({ length: Math.min(n, racks) }, (_, i) => ({
      id: `p${i}`, company_id: 1, rack_id: `old${i}`, item_code: `SKU-${String(i).padStart(4, '0')}`, variant_key: '', product_name: null, qty: 1,
    })),
    warehouse_rack_movements: [],
  }, {}, [], [], maxRows);
  const args = { takeId: 't1', takeNo: 'ST-1', warehouseId: 'wh', companyId: 1, performedBy: 'u1' };

  test('a take touching 24 racks makes a fixed number of calls, and every rack status is right', async () => {
    const sb = world(12, 12);
    let calls = 0;
    const counting = { ...sb, from: (t: string) => { calls += 1; return sb.from(t); } };
    const r = await applyStockTakeRacks(counting, args);
    expect(r.error).toBeNull();
    expect(r.moved).toBe(12);
    // Was 8 + 3 per touched rack (80 here); now one status read and at most three status updates.
    expect(calls).toBeLessThanOrEqual(14);
    const status = new Map((sb.tables.warehouse_racks as Row[]).map((x) => [x.id, x.status]));
    expect(status.get('r0')).toBe('OCCUPIED');
    expect(status.get('old0')).toBe('EMPTY');
  });

  test('a take of 1,500 lines places all of them past the 1,000-row ceiling', async () => {
    const sb = world(1500, 3, 1000);
    const r = await applyStockTakeRacks(sb, args);
    expect(r.error).toBeNull();
    const placed = (sb.tables.warehouse_rack_items as Row[]).filter((x) => x.source_doc_no === 'ST-1');
    expect(placed).toHaveLength(1500);
  });
});
