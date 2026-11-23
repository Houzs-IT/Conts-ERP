// ----------------------------------------------------------------------------
// payment-listing-pdf — the Payment listing on paper (ported from Houzs). What
// the screen shows — the rows left after its filters, in its order — landscape
// A4 on the shared letterhead, the amount totalled in RM; a voucher in another
// currency prints its own amount under the ringgit.
// ----------------------------------------------------------------------------

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  DOC_TABLE_HEAD_STYLES, DOC_TABLE_STYLES, deliverPdf, drawHeader, ensurePdfCjkFont, fmtDocDate, fmtDocStamp, type PdfAction,
} from './pdf-common';
import { fmtMoneySen, fmtSenPlain, todayMY } from '../../shared/format';

/** One printed row, as the screen worked it out. */
export type PaymentListingLine = {
  pvNumber: string;
  voucherDate: string | null;
  payee: string;
  description: string;
  department: string;
  bank: string;
  accountNo: string;
  accountName: string;
  /** What leaves the bank, in ringgit sen. */
  ringgitSen: number;
  /** A voucher not in ringgit: its own currency and amount. */
  currency: string;
  totalSen: number;
  stage: string;
};

export const PAYMENT_LISTING_HEAD = ['PV No.', 'Date', 'Payee', 'Description', 'Department', 'Bank', 'Account no.', 'Account name', 'Amount (RM)', 'Stage'] as const;

/** The table exactly as drawn — pure, so a test reads the cells and the total without a PDF. */
export function paymentListingTable(lines: readonly PaymentListingLine[]): { head: readonly string[]; body: string[][]; totalSen: number } {
  const body = lines.map((l) => [
    l.pvNumber,
    fmtDocDate(l.voucherDate),
    l.payee,
    l.description,
    l.department,
    l.bank,
    l.accountNo,
    l.accountName,
    l.currency.toUpperCase() === 'MYR' ? fmtSenPlain(l.ringgitSen) : `${fmtSenPlain(l.ringgitSen)}\n${fmtMoneySen(l.totalSen, l.currency)}`,
    l.stage,
  ]);
  return { head: PAYMENT_LISTING_HEAD, body, totalSen: lines.reduce((s, l) => s + l.ringgitSen, 0) };
}

export async function generatePaymentListingPdf(lines: readonly PaymentListingLine[], opts: { subtitle: string; action?: PdfAction }): Promise<void> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  await ensurePdfCjkFont(doc, lines);
  const t = paymentListingTable(lines);
  const y = drawHeader(doc, {
    docTitle: 'PAYMENT LISTING',
    rightMeta: [
      { label: 'Printed', value: fmtDocStamp() },
      { label: 'Vouchers', value: String(lines.length) },
      { label: 'Total', value: `RM ${fmtSenPlain(t.totalSen)}` },
    ],
  });
  doc.setFontSize(8);
  const wrapped = doc.splitTextToSize(opts.subtitle, doc.internal.pageSize.getWidth() - 28) as string[];
  doc.text(wrapped, 14, y + 4);
  autoTable(doc, {
    startY: y + 6 + wrapped.length * 3.5,
    head: [[...t.head]],
    body: t.body,
    foot: [['', '', '', '', '', '', '', `${lines.length} voucher(s)`, fmtSenPlain(t.totalSen), '']],
    theme: 'plain',
    rowPageBreak: 'avoid',
    styles: { ...DOC_TABLE_STYLES, fontSize: 8 },
    headStyles: DOC_TABLE_HEAD_STYLES,
    footStyles: DOC_TABLE_HEAD_STYLES,
    columnStyles: {
      0: { cellWidth: 30 },
      1: { cellWidth: 18 },
      2: { cellWidth: 34 },
      4: { cellWidth: 20 },
      5: { cellWidth: 22 },
      6: { cellWidth: 26 },
      7: { cellWidth: 28 },
      8: { cellWidth: 24, halign: 'right' },
      9: { cellWidth: 16 },
    },
  });
  deliverPdf(doc, `payment-listing-${todayMY()}.pdf`, opts.action ?? 'preview');
}
