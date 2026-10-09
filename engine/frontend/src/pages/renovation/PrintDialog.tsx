/* Print a renovation document: pick one of the five formats (and compact rows
   for a dense sheet), then view, print or download. The PDF is drawn by
   lib/renovation/renovation-doc-pdf.ts from the same layout its tests pin. */

import { useState } from 'react';
import { Download, Eye, Printer } from 'lucide-react';
import { Button } from '../../components/Button';
import { ModalOverlay } from '../../components/scm-v2/DocumentRelationshipMapModal';
import type { PdfAction } from '../../vendor/scm/lib/pdf-common';
import { PRINT_FORMAT_LIST, PRINT_FORMATS, type PrintFormat } from '../../lib/renovation/print-formats';
import type { PrintDoc } from '../../lib/renovation/print-model';
import type { Density } from '../../lib/renovation/print-layout';
import { ErrorBanner } from './shared';

export function PrintDialog({ open, onClose, title, docNo, defaultFormat, build }: {
  open: boolean; onClose: () => void; title: string; docNo: string; defaultFormat: PrintFormat;
  build: (format: PrintFormat) => Promise<PrintDoc>;
}) {
  const [format, setFormat] = useState<PrintFormat>(defaultFormat);
  const [density, setDensity] = useState<Density>(defaultFormat === 'DISCOUNT' ? 'compact' : 'normal');
  const [busy, setBusy] = useState<PdfAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: PdfAction) => {
    setBusy(action);
    setError(null);
    try {
      const [doc, { printRenovationDoc }] = await Promise.all([build(format), import('../../lib/renovation/print-renovation')]);
      await printRenovationDoc(doc, { action, density });
      if (action !== 'preview') onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The document could not be drawn.');
    } finally {
      setBusy(null);
    }
  };
  return (
    <ModalOverlay open={open} onClose={onClose} title={`Print ${title}`} icon={<Printer size={16} />}
      footer={(
        <div className="flex w-full flex-wrap justify-end gap-2">
          <Button variant="secondary" icon={<Eye size={15} />} disabled={busy !== null} onClick={() => run('preview')}>{busy === 'preview' ? 'Preparing…' : 'View PDF'}</Button>
          <Button variant="secondary" icon={<Download size={15} />} disabled={busy !== null} onClick={() => run('save')}>{busy === 'save' ? 'Preparing…' : 'Download'}</Button>
          <Button icon={<Printer size={15} />} disabled={busy !== null} onClick={() => run('print')}>{busy === 'print' ? 'Preparing…' : 'Print'}</Button>
        </div>
      )}>
      <div className="space-y-3">
        <div className="text-[12.5px] text-ink-secondary"><span className="font-mono font-semibold text-ink">{docNo}</span> · A4 portrait</div>
        <fieldset className="space-y-1.5">
          <legend className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-ink-muted">Format</legend>
          {PRINT_FORMAT_LIST.map((f) => (
            <label key={f} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 ${format === f ? 'border-primary bg-primary-soft' : 'border-border'}`}>
              <input type="radio" name="reno-print-format" className="mt-1" checked={format === f} onChange={() => setFormat(f)} />
              <span>
                <span className="block text-[13px] font-semibold text-ink">{PRINT_FORMATS[f].label}</span>
                <span className="block text-[12px] text-ink-muted">{PRINT_FORMATS[f].hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <label className="flex items-center gap-2 text-[12.5px] text-ink-secondary">
          <input type="checkbox" checked={density === 'compact'} onChange={(e) => setDensity(e.target.checked ? 'compact' : 'normal')} />
          Compact rows (about twice as many lines a page)
        </label>
        <ErrorBanner error={error} />
      </div>
    </ModalOverlay>
  );
}
