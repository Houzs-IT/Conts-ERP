// ----------------------------------------------------------------------------
// unmatched-payments-pdf — one list of Unmatched payments on paper (ported from
// Houzs): landscape A4 on the shared letterhead, under the list's title, the
// dates and the filter it was cut to, the amount totalled in RM.
// ----------------------------------------------------------------------------

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  DOC_TABLE_HEAD_STYLES, DOC_TABLE_STYLES, deliverPdf, drawHeader, ensurePdfCjkFont, fmtDocStamp, type PdfAction,
} from './pdf-common';
import { fmtSenPlain, todayMY } from '../../shared/format';

export type UnmatchedPdfTable = {
  title: string;
  /** The dates and the filter, in words. */
  subtitle: string;
  head: string[];
  body: string[][];
  /** Which column holds the amount, right-aligned and totalled. */
  amountColumn: number;
  totalSen: number;
  fileName: string;
};

export async function generateUnmatchedPdf(t: UnmatchedPdfTable, action: PdfAction = 'preview'): Promise<void> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  await ensurePdfCjkFont(doc, t);
  const y = drawHeader(doc, {
    docTitle: t.title.toUpperCase(),
    rightMeta: [
      { label: 'Printed', value: fmtDocStamp() },
      { label: 'Rows', value: String(t.body.length) },
      { label: 'Total', value: `RM ${fmtSenPlain(t.totalSen)}` },
    ],
  });
  doc.setFontSize(8);
  const wrapped = doc.splitTextToSize(t.subtitle, doc.internal.pageSize.getWidth() - 28) as string[];
  doc.text(wrapped, 14, y + 4);
  const foot = t.head.map((_, i) => (i === t.amountColumn ? fmtSenPlain(t.totalSen) : i === 0 ? `${t.body.length} row(s)` : ''));
  autoTable(doc, {
    startY: y + 6 + wrapped.length * 3.5,
    head: [t.head],
    body: t.body,
    foot: [foot],
    theme: 'plain',
    rowPageBreak: 'avoid',
    styles: { ...DOC_TABLE_STYLES, fontSize: 8 },
    headStyles: DOC_TABLE_HEAD_STYLES,
    footStyles: DOC_TABLE_HEAD_STYLES,
    columnStyles: { [t.amountColumn]: { halign: 'right' } },
  });
  deliverPdf(doc, `${t.fileName}-${todayMY()}.pdf`, action);
}
