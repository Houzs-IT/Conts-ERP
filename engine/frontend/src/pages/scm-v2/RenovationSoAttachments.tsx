/* Renovation mode (Conts, 14 Oct 2026; mig 0115): files attached to the whole
   sales order: site photos, floor plans, the signed quotation. Photos show as
   thumbnails (click to view), PDFs as a file you open. They live in the bucket the
   line photos use; each line keeps its own photos on its card as before.
   /api/scm/renovation-so-info/:docNo/attachments. */

import { useRef, useState } from 'react';
import { FileText, Paperclip, Trash2, X } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { authedFetch } from '../../vendor/scm/lib/authed-fetch';
import { useConfirm } from '../../vendor/scm/components/ConfirmDialog';
import { AuthImage } from '../projects/renovation/renovationUi';
import { soInfoErrorText } from '../projects/renovation/customerPropertyApi';

interface Attachment { id: string; name: string; type: string; size: number; at: string; by: string | null }

const base = (docNo: string) => `/renovation-so-info/${encodeURIComponent(docNo)}/attachments`;
const fileUrl = (docNo: string, id: string) => `/api/scm${base(docNo)}/${id}`;

export function RenovationSoAttachments({ docNo, canEdit }: { docNo: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const key = ['reno', 'so-attachments', docNo];
  const q = useQuery({ queryKey: key, queryFn: () => authedFetch<{ attachments: Attachment[] }>(base(docNo)), staleTime: 30_000 });
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Attachment | null>(null);
  const confirm = useConfirm();
  const list = q.data?.attachments ?? [];

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      for (const f of Array.from(files)) {
        const form = new FormData();
        form.append('file', f, f.name);
        await authedFetch(base(docNo), { method: 'POST', body: form });
      }
    } catch (e) {
      setError(soInfoErrorText(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
      void qc.invalidateQueries({ queryKey: key });
    }
  }

  async function open(a: Attachment) {
    if (a.type.startsWith('image/')) { setViewing(a); return; }
    try {
      const url = await api.fetchBlobUrl(fileUrl(docNo, a.id), a.type);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      setError(soInfoErrorText(e));
    }
  }

  async function remove(a: Attachment) {
    if (!(await confirm({ title: `Remove ${a.name}?`, body: 'The file is taken off this order.', confirmLabel: 'Remove', danger: true }))) return;
    try {
      await authedFetch(`${base(docNo)}/${a.id}`, { method: 'DELETE' });
    } catch (e) {
      setError(soInfoErrorText(e));
    }
    void qc.invalidateQueries({ queryKey: key });
  }

  return (
    <div>
      {q.isLoading && <p className="text-[12.5px] text-ink-muted">Loading attachments...</p>}
      {q.isError && <p role="alert" className="text-[12.5px] text-err">The attachments could not be loaded. Reload the page.</p>}
      {!q.isLoading && list.length === 0 && <p className="text-[12.5px] text-ink-muted">No files attached yet.</p>}
      {list.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-6">
          {list.map((a) => (
            <li key={a.id} className="group relative min-w-0">
              <button type="button" onClick={() => { void open(a); }} title={a.name}
                className="block w-full overflow-hidden rounded-md border border-border bg-surface-dim text-left hover:border-primary">
                {a.type.startsWith('image/')
                  ? <AuthImage path={fileUrl(docNo, a.id)} alt={a.name} className="aspect-square w-full" />
                  : <div className="flex aspect-square w-full flex-col items-center justify-center gap-1 p-2 text-ink-secondary"><FileText size={26} /><span className="text-[10.5px]">PDF</span></div>}
                <span className="block truncate px-1.5 py-1 text-[11px] text-ink">{a.name}</span>
              </button>
              {canEdit && (
                <button type="button" aria-label={`Remove ${a.name}`} onClick={() => { void remove(a); }}
                  className="absolute right-1 top-1 rounded-full bg-surface/90 p-1 text-ink-secondary shadow-sm hover:text-err">
                  <Trash2 size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="mt-3">
          <input ref={input} type="file" accept="image/*,application/pdf" multiple className="hidden" aria-label="Attach files"
            onChange={(e) => { void upload(e.target.files); }} />
          <button type="button" disabled={busy} onClick={() => input.current?.click()}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12px] font-semibold text-ink-secondary hover:border-primary hover:text-primary disabled:opacity-50">
            <Paperclip size={14} /> {busy ? 'Uploading...' : 'Attach photos or PDF'}
          </button>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-[12.5px] text-err">{error}</p>}
      {viewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-label={viewing.name}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setViewing(null); }}>
          <div className="relative max-h-full max-w-4xl">
            <button type="button" aria-label="Close" onClick={() => setViewing(null)} className="absolute -right-2 -top-2 rounded-full bg-surface p-1 shadow"><X size={16} /></button>
            <AuthImage path={fileUrl(docNo, viewing.id)} alt={viewing.name} className="max-h-[85vh] w-auto rounded-md object-contain" />
            <p className="mt-2 text-center text-[12px] text-white">{viewing.name}</p>
          </div>
        </div>
      )}
    </div>
  );
}
