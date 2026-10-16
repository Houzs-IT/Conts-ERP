/* A renovation project's "Documents" roll-up (owner, 16 Oct 2026): every photo and file attached to the project's
   quotations, sales orders, variation orders, POs, DOs (with the driver's proof-of-delivery photo), goods received,
   returns and invoices, grouped by document, read-only. Files are added on each document's own page; the document
   number opens it. GET /api/renovation/:id/document-files (engine/backend/src/routes/renovationDocumentFiles.ts). */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Paperclip } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { FileThumb, DocFilesViewer } from './DocAttachments';
import { DOC_LABEL, docPagePath, type DocFile, type DocType } from './docAttachmentsApi';

interface Group { type: DocType; label: string; id: string; no: string; date: string | null; status: string; files: DocFile[] }
interface Resp { ready: boolean; documents: Group[] }

const ORDER: DocType[] = ['quotation', 'sales_order', 'variation_order', 'purchase_order', 'goods_received', 'delivery_order',
  'delivery_return', 'purchase_return', 'purchase_invoice', 'sales_invoice', 'receipt'];

export function ProjectDocumentFiles({ projectId }: { projectId: number }) {
  const q = useQuery({
    queryKey: ['renovation', 'document-files', projectId],
    queryFn: () => api.get<Resp>(`/api/renovation/${projectId}/document-files`),
    staleTime: 30_000,
  });
  const [filter, setFilter] = useState<DocType | 'all'>('all');
  const [viewing, setViewing] = useState<{ group: Group; index: number } | null>(null);
  const docs = q.data?.documents ?? [];
  const withFiles = useMemo(
    () => docs.filter((d) => d.files.length > 0).sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type)),
    [docs],
  );
  const total = withFiles.reduce((n, d) => n + d.files.length, 0);
  const types = ORDER.filter((t) => withFiles.some((d) => d.type === t));
  const shown = filter === 'all' ? withFiles : withFiles.filter((d) => d.type === filter);
  const empty = docs.length - withFiles.length;
  const base = (g: Group) => `/api/renovation/${projectId}/document-files/${g.type}/${encodeURIComponent(g.id)}`;

  return (
    <section aria-label="Documents" className="rounded-lg border border-border bg-surface p-3 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[14px] font-semibold text-ink">
          <Paperclip size={15} /> Documents
          {total > 0 && <span className="text-[12px] font-normal text-ink-muted">({total} file{total === 1 ? '' : 's'} on {withFiles.length} document{withFiles.length === 1 ? '' : 's'})</span>}
        </h3>
        <span className="text-[11.5px] text-ink-muted">Photos and files from this project's documents. Add them on each document.</span>
      </div>
      {q.isLoading && <p className="mt-3 text-[12.5px] text-ink-muted">Loading files...</p>}
      {q.isError && <p role="alert" className="mt-3 text-[12.5px] text-err">The project's files could not be loaded. Reload the page.</p>}
      {q.data && !q.data.ready && <p className="mt-3 text-[12.5px] text-ink-muted">Attachments are not switched on yet for this system.</p>}
      {q.data?.ready && withFiles.length === 0 && (
        <p className="mt-3 text-[12.5px] text-ink-muted">
          {docs.length === 0 ? 'This project has no documents yet.' : `None of this project's ${docs.length} documents has a photo or file yet.`}
        </p>
      )}
      {types.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Show">
          {(['all', ...types] as Array<DocType | 'all'>).map((t) => (
            <button key={t} type="button" onClick={() => setFilter(t)} aria-pressed={filter === t}
              className={`h-7 rounded-full border px-3 text-[12px] ${filter === t ? 'border-primary bg-primary/10 font-semibold text-primary' : 'border-border text-ink-secondary hover:border-primary'}`}>
              {t === 'all' ? 'All' : DOC_LABEL[t]}
            </button>
          ))}
        </div>
      )}
      <div className="mt-3 space-y-4">
        {shown.map((g) => (
          <div key={`${g.type}:${g.id}`}>
            <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">{g.label}</span>
              <Link to={docPagePath(g.type, g.id)} className="text-[13px] font-semibold text-primary hover:underline">{g.no}</Link>
              <span className="text-[12px] text-ink-muted">{[g.date, g.status && g.status.toLowerCase().replace(/_/g, ' '), `${g.files.length} file${g.files.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</span>
            </div>
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-8">
              {g.files.map((f, i) => (
                <li key={f.id} className="min-w-0">
                  <button type="button" onClick={() => setViewing({ group: g, index: i })} title={f.caption || f.name}
                    className="block w-full overflow-hidden rounded-md border border-border bg-surface-dim text-left hover:border-primary">
                    <FileThumb url={`${base(g)}/${f.id}`} file={f} className="aspect-square w-full" />
                    <span className="block truncate px-1.5 py-1 text-[11px] text-ink">{f.caption || f.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {q.data?.ready && empty > 0 && withFiles.length > 0 && (
        <p className="mt-3 text-[11.5px] text-ink-muted">{empty} other document{empty === 1 ? ' has' : 's have'} no files yet.</p>
      )}
      {viewing && (
        <DocFilesViewer
          files={viewing.group.files}
          index={viewing.index}
          onIndex={(index) => setViewing({ group: viewing.group, index })}
          onClose={() => setViewing(null)}
          baseUrlFor={() => base(viewing.group)}
          docLabel={() => `${viewing.group.label} ${viewing.group.no}`}
        />
      )}
    </section>
  );
}
