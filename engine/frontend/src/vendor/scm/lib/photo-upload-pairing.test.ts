/* A staged photo goes on the line it was staged on, whatever order the server saved the lines in (TC-SO-2611-024). */
import { describe, expect, it } from 'vitest';

import { pairSavedLines } from './photo-upload-failures';

describe('pairSavedLines', () => {
  it('finds a line the server ranked to another position', () => {
    const lines = [{ itemCode: 'CUS-AIRCON_INSTALL' }, { itemCode: 'SOF-1' }];
    const saved = [{ id: 'a', item_code: 'SOF-1' }, { id: 'b', item_code: 'CUS-AIRCON_INSTALL' }];
    expect(pairSavedLines(lines, saved).map((s) => s?.id)).toEqual(['b', 'a']);
  });

  it('gives two lines with one code a saved line each, in order', () => {
    const lines = [{ itemCode: 'X' }, { itemCode: 'X' }];
    const saved = [{ id: '1', item_code: 'X' }, { id: '2', item_code: 'X' }];
    expect(pairSavedLines(lines, saved).map((s) => s?.id)).toEqual(['1', '2']);
  });

  it('answers null rather than guess when the code is not saved', () => {
    expect(pairSavedLines([{ itemCode: 'Y' }], [{ id: '1', item_code: 'X' }])).toEqual([null]);
  });
});
