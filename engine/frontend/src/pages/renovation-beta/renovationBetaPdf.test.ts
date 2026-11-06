import { describe, expect, it } from 'vitest';
import { sheetLayout } from './renovationBetaPdf';

const A4 = { w: 595.28, h: 841.89 };

describe('sheetLayout', () => {
  it('keeps a full-size page when no paper is named (the 2D set download)', () => {
    const s = sheetLayout(2400, 1700, true);
    expect([s.pageW, s.pageH]).toEqual([2400, 1700 + 180]);
    expect([s.imgX, s.imgY, s.imgW, s.imgH]).toEqual([0, 0, 2400, 1700]);
  });

  it('fits a wide drawing on landscape A4, so a viewer does not shrink the PO in front of it', () => {
    const s = sheetLayout(2400, 1700, true, A4);
    expect([s.pageW, s.pageH]).toEqual([A4.h, A4.w]);
    expect(s.imgW).toBeLessThanOrEqual(s.pageW);
    expect(s.imgY + s.imgH).toBeLessThanOrEqual(s.pageH - s.band + 0.01);
  });

  it('fits a tall drawing on portrait A4, centred', () => {
    const s = sheetLayout(1000, 3000, false, A4);
    expect([s.pageW, s.pageH]).toEqual([A4.w, A4.h]);
    expect(s.imgH).toBeCloseTo(A4.h);
    expect(s.imgX).toBeCloseTo((A4.w - s.imgW) / 2);
  });
});

describe('a sheet on a document in millimetres', () => {
  it('sets an A4 page, not one the same number of millimetres as points', async () => {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const s = sheetLayout(2400, 1700, true, A4);
    const u = 1 / doc.internal.scaleFactor;
    doc.addPage([s.pageW * u, s.pageH * u], 'landscape');
    expect(doc.internal.pageSize.getWidth()).toBeCloseTo(297, 0);
    expect(doc.internal.pageSize.getHeight()).toBeCloseTo(210, 0);
  });
});
