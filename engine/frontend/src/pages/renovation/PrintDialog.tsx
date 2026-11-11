/* Print a renovation document (quotation, contract sales order, variation order) through the app's one Print preview
   (components/scm-v2/PrintPreviewModal): the same card, size and View full PDF / Print now / Download PDF as every
   other document (owner, 3 Nov 2026: the print screens differed from one document to the next). The format picker and
   compact rows sit above the card as the preview's options. The PDF is drawn by lib/renovation/renovation-doc-pdf.ts
   from the same layout its tests pin. */

import { useState } from 'react';
import { PrintPreviewModal, type PrintPreviewRow } from '../../components/scm-v2/PrintPreviewModal';
import type { PdfAction } from '../../vendor/scm/lib/pdf-common';
import { PRINT_FORMAT_LIST, PRINT_FORMATS, type PrintFormat } from '../../lib/renovation/print-formats';
import type { PrintDoc, PrintLineInput } from '../../lib/renovation/print-model';
import { PRINT_LAYOUTS, sectionsByLayout, type PrintLayout } from '../../lib/renovation/print-doc';
import type { Density } from '../../lib/renovation/print-layout';
import { isStaleChunkError } from '../../lib/staleBuild';
import { ErrorBanner } from './shared';

const DOC_TITLE: Record<string, string> = { quotation: 'Quotation', 'sales order': 'Sales Order', 'variation order': 'Variation Order' };

export function PrintDialog({ open, onClose, title, docNo, brandName, defaultFormat, build, rows, groupOf }: {
  /** A sales order offers item, area or category: the category of a line, null for none. */
  groupOf?: (l: PrintLineInput) => string | null;
  /** The document's own brand, as its PDF prints it. */
  brandName?: string;
  open: boolean; onClose: () => void; title: string; docNo: string; defaultFormat: PrintFormat;
  build: (format: PrintFormat) => Promise<PrintDoc>;
  /** The card's summary lines (customer, date, total); without them the card names the paper. */
  rows?: PrintPreviewRow[];
}) {
  const [format, setFormat] = useState<PrintFormat>(defaultFormat);
  const [density, setDensity] = useState<Density>(defaultFormat === 'DISCOUNT' ? 'compact' : 'normal');
  const [error, setError] = useState<string | null>(null);
  const [layout, setLayout] = useState<PrintLayout>('area');
  const run = async (action: PdfAction) => {
    setError(null);
    try {
      const [doc, { printRenovationDoc }] = await Promise.all([build(format), import('../../lib/renovation/print-renovation')]);
      await printRenovationDoc(groupOf ? { ...doc, sections: sectionsByLayout(doc.sections, layout, groupOf) } : doc, { action, density });
      if (action !== 'preview') onClose();
    } catch (e) {
      setError(isStaleChunkError(e) ? 'This page is on an older version. Refresh it, then try again.' : e instanceof Error ? e.message : 'The document could not be drawn.');
    }
  };
  return (
    <PrintPreviewModal
      open={open}
      onClose={onClose}
      docTitle={DOC_TITLE[title] ?? title}
      docNo={docNo}
      companyName={brandName}
      rows={[...(rows ?? []), { label: 'Format', value: PRINT_FORMATS[format].label }, { label: 'Paper', value: `A4 portrait${density === 'compact' ? ', compact rows' : ''}` }]}
      options={(
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="reno-print-format" className="text-[12px] font-semibold text-ink-secondary">PDF layout</label>
            <select id="reno-print-format" value={format} onChange={(e) => setFormat(e.target.value as PrintFormat)}
              className="h-8 max-w-[240px] rounded-lg border border-border bg-surface px-2 text-[12.5px] text-ink">
              {PRINT_FORMAT_LIST.map((f) => <option key={f} value={f}>{PRINT_FORMATS[f].label}</option>)}
            </select>
          </div>
          <p className="text-[11.5px] text-ink-muted">{PRINT_FORMATS[format].hint}</p>
          {groupOf && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12px] font-semibold text-ink-secondary">Group lines</span>
              <span role="group" aria-label="Group lines" className="flex gap-1">
                {PRINT_LAYOUTS.map((l) => (
                  <button key={l.key} type="button" aria-pressed={layout === l.key} onClick={() => setLayout(l.key)}
                    className={`h-7 rounded-md border px-2 text-[12px] font-semibold ${layout === l.key ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-surface text-ink-secondary'}`}>{l.label}</button>
                ))}
              </span>
            </div>
          )}
          <label className="flex items-center gap-2 text-[12.5px] text-ink-secondary">
            <input type="checkbox" checked={density === 'compact'} onChange={(e) => setDensity(e.target.checked ? 'compact' : 'normal')} />
            Compact rows (about twice as many lines a page)
          </label>
          <ErrorBanner error={error} />
        </div>
      )}
      onViewPdf={() => run('preview')}
      onPrint={() => run('print')}
      onDownload={() => run('save')}
    />
  );
}
