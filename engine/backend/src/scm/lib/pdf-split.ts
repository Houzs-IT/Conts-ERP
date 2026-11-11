// ----------------------------------------------------------------------------
// pdf-split — one PDF holding several bills, as one PDF per page (HC-0204).
//
// Finance gets a supplier's invoices as ONE PDF (Siti 2026-11-02: our
// attachment is a single PDF containing multiple invoices). The bill pile
// reads one file as one bill, so the PDF is cut into its pages and each page
// joins the pile as its own bill. The pages are copied, not redrawn — each
// piece is the supplier's original page, and it is what the AP invoice
// attaches. Done here, not in the browser, for the reason pdf-attach.ts gives:
// pdf-lib is ~200 KB gzip the frontend bundle does not carry.
// ----------------------------------------------------------------------------

import { PDFDocument } from 'pdf-lib';

/* Conts reads at most 12 bills a pile (PaymentVoucherScan MAX_PILE_BILLS); 24
   pages leaves room for two-page bills merged back, and a PDF longer than that
   is a catalogue, not a stack of bills. (Houzs: 50.) */
export const MAX_SPLIT_PAGES = 24;

/* Worker memory (review of #860): the PDF arrives as base64 JSON, is decoded,
   loaded by pdf-lib, and every page copy can carry the shared fonts and images
   again. pdf-lib holds the parsed file several times over in the 128 MB Worker,
   so the input is capped at 4 MB and the pages together at 3x the input. A
   bigger scan: add its pages as separate files. */
export const MAX_SPLIT_INPUT_BYTES = 4 * 1024 * 1024;
export const MAX_SPLIT_OUTPUT_RATIO = 3;

export type SplitResult =
  | { ok: true; pages: Uint8Array[] }
  | { ok: false; reason: 'unreadable' | 'no_pages' | 'too_many_pages' | 'output_too_big'; pageCount?: number };

export async function splitPdfPages(bytes: Uint8Array): Promise<SplitResult> {
  let src: PDFDocument;
  try {
    src = await PDFDocument.load(bytes);
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  const n = src.getPageCount();
  if (n === 0) return { ok: false, reason: 'no_pages', pageCount: 0 };
  if (n > MAX_SPLIT_PAGES) return { ok: false, reason: 'too_many_pages', pageCount: n };
  const pages: Uint8Array[] = [];
  const budget = bytes.length * MAX_SPLIT_OUTPUT_RATIO;
  let total = 0;
  for (let i = 0; i < n; i += 1) {
    const doc = await PDFDocument.create();
    const [page] = await doc.copyPages(src, [i]);
    doc.addPage(page!);
    const out = await doc.save();
    total += out.length;
    /* Each page re-carrying the whole file's resources: stop before the pile does. */
    if (total > budget) return { ok: false, reason: 'output_too_big', pageCount: n };
    pages.push(out);
  }
  return { ok: true, pages };
}
