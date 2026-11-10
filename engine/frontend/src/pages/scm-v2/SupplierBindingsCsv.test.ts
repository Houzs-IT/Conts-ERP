// B3 (2026-09-17) — the bulk-import auto-create parse. buildCreates must turn an
// UNKNOWN internal_code in the sheet into a create row (with prices parsed to
// sen), leave KNOWN codes alone, and always carry a non-empty supplier_sku +
// materialName (the batch-create endpoint requires them).
import { describe, expect, test } from 'vitest';
import { buildCreates, buildLongPatches, buildWidePatches, describeBindingPatch, detectImportFormat } from './SupplierBindingsCsv';
import type { BindingRow } from '../../vendor/scm/lib/suppliers-queries';
import type { MfgProductRow } from '../../vendor/scm/lib/mfg-products-queries';

const LONG_HEADER = ['internal_code', 'supplier_sku', 'category', 'height', 'tier', 'price_rm', 'lead_time_days', 'moq', 'is_main_supplier'];

const known = (code: string): Map<string, BindingRow> =>
  new Map([[code, { item_code: code } as BindingRow]]);

describe('buildCreates — bulk import auto-create', () => {
  test('creates an accessory binding for an unknown code, parsing price to sen', () => {
    const rows = [['ACC-1', 'SUP-ACC-1', 'other', '', '', '51.25', '7', '2', 'true']];
    const creates = buildCreates(rows, LONG_HEADER, 'long', new Map(), new Map(), []);
    expect(creates).toHaveLength(1);
    const c = creates[0]!;
    expect(c.itemCode).toBe('ACC-1');
    expect(c.supplierSku).toBe('SUP-ACC-1');
    expect(c.unitPriceSen).toBe(5125); // 51.25 RM → sen
    expect(c.leadTimeDays).toBe(7);
    expect(c.moq).toBe(2);
    expect(c.isMainSupplier).toBe(true);
    expect(c.materialName).toBe('ACC-1'); // no catalogue row → fall back to code
    expect(c.materialKind).toBe('mfg_product');
  });

  test('does NOT create a binding for a code already bound to this supplier', () => {
    const rows = [['K-1', 'SUP-K-1', 'other', '', '', '10.00', '', '', '']];
    const creates = buildCreates(rows, LONG_HEADER, 'long', known('K-1'), new Map(), []);
    expect(creates).toHaveLength(0);
  });

  test('carries a sofa price matrix built from height/tier rows', () => {
    const rows = [
      ['SOFA-X', 'SUP-SOFA-X', 'sofa', '30', 'P1', '1000.00', '', '', ''],
      ['SOFA-X', 'SUP-SOFA-X', 'sofa', '30', 'P2', '1200.00', '', '', ''],
    ];
    const products = new Map<string, MfgProductRow>([
      ['SOFA-X', { code: 'SOFA-X', name: 'Sofa X', category: 'SOFA' } as MfgProductRow],
    ]);
    const creates = buildCreates(rows, LONG_HEADER, 'long', new Map(), products, ['30']);
    expect(creates).toHaveLength(1);
    const c = creates[0]!;
    expect(c.materialName).toBe('Sofa X'); // catalogue name preferred
    expect(c.supplierSku).toBe('SUP-SOFA-X');
    expect(c.priceMatrix).toEqual({ '30': { P1: 100000, P2: 120000 } });
  });

  test('falls back to the code as supplier_sku when the sheet has none', () => {
    const rows = [['RAW-9', '', 'other', '', '', '3.00', '', '', '']];
    const creates = buildCreates(rows, LONG_HEADER, 'long', new Map(), new Map(), []);
    expect(creates).toHaveLength(1);
    expect(creates[0]!.supplierSku).toBe('RAW-9');
  });

  test('detectImportFormat picks long when price_rm present', () => {
    expect(detectImportFormat(LONG_HEADER)).toBe('long');
    expect(detectImportFormat(['internal_code', 'unit_price_rm'])).toBe('wide');
  });
});

/* TODO port item 10: the price-list import says new / changed / unchanged, and a
   blank cell never wipes a stored price. */
describe('supplier price list import — changed, unchanged, blank keeps', () => {
  const bound = (b: Partial<BindingRow>): BindingRow =>
    ({ id: `b-${b.item_code}`, supplier_sku: 'S', unit_price_sen: 0, lead_time_days: 0, moq: 0, is_main_supplier: false, price_matrix: null, ...b }) as BindingRow;
  const sofa = { code: 'SOFA-1', category: 'SOFA' } as MfgProductRow;

  test('a matching row is unchanged; a new price is a change, old → new', () => {
    const map = new Map([
      ['A', bound({ item_code: 'A', unit_price_sen: 1000 })],
      ['B', bound({ item_code: 'B', unit_price_sen: 2000 })],
    ]);
    const rows = [['A', '', 'other', '', '', '10.00', '', '', ''], ['B', '', 'other', '', '', '25.50', '', '', '']];
    const { patches, matched } = buildLongPatches(rows, LONG_HEADER, map, new Map());
    expect(matched).toBe(2);
    expect([...patches.values()].map((p) => p.binding.item_code)).toEqual(['B']);
    const b = [...patches.values()][0]!;
    expect(describeBindingPatch(b.binding, b.patch)).toEqual(['Price: RM 20.00 → RM 25.50']);
  });

  test('a blank flat price keeps the stored price', () => {
    const map = new Map([['A', bound({ item_code: 'A', unit_price_sen: 1000 })]]);
    const { patches } = buildLongPatches([['A', '', 'other', '', '', '', '', '', '']], LONG_HEADER, map, new Map());
    expect(patches.size).toBe(0);
  });

  test('a blank size / tier cell keeps that price; the same matrix is not a change', () => {
    const matrix = { '30': { P1: 100000, P2: 120000 } };
    const map = new Map([['SOFA-1', bound({ item_code: 'SOFA-1', price_matrix: matrix })]]);
    const products = new Map([['SOFA-1', sofa]]);
    const same = buildLongPatches([
      ['SOFA-1', '', 'sofa', '30', 'P1', '1000.00', '', '', ''],
      ['SOFA-1', '', 'sofa', '30', 'P2', '', '', '', ''],
    ], LONG_HEADER, map, products);
    expect(same.patches.size).toBe(0);
    const wide = buildWidePatches([['SOFA-1', '', '']], ['internal_code', 'sofa_30_P1', 'sofa_30_P2'], map, products, ['30']);
    expect(wide.patches.size).toBe(0);
    expect(wide.matched).toBe(1);
    const changed = buildLongPatches([['SOFA-1', '', 'sofa', '30', 'P2', '1300.00', '', '', '']], LONG_HEADER, map, products);
    expect([...changed.patches.values()][0]!.patch.priceMatrix).toEqual({ '30': { P1: 100000, P2: 130000 } });
  });
});
