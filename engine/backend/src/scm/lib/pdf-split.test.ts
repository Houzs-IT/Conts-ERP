/* HC-0204: a PDF of several invoices, cut into one PDF per page — each piece
   the original page, copied, so the AP invoice attaches what the supplier sent. */
import { PDFDocument, PDFName } from 'pdf-lib';
import { describe, expect, test } from 'vitest';
import { MAX_SPLIT_PAGES, splitPdfPages } from './pdf-split';

const pdfOf = async (sizes: Array<[number, number]>): Promise<Uint8Array> => {
  const doc = await PDFDocument.create();
  for (const s of sizes) doc.addPage(s);
  return doc.save();
};

describe('splitPdfPages', () => {
  test('one one-page PDF per page, in order', async () => {
    const got = await splitPdfPages(await pdfOf([[100, 200], [300, 400], [500, 600]]));
    if (!got.ok) throw new Error(got.reason);
    const sizes = await Promise.all(got.pages.map(async (b) => {
      const d = await PDFDocument.load(b);
      expect(d.getPageCount()).toBe(1);
      const { width, height } = d.getPage(0).getSize();
      return [width, height];
    }));
    expect(sizes).toEqual([[100, 200], [300, 400], [500, 600]]);
  });

  test('not a PDF is unreadable, not a throw', async () => {
    expect(await splitPdfPages(new TextEncoder().encode('not a pdf'))).toEqual({ ok: false, reason: 'unreadable' });
  });

  /* Review of #860: a page that re-carries the whole file's shared resources must not multiply the Worker's memory. */
  test('pages that together pass 3x the input stop with output_too_big', async () => {
    const doc = await PDFDocument.create();
    const big = doc.context.register(doc.context.stream(new Uint8Array(200_000).fill(65)));
    for (let i = 0; i < 5; i += 1) doc.addPage([10, 10]).node.setXObject(PDFName.of('Big'), big);
    const bytes = await doc.save();
    expect(await splitPdfPages(bytes)).toEqual({ ok: false, reason: 'output_too_big', pageCount: 5 });
  });

  test('the split cap is 24 pages (a pile reads 12 bills)', () => {
    expect(MAX_SPLIT_PAGES).toBe(24);
  });

  test('past the pile size it refuses, with the page count', async () => {
    const big = await pdfOf(Array.from({ length: MAX_SPLIT_PAGES + 1 }, () => [10, 10] as [number, number]));
    expect(await splitPdfPages(big)).toEqual({ ok: false, reason: 'too_many_pages', pageCount: MAX_SPLIT_PAGES + 1 });
  });
});
