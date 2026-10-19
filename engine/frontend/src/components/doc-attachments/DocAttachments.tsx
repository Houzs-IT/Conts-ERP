/* Photos and documents on a document and on each of its lines (owner, 16 Oct 2026): the one panel every document
   of the transaction flow shows (quotation, sales order, variation order, PO, DO, GR, returns, invoices, notes,
   receipts, vouchers). Many files at once: pick several, drop several, or take photos with the phone camera.
   Thumbnails open full screen with the caption, who added it and when, and Remove. Shown here but kept elsewhere,
   and so read-only: a delivery's proof-of-delivery photo, a voucher's supplier bill, and a line's files from the
   line upstream (a PO line shows its SO line's). <LineFilesButton> opens the same panel for one line. */

import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { Camera, FileText, Paperclip, Play, Trash2, Upload, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { MediaLightbox } from '../MediaLightbox';
import { useConfirm } from '../../vendor/scm/components/ConfirmDialog';
import {
  ACCEPT, MAX_FILE_MB, MAX_VIDEO_MB, docFilesKey, filesBaseUrl, formatSize, formatWhen, lineLabel, listDocFiles, refusal,
  removeDocFile, setCaption, uploadDocFile, type DocFile, type DocType,
} from './docAttachmentsApi';

/** A thumbnail fetched with the session (the files are not public). */
export function FileThumb({ url, file, className = '' }: { url: string; file: DocFile; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (file.kind !== 'image') return;
    let live = true;
    let made: string | null = null;
    api.fetchBlobUrl(url, file.mime).then((u) => { made = u; if (live) setSrc(u); else URL.revokeObjectURL(u); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [url, file.kind, file.mime]);
  if (file.kind === 'image') {
    if (failed) return <div className={`flex items-center justify-center bg-surface-dim text-[11px] text-ink-secondary ${className}`}>Photo unavailable</div>;
    if (!src) return <div className={`animate-pulse bg-surface-dim ${className}`} />;
    return <img src={src} alt={file.caption || file.name} className={`object-cover ${className}`} draggable={false} />;
  }
  return (
    <div className={`flex flex-col items-center justify-center gap-1 bg-surface-dim text-ink-secondary ${className}`}>
      {file.kind === 'video' ? <Play size={26} /> : <FileText size={26} />}
      <span className="text-[10.5px] font-semibold uppercase">{file.kind === 'video' ? 'Video' : file.kind === 'pdf' ? 'PDF' : 'File'}</span>
    </div>
  );
}

/** Full-screen viewer over a list of files; with `edit`, the caption can be changed and a file removed. */
export function DocFilesViewer({ files, index, onIndex, onClose, baseUrlFor, edit, docLabel }: {
  files: DocFile[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  baseUrlFor: (f: DocFile) => string;
  edit?: { save: (f: DocFile, caption: string) => Promise<void>; remove: (f: DocFile) => Promise<void> };
  docLabel?: (f: DocFile) => string | undefined;
}) {
  const f = files.at(index);
  const [draft, setDraft] = useState(f?.caption ?? '');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setDraft(files.at(index)?.caption ?? ''); }, [files, index]);
  if (!f) return null;
  /* MediaLightbox streams `${baseUrl}/${r2_key}`; here the last segment is the file id. */
  const items = files.map((x) => ({ r2_key: x.id, content_type: x.mime, caption: x.caption || x.name }));
  const canEdit = !!edit && !f.readOnly;
  return (
    <MediaLightbox
      items={items}
      index={index}
      onChange={onIndex}
      onClose={onClose}
      baseUrl={baseUrlFor(f)}
      badge={docLabel?.(f)}
      footer={() => (
        <div className="bg-gradient-to-t from-black/90 to-black/40 px-4 pb-4 pt-3 text-white sm:px-6">
          <div className="mx-auto flex max-w-3xl flex-col gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-[12px] text-white/75">
              <span className="min-w-0 truncate font-semibold text-white">{f.name}</span>
              <span>
                {[f.from ? `From ${f.from}` : null, f.by ? `Added by ${f.by}` : f.source === 'pod' ? 'Driver' : null, formatWhen(f.at), formatSize(f.size)].filter(Boolean).join(' · ')}
              </span>
            </div>
            {canEdit ? (
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  value={draft}
                  maxLength={500}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Add a caption, e.g. Kitchen cabinet delivered, corner scratched"
                  aria-label="Caption"
                  className="h-9 min-w-0 flex-1 rounded-md border border-white/25 bg-white/10 px-3 text-[13px] text-white placeholder:text-white/50 focus:border-white/60 focus:outline-none"
                />
                <div className="flex gap-2">
                  <button type="button" disabled={saving || draft.trim() === f.caption.trim()}
                    onClick={() => { setSaving(true); void edit.save(f, draft.trim()).finally(() => setSaving(false)); }}
                    className="h-9 flex-1 rounded-md bg-white px-4 text-[13px] font-semibold text-black disabled:opacity-40 sm:flex-none">
                    {saving ? 'Saving...' : 'Save caption'}
                  </button>
                  <button type="button" onClick={() => { void edit.remove(f); }}
                    className="inline-flex h-9 items-center gap-1.5 rounded-md border border-white/30 px-3 text-[13px] font-semibold text-white hover:bg-white/10">
                    <Trash2 size={14} /> Remove
                  </button>
                </div>
              </div>
            ) : (
              f.caption && <p className="text-[13px] text-white">{f.caption}</p>
            )}
          </div>
        </div>
      )}
    />
  );
}

interface Pending { key: string; name: string; progress: number; error: string | null }

export function DocAttachments({ docType, docId, lineId, canEdit = true, title, hint, bare = false }: {
  docType: DocType;
  /** The document's id (a sales order's doc_no). Nothing renders until it is known. */
  docId: string | null | undefined;
  /** One line of the document: its files instead of the whole document's. */
  lineId?: string | null;
  canEdit?: boolean;
  title?: string;
  /** One line under the title, e.g. what the photos are for on this document. */
  hint?: string;
  /** No card border (inside a dialog). */
  bare?: boolean;
}) {
  const qc = useQueryClient();
  const id = docId ?? '';
  const key = docFilesKey(docType, id);
  const q = useQuery({ queryKey: key, queryFn: () => listDocFiles(docType, id), enabled: !!docId, staleTime: 30_000 });
  const pick = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);
  const confirm = useConfirm();
  const line = lineId ? q.data?.lines?.find((l) => l.id === lineId) : undefined;
  const files = (lineId ? line?.files : q.data?.files) ?? [];
  const lineFiles = lineId ? [] : (q.data?.lines ?? []).filter((l) => l.files.length > 0);
  const lineFileCount = lineFiles.reduce((n, l) => n + l.files.length, 0);
  const heading = title ?? (lineId ? 'Line photos & files' : 'Photos & documents');
  const ready = q.data?.ready !== false;
  const editable = canEdit && ready;
  const busy = pending.some((p) => p.progress < 1 && !p.error);

  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: key }), [qc, key]);

  async function add(list: FileList | File[] | null) {
    const all = Array.from(list ?? []);
    if (all.length === 0) return;
    const bad = all.map(refusal).filter((x): x is string => !!x);
    const good = all.filter((f) => !refusal(f));
    setNotes(bad);
    const batch = good.map((f, i) => ({ key: `${Date.now()}-${i}-${f.name}`, name: f.name, progress: 0, error: null as string | null }));
    setPending((p) => [...p.filter((x) => !x.error && x.progress < 1), ...batch]);
    /* Two at a time: quick on wifi, and a phone on a weak line does not choke. */
    let next = 0;
    const dupes: string[] = [];
    const worker = async () => {
      while (next < good.length) {
        const i = next++;
        const f = good[i];
        const k = batch[i].key;
        try {
          const r = await uploadDocFile(docType, id, f, {
            lineId,
            onProgress: (x) => setPending((p) => p.map((e) => (e.key === k ? { ...e, progress: Math.min(0.99, x) } : e))),
          });
          if (r.duplicate) dupes.push(`${f.name} is already attached.`);
          setPending((p) => p.filter((e) => e.key !== k));
        } catch (e) {
          setPending((p) => p.map((x) => (x.key === k ? { ...x, error: (e as Error).message } : x)));
        }
        void refresh();
      }
    };
    await Promise.all([worker(), worker()]);
    if (dupes.length) setNotes((n) => [...n, ...dupes]);
    if (pick.current) pick.current.value = '';
    if (camera.current) camera.current.value = '';
  }

  async function remove(f: DocFile) {
    const ok = await confirm({
      title: `Remove ${f.caption || f.name}?`,
      body: 'It is taken off this document. The record of who added and removed it is kept.',
      confirmLabel: 'Remove', danger: true,
    });
    if (!ok) return;
    try {
      await removeDocFile(docType, id, f.id);
      setViewing(null);
    } catch (e) {
      setNotes([(e as Error).message]);
    }
    void refresh();
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (editable) void add(e.dataTransfer.files);
  }

  if (!docId) return null;
  const photos = files.filter((f) => f.kind === 'image').length;

  return (
    <section
      aria-label={heading}
      className={bare
        ? `rounded-md ${dragging ? 'ring-2 ring-primary/30' : ''}`
        : `rounded-lg border bg-surface p-3 sm:p-4 ${dragging ? 'border-primary ring-2 ring-primary/30' : 'border-border'}`}
      onDragOver={(e) => { if (editable) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={onDrop}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-[14px] font-semibold text-ink">
            <Paperclip size={15} /> {heading}
            {files.length > 0 && <span className="text-[12px] font-normal text-ink-muted">({files.length}{photos && photos !== files.length ? `, ${photos} photo${photos === 1 ? '' : 's'}` : ''})</span>}
          </h3>
          {hint && <p className="mt-0.5 text-[12px] text-ink-muted">{hint}</p>}
        </div>
        {editable && (
          <div className="flex w-full gap-2 sm:w-auto">
            <input ref={camera} type="file" accept="image/*" capture="environment" multiple className="hidden" aria-label="Take photos"
              onChange={(e) => { void add(e.target.files); }} />
            <input ref={pick} type="file" accept={ACCEPT} multiple className="hidden" aria-label="Add photos or files"
              onChange={(e) => { void add(e.target.files); }} />
            <button type="button" onClick={() => camera.current?.click()}
              className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-ink-secondary hover:border-primary hover:text-primary sm:hidden">
              <Camera size={15} /> Take photo
            </button>
            <button type="button" onClick={() => pick.current?.click()}
              className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] font-semibold text-ink-secondary hover:border-primary hover:text-primary sm:flex-none">
              <Upload size={15} /> Add files
            </button>
          </div>
        )}
      </div>

      <div className="mt-3">
        {q.isLoading && <p className="text-[12.5px] text-ink-muted">Loading files...</p>}
        {q.isError && <p role="alert" className="text-[12.5px] text-err">The files could not be loaded. Reload the page.</p>}
        {!ready && <p className="text-[12.5px] text-ink-muted">Attachments are not switched on yet for this system.</p>}
        {ready && !q.isLoading && files.length === 0 && pending.length === 0 && (
          editable ? (
            <button type="button" onClick={() => pick.current?.click()}
              className="flex w-full flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border px-3 py-6 text-center text-[12.5px] text-ink-muted hover:border-primary hover:text-primary">
              <Upload size={18} />
              <span>No files yet. Drop photos, videos or PDFs here, or tap to choose several.</span>
              <span className="text-[11px]">Up to {MAX_FILE_MB} MB a photo or PDF, {MAX_VIDEO_MB} MB a video.</span>
            </button>
          ) : <p className="text-[12.5px] text-ink-muted">No files attached.</p>
        )}
        {(files.length > 0 || pending.length > 0) && (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {files.map((f, i) => (
              <li key={f.id} className="group relative min-w-0">
                <button type="button" onClick={() => setViewing(i)} title={f.caption || f.name}
                  className="block w-full overflow-hidden rounded-md border border-border bg-surface-dim text-left hover:border-primary">
                  <FileThumb url={`${filesBaseUrl(docType, id)}/${f.id}`} file={f} className="aspect-square w-full" />
                  <span className="block truncate px-1.5 pt-1 text-[11px] font-medium text-ink">{f.caption || f.name}</span>
                  <span className="block truncate px-1.5 pb-1 text-[10px] text-ink-muted">
                    {f.source === 'pod' ? 'Proof of delivery' : f.from ? `From ${f.from}` : [f.by, formatWhen(f.at).split(',')[0]].filter(Boolean).join(' · ')}
                  </span>
                </button>
                {editable && !f.readOnly && (
                  <button type="button" aria-label={`Remove ${f.name}`} onClick={() => { void remove(f); }}
                    className="absolute right-1 top-1 rounded-full bg-surface/90 p-1.5 text-ink-secondary shadow-sm hover:text-err">
                    <Trash2 size={13} />
                  </button>
                )}
              </li>
            ))}
            {pending.map((p) => (
              <li key={p.key} className="min-w-0">
                <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-surface-dim p-2 text-center">
                  {p.error ? (
                    <span className="text-[11px] text-err">{p.error}</span>
                  ) : (
                    <>
                      <span className="text-[11px] text-ink-secondary">Uploading</span>
                      <span className="h-1.5 w-4/5 overflow-hidden rounded-full bg-border">
                        <span className="block h-full bg-primary transition-[width]" style={{ width: `${Math.round(p.progress * 100)}%` }} />
                      </span>
                    </>
                  )}
                </div>
                <span className="block truncate px-1.5 py-1 text-[11px] text-ink">{p.name}</span>
              </li>
            ))}
          </ul>
        )}
        {lineFileCount > 0 && (
          <p className="mt-2 text-[12px] text-ink-secondary">
            Lines: {lineFileCount} file{lineFileCount === 1 ? '' : 's'} on {lineFiles.length} line{lineFiles.length === 1 ? '' : 's'} ({lineFiles.map((l) => `line ${l.lineNo}`).join(', ')}). Open them with the paperclip on each line.
          </p>
        )}
        {editable && files.length > 0 && (
          <p className="mt-2 hidden text-[11px] text-ink-muted sm:block">{busy ? 'Uploading...' : 'Drop more files anywhere on this box to add them.'}</p>
        )}
        {notes.length > 0 && (
          <ul role="alert" className="mt-2 space-y-0.5 text-[12px] text-err">
            {notes.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        )}
      </div>

      {viewing != null && files[viewing] && (
        <DocFilesViewer
          files={files}
          index={viewing}
          onIndex={setViewing}
          onClose={() => setViewing(null)}
          baseUrlFor={() => filesBaseUrl(docType, id)}
          edit={editable ? {
            save: async (f, caption) => {
              try { await setCaption(docType, id, f.id, caption); } catch (e) { setNotes([(e as Error).message]); }
              await refresh();
            },
            remove,
          } : undefined}
        />
      )}
    </section>
  );
}

/** The paperclip on a document line: how many files the line has, and the line's panel in a dialog
    (a sheet from the bottom on a phone). Every button on a page reads the one list the document panel loads. */
export function LineFilesButton({ docType, docId, lineId, canEdit = true, label }: {
  docType: DocType;
  docId: string | null | undefined;
  lineId: string | null | undefined;
  canEdit?: boolean;
  /** Overrides "Line 2 · SKU description" in the dialog title. */
  label?: string;
}) {
  const id = docId ?? '';
  const q = useQuery({ queryKey: docFilesKey(docType, id), queryFn: () => listDocFiles(docType, id), enabled: !!docId, staleTime: 30_000 });
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!docId || !lineId || q.data?.ready === false) return null;
  const line = q.data?.lines?.find((l) => l.id === lineId);
  const n = line?.files.length ?? 0;
  const title = label ?? (line ? lineLabel(line) : 'Line');
  return (
    <>
      <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        aria-label={`Photos and files for ${title}${n ? ` (${n})` : ''}`} title="Photos and files for this line"
        className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-md border px-1.5 text-[11.5px] font-semibold ${n ? 'border-primary/40 bg-primary/5 text-primary' : 'border-border text-ink-muted hover:border-primary hover:text-primary'}`}>
        <Paperclip size={13} />{n > 0 && <span>{n}</span>}
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="max-h-[90vh] w-full overflow-y-auto rounded-t-xl bg-surface p-4 shadow-xl sm:max-w-3xl sm:rounded-xl">
            <div className="mb-2 flex items-start justify-between gap-3">
              <p className="min-w-0 text-[13px] font-semibold text-ink">{title}</p>
              <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="rounded-full p-1 text-ink-secondary hover:bg-surface-dim"><X size={18} /></button>
            </div>
            <DocAttachments docType={docType} docId={docId} lineId={lineId} canEdit={canEdit} bare
              hint="Photos, videos or PDFs for this line only. Files on the line it came from show here too." />
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
