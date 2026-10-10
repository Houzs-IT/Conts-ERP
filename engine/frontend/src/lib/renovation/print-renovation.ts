/* Draw a renovation document and hand it to the browser (download, print, or a new tab). */

import { deliverPdf, type PdfAction } from '../../vendor/scm/lib/pdf-common';
import type { Density } from './print-layout';
import type { PrintDoc } from './print-model';
import { renderRenovationDoc, renovationPdfFilename } from './renovation-doc-pdf';

export async function printRenovationDoc(d: PrintDoc, opts: { action?: PdfAction; density?: Density } = {}): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  renderRenovationDoc(pdf, d, opts.density ?? 'normal');
  deliverPdf(pdf, renovationPdfFilename(d), opts.action);
}
