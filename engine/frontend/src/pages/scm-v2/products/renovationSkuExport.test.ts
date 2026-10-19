/* The renovation SKU Master's Export must write a sheet Import SKUs reads back:
   the importer's own headings, carrying the stored codes. */
import { describe, expect, test } from 'vitest';
import type { MfgProductRow } from '../../../vendor/scm/lib/mfg-products-queries';
import { normalizeImportHeader } from '../products-import-headers';
import { renovationSkuColumns } from './renovationSkuColumns';

const row = {
  id: 'mfg-1', code: 'RN-CARPENTRY', name: 'Kitchen cabinet', category: 'BUILTIN',
  sub_category: 'KITCHEN', uom: 'LOT', status: 'INACTIVE', photoCount: 0,
} as unknown as MfgProductRow;

describe('renovation SKU export', () => {
  test('writes the importer headings with stored codes', () => {
    const cols = renovationSkuColumns({ showCost: false, subLabel: () => 'Kitchen', uomPrint: () => 'LS' })
      .filter((c) => c.getValue || c.exportValue);
    const sheet = Object.fromEntries(cols.map((c) => [
      normalizeImportHeader(c.exportLabel || c.label),
      c.exportValue ? c.exportValue(row) : c.getValue!(row),
    ]));
    expect(sheet).toMatchObject({
      code: 'RN-CARPENTRY', name: 'Kitchen cabinet', category: 'BUILTIN',
      sub_category: 'KITCHEN', uom: 'LOT', status: 'INACTIVE',
    });
  });
});
