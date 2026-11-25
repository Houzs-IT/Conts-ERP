import type { ReactNode } from 'react';
import { Button } from '../../components/Button';
import { cx } from '../../lib/design-tokens';
import type { ClaimFile } from '../../lib/claims';

export const FORM_GRID = 'grid grid-cols-1 sm:grid-cols-3 gap-3 items-start';
export const SPAN_ALL = 'col-span-full';
export const LINE_GRID = 'grid grid-cols-1 sm:grid-cols-2 gap-3 items-start';

export function ClaimSection({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="ds-fs">
      <div className="ds-fs-h max-sm:flex-col max-sm:gap-0.5!"><b>{title}</b>{hint && <span>{hint}</span>}</div>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

export function GridRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx(FORM_GRID, className)}>{children}</div>;
}

export const FORM_FOOTER = 'flex justify-end gap-2 max-sm:flex-col-reverse max-sm:[&>*]:w-full max-sm:pb-[calc(5rem+env(safe-area-inset-bottom))]';

export function RowHelp({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx('m-0 text-meta text-muted-ink', SPAN_ALL, className)}>{children}</p>;
}

export function ReadOnlyValue({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-[7px] min-w-0">
      <span style={{ fontSize: 'var(--text-small)', fontWeight: 600, color: 'var(--color-text-secondary)' }}>{label}</span>
      <div className="h-[var(--control-height)] min-h-10 flex items-center px-3 rounded-control border border-solid border-line-soft bg-muted text-copy text-muted-ink min-w-0">
        <span className="truncate">{value}</span>
      </div>
    </div>
  );
}

export function KeptPapers({ files, hrefOf, onRemove, label = 'Papers on the request' }: { files: ClaimFile[]; hrefOf: (fileId: string) => string; onRemove: (fileId: string) => void; label?: string }) {
  if (files.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-meta font-semibold text-ink">{label}</span>
      {files.map(file => (
        <div key={file.id} className="flex items-center justify-between gap-2 min-h-10 px-3 rounded-control border border-solid border-line-soft">
          <a href={hrefOf(file.id)} target="_blank" rel="noreferrer" className="min-w-0 truncate text-copy text-primary font-medium">{file.fileName}</a>
          <Button size="sm" variant="tertiary" aria-label={`Remove ${file.fileName}`} onClick={() => onRemove(file.id)}>Remove</Button>
        </div>
      ))}
    </div>
  );
}
