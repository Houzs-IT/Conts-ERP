// Pure decisions of the renovation sales documents. The SQL flows (convert, PO
// split, billing, VO apply, PO schedule) run end to end on PGlite in
// scripts/api-checks/renovation-sales.mjs.
import { describe, expect, test } from 'vitest';
import { normaliseHeader, normaliseInstalments, normalisePoSchedule, normaliseSections } from './renovation-validate';
import { renovationFenceApplies } from './renovation-write-fence';
import { groupForPo, needsPurchaseOrder } from './renovation-po-split';
import { quotationTransitionAllowed, revisionDocNo, mergeHeader } from './renovation-quotation';
import { contractTransitionAllowed, mirrorRowsFor } from './renovation-so';
import { isPayable } from './renovation-po-schedule';
import { omitAmountSen, voNoFor } from './renovation-vo';
import { mintDocNo, yymmOf, type RenoDb } from './renovation-db';
import { projectHandoverState, onRenovationSoLinesChanged, registerRenovationSoLinesListener } from './renovation-hooks';

describe('normaliseSections', () => {
  test('children follow their item; details attach to the last item', () => {
    const r = normaliseSections([{ heading: 'A', lines: [
      { kind: 'ITEM', itemCode: 'rn-x', unitPriceSen: 100 },
      { kind: 'DETAIL', description: 'W : 8 FT' },
      { kind: 'CHILD', itemCode: 'RN-Y', qty: 2, unitPriceSen: 50 },
    ] }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [item, detail, child] = r.value[0].lines;
    expect(item.itemCode).toBe('RN-X');
    expect(detail.parentId).toBe(item.id);
    expect(child.parentId).toBe(item.id);
  });

  test('an add-on with no item before it is refused', () => {
    const r = normaliseSections([{ lines: [{ kind: 'CHILD', itemCode: 'RN-Y' }] }]);
    expect(r.ok).toBe(false);
  });

  test('measure parsed to thousandths with a measure unit', () => {
    const r = normaliseSections([{ lines: [{ kind: 'ITEM', itemCode: 'RN-X', measure: '42.6', measureUom: 'ft', unitPriceSen: 3500 }] }]);
    expect(r.ok && r.value[0].lines[0]).toMatchObject({ measureMilli: 42600, measureUom: 'FT' });
    expect(normaliseSections([{ lines: [{ kind: 'ITEM', measure: '1.2345' }] }]).ok).toBe(false);
    expect(normaliseSections([{ lines: [{ kind: 'ITEM', measure: '3', measureUom: 'SET' }] }]).ok).toBe(false);
  });

  test('system SKUs, unknown stages, priced text lines and FOC+override are refused', () => {
    expect(normaliseSections([{ lines: [{ kind: 'ITEM', itemCode: 'RENO-DISCOUNT' }] }]).ok).toBe(false);
    expect(normaliseSections([{ lines: [{ kind: 'ITEM', stageCode: 'painting' }] }]).ok).toBe(false);
    expect(normaliseSections([{ lines: [{ kind: 'TEXT', unitPriceSen: 100 }] }]).ok).toBe(false);
    expect(normaliseSections([{ lines: [{ kind: 'ITEM', isFoc: true, amountOverrideSen: 5 }] }]).ok).toBe(false);
  });

  test('VO fields only on a VO; VO sections cannot be lump sums', () => {
    expect(normaliseSections([{ lines: [{ kind: 'ITEM', voChange: 'OMIT', omitTargetLineId: crypto.randomUUID() }] }]).ok).toBe(false);
    const vo = normaliseSections([{ lines: [{ kind: 'ITEM', voChange: 'OMIT', omitTargetLineId: crypto.randomUUID() }, { kind: 'ITEM', itemCode: 'RN-X' }] }], 'vo');
    expect(vo.ok && vo.value[0].lines.map((l) => l.voChange)).toEqual(['OMIT', 'ADD']);
    expect(normaliseSections([{ lumpSumSen: 100, lines: [] }], 'vo').ok).toBe(false);
    expect(normaliseSections([{ lines: [{ kind: 'ITEM', voChange: 'OMIT' }] }], 'vo').ok).toBe(false);
  });
});

describe('instalments and schedules', () => {
  test('customer instalments must add to 100% and name real stages', () => {
    expect(normaliseInstalments([{ seq: 1, pctBp: 3000 }, { seq: 2, pctBp: 7000, stageCode: 'handover', trigger: 'stage_done' }]).ok).toBe(true);
    expect(normaliseInstalments([{ seq: 1, pctBp: 3000 }]).ok).toBe(false);
    expect(normaliseInstalments([{ seq: 1, pctBp: 10000, stageCode: 'nope' }]).ok).toBe(false);
    expect(normaliseInstalments([{ seq: 1, pctBp: 10000, trigger: 'whenever' }]).ok).toBe(false);
  });

  test('PO schedule needs payable-on and 100%', () => {
    expect(normalisePoSchedule([{ seq: 1, label: 'Mobilise', pctBp: 3000, payableOn: 'ON_CONFIRM' }, { seq: 2, label: 'Rest', pctBp: 7000, payableOn: 'ON_RECEIPT' }]).ok).toBe(true);
    expect(normalisePoSchedule([{ seq: 1, label: 'All', pctBp: 9000, payableOn: 'MANUAL' }]).ok).toBe(false);
    expect(normalisePoSchedule([]).ok).toBe(false);
  });

  test('header accepts the print formats only', () => {
    expect(normaliseHeader({ printFormat: 'DISCOUNT' }).ok).toBe(true);
    expect(normaliseHeader({ printFormat: 'FANCY' }).ok).toBe(false);
    expect(mergeHeader({ preparedBy: 'MK' }, { building: 'AVA' })).toMatchObject({ preparedBy: 'MK', building: 'AVA', printFormat: 'AMOUNT' });
  });
});

describe('write fence on /mfg-sales-orders', () => {
  test.each([
    ['PATCH', '', true],
    ['DELETE', '', true],
    ['PATCH', 'status', true],
    ['POST', 'items', true],
    ['PATCH', 'items/abc', true],
    ['POST', 'amendments', true],
    ['POST', 'payments', false],
    ['PATCH', 'payments/1', false],
    ['PATCH', 'hold', false],
    ['POST', 'items/abc/photos', false],
    ['GET', 'items', false],
  ])('%s /:docNo/%s refused for a renovation SO: %s', (method, rest, refused) => {
    expect(renovationFenceApplies(method, rest)).toBe(refused);
  });
});

describe('status machines and numbering', () => {
  test('quotation', () => {
    expect(quotationTransitionAllowed('DRAFT', 'SENT')).toBe(true);
    expect(quotationTransitionAllowed('SENT', 'ACCEPTED')).toBe(true);
    expect(quotationTransitionAllowed('DRAFT', 'ACCEPTED')).toBe(false);
    expect(quotationTransitionAllowed('REJECTED', 'SENT')).toBe(false);
    expect(revisionDocNo('QT-2610-001', 1)).toBe('QT-2610-001');
    expect(revisionDocNo('QT-2610-001', 3)).toBe('QT-2610-001-R3');
  });

  test('contract', () => {
    expect(contractTransitionAllowed('RENO_CONFIRMED', 'RENO_IN_PROGRESS')).toBe(true);
    expect(contractTransitionAllowed('RENO_COMPLETED', 'CLOSED')).toBe(true);
    expect(contractTransitionAllowed('RENO_IN_PROGRESS', 'CANCELLED')).toBe(false);
    expect(contractTransitionAllowed('CLOSED', 'RENO_IN_PROGRESS')).toBe(false);
  });

  test('VO number', () => {
    expect(voNoFor('HC-SO-2610-001', 2)).toBe('VO-HC-SO-2610-001-02');
  });

  test('yymm', () => {
    expect(yymmOf('2026-10-09')).toBe('2610');
    expect(() => yymmOf('09/10/2026')).toThrow();
  });

  test('mintDocNo raises the counter to the live max', async () => {
    const calls: Array<[string, readonly unknown[]]> = [];
    const db: RenoDb = {
      async q<T>(text: string, params: readonly unknown[] = []) {
        calls.push([text, params]);
        return (text.includes('next_doc_no_n') ? [{ n: 8 }] : [{ n: 7 }]) as T[];
      },
    };
    expect(await mintDocNo(db, 'reno_quotations', 'quote_no', 'QT-2610')).toBe('QT-2610-008');
    expect(calls[1][1]).toEqual(['QT-2610', 7]);
    await expect(mintDocNo(db, 'reno quotations', 'x', 'QT')).rejects.toThrow(/unsafe/);
  });
});

describe('PO split grouping', () => {
  const row = (p: Record<string, unknown>) => ({
    line_id: crypto.randomUUID(), so_item_id: crypto.randomUUID(), kind: 'ITEM' as const, item_code: 'RN-X', description: 'x', qty: 1,
    measure: null, measure_uom: null, uom: null, unit_cost_sen: 1000, supply_by_owner: false, supplier_id: 'sup-a', supplier_code: 'A',
    supplier_name: 'A', category: 'ACCESSORY', item_description2: null, item_uom: 'UNIT', ordered_qty: 0, ...p,
  });

  test('groups by supplier, skips owner-supplied goods but keeps labour', () => {
    const r = groupForPo([
      row({ description: 'cabinet' }),
      row({ description: 'labour', supplier_id: 'sup-b', supplier_name: 'B', category: 'WORKS', supply_by_owner: true }),
      row({ description: 'owner lamp', supply_by_owner: true }),
      row({ description: 'in house', supplier_id: null, unit_cost_sen: 0 }),
      row({ description: 'no supplier', supplier_id: null }),
      row({ description: 'done', ordered_qty: 1 }),
      row({ description: 'system', item_code: 'RENO-ADJUST' }),
    ]);
    expect(r.groups.map((g) => g.lines.map((l) => l.description))).toEqual([['cabinet'], ['labour']]);
    expect(r.skipped.map((l) => l.description)).toEqual(['owner lamp', 'in house']);
    expect(r.blocked.map((l) => l.description)).toEqual(['no supplier']);
    expect(r.alreadyOrdered.map((l) => l.description)).toEqual(['done']);
  });

  test('needsPurchaseOrder agrees with the split: only lines the split would order (or blocks) need one', () => {
    const rows = [
      row({ description: 'cabinet' }),
      row({ description: 'labour', category: 'WORKS', supply_by_owner: true }),
      row({ description: 'owner lamp', supply_by_owner: true }),
      row({ description: 'in house', supplier_id: null, unit_cost_sen: 0 }),
      row({ description: 'no supplier', supplier_id: null }),
      row({ description: 'system', item_code: 'RENO-ADJUST' }),
    ];
    const r = groupForPo(rows);
    const ordered = new Set([...r.groups.flatMap((g) => g.lines), ...r.blocked].map((l) => l.description));
    for (const x of rows) {
      const need = needsPurchaseOrder({ itemCode: x.item_code, supplyByOwner: x.supply_by_owner, category: x.category, supplierId: x.supplier_id, unitCostSen: x.unit_cost_sen });
      expect(need, x.description).toBe(ordered.has(x.description));
    }
  });

  test('customer-supplied items (supplier CUSTOMER, cost 0) never raise a PO, not even a zero one (owner, 22 Oct 2026)', () => {
    const rows = [
      row({ description: 'cabinet' }),
      row({ description: 'customer fridge', item_code: 'CUS-FRIDGE', unit_cost_sen: 0, supplier_id: 'sup-c', supplier_code: 'CUSTOMER', supplier_name: 'Customer' }),
      row({ description: 'customer tv, re-sourced', item_code: 'CUS-TV', unit_cost_sen: 90000, supplier_id: 'sup-a', supplier_code: 'A' }),
    ];
    const r = groupForPo(rows);
    expect(r.groups.map((g) => g.lines.map((l) => l.description))).toEqual([['cabinet', 'customer tv, re-sourced']]);
    expect(r.skipped.map((l) => [l.description, l.reason])).toEqual([['customer fridge', 'Customer-supplied: the customer orders it, no purchase order']]);
    expect(needsPurchaseOrder({ itemCode: 'CUS-FRIDGE', supplyByOwner: false, category: 'APPLIANCE', supplierId: 'sup-c', unitCostSen: 0 })).toBe(false);
    expect(needsPurchaseOrder({ itemCode: 'CUS-TV', supplyByOwner: false, category: 'APPLIANCE', supplierId: 'sup-a', unitCostSen: 90000 })).toBe(true);
  });

  test('one supplier, two category groups: two POs, never one mixed PO (owner, 14 Oct 2026)', () => {
    const r = groupForPo([
      row({ description: 'switch', category: 'WORKS' }),
      row({ description: 'wardrobe', category: 'BUILTIN' }),
      row({ description: 'socket', category: 'WORKS' }),
    ]);
    expect(r.groups.map((g) => [g.categoryGroup, g.lines.map((l) => l.description)])).toEqual([['BUILTIN', ['wardrobe']], ['WORKS', ['switch', 'socket']]]);
  });

  test('measured lines order one unit at measure x cost; partly ordered lines order the rest', () => {
    const r = groupForPo([row({ measure: '42.600', measure_uom: 'FT', unit_cost_sen: 1500 }), row({ qty: 5, ordered_qty: 2 })]);
    expect(r.groups[0].lines.map((l) => [l.qty, l.amountSen])).toEqual([[1, 63900], [3, 3000]]);
  });
});

describe('PO payment schedule', () => {
  const s = { poStatus: 'SUBMITTED', fullyReceived: false, handover: 'unknown' as const, releasedAt: null };
  test('payable at read time', () => {
    expect(isPayable('ON_CONFIRM', s)).toBe(true);
    expect(isPayable('ON_RECEIPT', s)).toBe(false);
    expect(isPayable('ON_RECEIPT', { ...s, fullyReceived: true })).toBe(true);
    expect(isPayable('ON_HANDOVER', s)).toBe(false);
    expect(isPayable('ON_HANDOVER', { ...s, handover: 'handed_over' })).toBe(true);
    expect(isPayable('MANUAL', { ...s, releasedAt: '2026-10-09' })).toBe(true);
    expect(isPayable('ON_CONFIRM', { ...s, poStatus: 'DRAFT' })).toBe(false);
    expect(isPayable('ON_CONFIRM', { ...s, poStatus: 'CANCELLED', releasedAt: 'x' })).toBe(false);
  });
});

describe('VO omit amounts', () => {
  const t = { kind: 'ITEM' as const, qty: 4, measureMilli: null, measureUom: null, uom: null, unitPriceSen: 9000, discountBp: 0, amountOverrideSen: null, isFoc: false };
  test('full and partial omit', () => {
    expect(omitAmountSen(t, null)).toBe(-36000);
    expect(omitAmountSen(t, 1)).toBe(-9000);
    expect(omitAmountSen({ ...t, discountBp: 4000 }, 1)).toBe(-5400);
    expect(omitAmountSen({ ...t, qty: 1, measureMilli: 20000, unitPriceSen: 1500 }, 1)).toBe(-30000);
  });
});

describe('SO mirror rows for a structure', () => {
  test('lump-sum section gets one priced row; its lines carry none', () => {
    const r = normaliseSections([
      { heading: 'CURTAIN', lumpSumSen: 323100, lines: [{ kind: 'ITEM', itemCode: 'RN-C', unitCostSen: 100 }] },
      { heading: 'X', lines: [{ kind: 'ITEM', itemCode: 'RN-X', qty: 2, unitPriceSen: 500, unitCostSen: 200 }] },
    ]);
    if (!r.ok) throw new Error(r.problems.join());
    const rows = mirrorRowsFor(r.value, () => 'name', 1);
    expect(rows.map((x) => [x.item_code, x.total_sen, x.line_cost_sen])).toEqual([['RENO-ADJUST', 323100, 0], ['RN-C', 0, 100], ['RN-X', 1000, 400]]);
    expect(r.value[0].soItemId).toBe(rows[0].id);
    expect(r.value[1].lines[0].soItemId).toBe(rows[2].id);
  });
});

describe('phase 3 seams', () => {
  test('handover state reads phase 3 project_handovers; no connection, no project or a failed read is unknown', async () => {
    expect(await projectHandoverState(null, 1)).toBe('unknown');
    const seen: Array<[string, readonly unknown[]]> = [];
    const db = (rows: unknown[]) => ({ q: async (t: string, p: readonly unknown[] = []) => { seen.push([t, p]); return rows as any[]; } });
    expect(await projectHandoverState(db([{ ok: 1 }]), 7)).toBe('handed_over');
    expect(seen[0]![0]).toMatch(/from public\.project_handovers where project_id = \$1/i);
    expect(seen[0]![1]).toEqual([7]);
    expect(await projectHandoverState(db([]), 7)).toBe('not_handed_over');
    expect(await projectHandoverState(db([{ ok: 1 }]), null)).toBe('unknown');
    expect(await projectHandoverState({ q: async () => { throw new Error('down'); } }, 7)).toBe('unknown');
  });
  test('a failing listener never fails the sale', async () => {
    const seen: string[] = [];
    const off1 = registerRenovationSoLinesListener(() => { throw new Error('boom'); });
    const off2 = registerRenovationSoLinesListener((d) => { seen.push(d); });
    await expect(onRenovationSoLinesChanged('HC-SO-2610-001')).resolves.toBeUndefined();
    expect(seen).toEqual(['HC-SO-2610-001']);
    off1(); off2();
  });
});
