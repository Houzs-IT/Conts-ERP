import { describe, expect, test } from 'vitest';
import {
  findTransferShortages, insufficientStockBody, shortageFromPgError, shortageSentence,
} from './stock-transfer-availability';

describe('findTransferShortages', () => {
  const open = new Map([['SOFA-01::', 5], ['BED-02::grey', 2]]);

  test('99 asked out of 5 held is short', () => {
    expect(findTransferShortages([{ item_code: 'SOFA-01', variant_key: '', qty: 99 }], open)).toEqual([
      { itemCode: 'SOFA-01', productName: null, variantKey: '', requested: 99, available: 5 },
    ]);
  });

  test('exactly what is held passes', () => {
    expect(findTransferShortages([{ item_code: 'SOFA-01', variant_key: '', qty: 5 }], open)).toEqual([]);
  });

  test('two lines of one bucket add up', () => {
    const s = findTransferShortages([
      { item_code: 'SOFA-01', variant_key: '', qty: 3 },
      { item_code: 'SOFA-01', variant_key: null, qty: 3 },
    ], open);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ requested: 6, available: 5 });
  });

  test('a bucket with nothing open is short by all of it; variants do not borrow from each other', () => {
    expect(findTransferShortages([{ item_code: 'BED-02', variant_key: 'blue', qty: 1 }], open)[0])
      .toMatchObject({ variantKey: 'blue', available: 0 });
  });

  test('an edit credits back what its old lines took', () => {
    expect(findTransferShortages([{ item_code: 'SOFA-01', variant_key: '', qty: 7 }], open, new Map([['SOFA-01::', 2]]))).toEqual([]);
  });
});

describe('refusal wording', () => {
  test('one shortage: a plain message naming item, warehouse, on hand and asked', () => {
    const body = insufficientStockBody([{ itemCode: 'SOFA-01', productName: null, variantKey: '', requested: 99, available: 5 }], 'WH-A');
    expect(body).toMatchObject({ error: 'insufficient_stock', message: 'Only 5 of SOFA-01 in WH-A; this transfer asks for 99.' });
    expect('problems' in body).toBe(false);
  });

  test('nothing on hand and a variant', () => {
    expect(shortageSentence({ itemCode: 'BED-02', productName: null, variantKey: 'blue', requested: 1, available: 0 }, 'WH-A'))
      .toBe('No BED-02 (blue) is left in WH-A; this transfer asks for 1.');
  });

  test('several shortages: a problems list, one line each', () => {
    const body = insufficientStockBody([
      { itemCode: 'A', productName: null, variantKey: '', requested: 9, available: 1 },
      { itemCode: 'B', productName: null, variantKey: '', requested: 4, available: 0 },
    ], 'WH-A') as { message: string; problems: Array<{ message: string }> };
    expect(body.message).toBe('2 lines ask for more than WH-A holds.');
    expect(body.problems.map((p) => p.message)).toEqual([
      'Only 1 of A in WH-A; this transfer asks for 9.',
      'No B is left in WH-A; this transfer asks for 4.',
    ]);
  });
});

describe('shortageFromPgError (migration 0353, P0414)', () => {
  test('reads the DETAIL json', () => {
    expect(shortageFromPgError({ code: 'P0414', details: '{"item_code" : "SOFA-01", "variant_key" : "", "available" : 2, "requested" : 5}' }))
      .toEqual({ itemCode: 'SOFA-01', productName: null, variantKey: '', requested: 5, available: 2 });
  });
  test('ignores any other error', () => {
    expect(shortageFromPgError({ code: '23505', details: '{}' })).toBeNull();
    expect(shortageFromPgError(null)).toBeNull();
  });
});
