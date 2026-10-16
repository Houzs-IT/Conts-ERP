/* Import document files (owner, 16 Oct 2026: "after that I will import those documents into the project"):
   attach a folder of photos and PDFs to existing documents and their lines, many at once. Two ways to say which
   file goes where (both are described on the page and in the PR):
   - a folder laid out as <type>/<document number>/<file>, or <type>/<document number>/<line>/<file>, where <line>
     is the line number on the document (1, 2, ...) or the line's item code / SKU;
   - or a CSV beside the files with the columns file, type, document, line, caption.
   "Check" changes nothing: it finds every document and line and says what would happen. "Import" then sends only
   the files that are not there yet, through each document's own attachment endpoint (and its access rules). The
   same file on the same document or line is recognised by its fingerprint, so running it again adds nothing twice. */

import { useMemo, useRef, useState } from 'react';
import { FolderOpen, FileSpreadsheet, Search, Upload } from 'lucide-react';
import { authedFetch } from '../../vendor/scm/lib/authed-fetch';
import { DOC_LABEL, mimeOf, refusal, sha256Of, uploadDocFile, type DocType } from '../../components/doc-attachments/docAttachmentsApi';

/* Folder and CSV names for each document type; the type's own name works too ("purchase_order", "Purchase order"). */
const ALIASES: Record<DocType, string[]> = {
  quotation: ['QT', 'QUO', 'QUOTE', 'QUOTATION'], sales_order: ['SO'], variation_order: ['VO'], purchase_order: ['PO'],
  delivery_order: ['DO'], goods_received: ['GR', 'GRN'], delivery_return: ['DR'], purchase_return: ['PR'],
  purchase_invoice: ['PI'], sales_invoice: ['SI', 'INV'], receipt: ['RC', 'RECEIPT'], credit_note: ['CN', 'DN'],
  official_receipt: ['OR'], deposit_invoice: ['DI'], payment_voucher: ['PV'], ap_invoice: ['AP', 'APINV'],
};

export function docTypeOf(raw: string): DocType | null {
  const k = raw.trim().toUpperCase().replace(/[\s-]+/g, '_');
  for (const [type, names] of Object.entries(ALIASES) as Array<[DocType, string[]]>) {
    if (k === type.toUpperCase() || names.includes(k) || k === DOC_LABEL[type].toUpperCase().replace(/[\s/]+/g, '_')) return type;
  }
  return null;
}

/** RFC 4180-ish: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

type Status = 'new' | 'attached' | 'removed' | 'no_document' | 'ambiguous' | 'bad_type' | 'no_line' | 'ambiguous_line' | 'no_lines';
interface Plan {
  key: string;
  file: File | null;
  path: string;
  type: DocType | null;
  docNo: string;
  line: string;
  caption: string;
  problem: string | null;
  sha256?: string;
  status?: Status;
  docId?: string;
  lineId?: string | null;
  lineText?: string;
  result?: 'done' | 'same' | 'failed';
  error?: string;
}

const STATUS_TEXT: Record<Status, string> = {
  new: 'Will be attached', attached: 'Already attached (skipped)', removed: 'Was attached and removed (skipped)',
  no_document: 'No such document', ambiguous: 'Number matches two documents', bad_type: 'Unknown document type',
  no_line: 'No such line on the document', ambiguous_line: 'Two lines have that item code; use the line number',
  no_lines: 'This document type has no lines',
};

/* The path inside the chosen folder, without the chosen folder's own name. */
const relPath = (f: File) => {
  const p = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
  return p.includes('/') ? p.split('/').slice(1).join('/') : p;
};

function planFromFolder(files: File[]): Plan[] {
  return files.filter((f) => !/\.csv$/i.test(f.name) && !f.name.startsWith('.')).map((f, i) => {
    const parts = relPath(f).split('/');
    const base: Plan = { key: `f${i}`, file: f, path: relPath(f), type: null, docNo: '', line: '', caption: '', problem: null };
    if (parts.length < 3 || parts.length > 4) {
      return { ...base, problem: 'Put it in <type>/<document number>/ (or <type>/<document number>/<line>/)' };
    }
    const type = docTypeOf(parts[0]);
    return { ...base, type, docNo: parts[1].trim(), line: parts.length === 4 ? parts[2].trim() : '', problem: type ? null : `Unknown document type folder "${parts[0]}"` };
  });
}

function planFromCsv(rows: string[][], files: File[]): Plan[] {
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (names: string[]) => head.findIndex((h) => names.includes(h));
  const ci = { file: col(['file', 'filename', 'file name', 'path']), type: col(['type', 'doc_type', 'document type']), doc: col(['document', 'doc_no', 'document number', 'number', 'doc']), line: col(['line', 'line_no', 'sku', 'item code']), caption: col(['caption', 'note', 'remark']) };
  const byPath = new Map(files.map((f) => [relPath(f).toLowerCase(), f]));
  const byName = new Map<string, File[]>();
  for (const f of files) byName.set(f.name.toLowerCase(), [...(byName.get(f.name.toLowerCase()) ?? []), f]);
  return rows.slice(1).map((r, i) => {
    const get = (k: number) => (k >= 0 ? (r[k] ?? '').trim() : '');
    const path = get(ci.file).replace(/\\/g, '/');
    const named = byName.get(path.toLowerCase()) ?? [];
    const file = byPath.get(path.toLowerCase()) ?? (named.length === 1 ? named[0] : null);
    const type = docTypeOf(get(ci.type));
    const problem = ci.file < 0 || ci.type < 0 || ci.doc < 0 ? 'The CSV needs the columns file, type and document'
      : !file ? (named.length > 1 ? 'Two files have that name; give the folder path' : 'File not in the chosen folder')
        : !type ? `Unknown document type "${get(ci.type)}"` : !get(ci.doc) ? 'No document number' : null;
    return { key: `r${i}`, file, path: path || '(blank)', type, docNo: get(ci.doc), line: get(ci.line), caption: get(ci.caption), problem };
  });
}

export function DocumentFilesImport() {
  const folderInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [plan, setPlan] = useState<Plan[]>([]);
  const [phase, setPhase] = useState<'pick' | 'checking' | 'checked' | 'importing' | 'done'>('pick');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  async function choose(list: FileList | null) {
    const all = Array.from(list ?? []);
    setError(null);
    setFiles(all);
    const csv = all.find((f) => /\.csv$/i.test(f.name));
    if (csv) {
      const rows = parseCsv(await csv.text());
      setPlan(rows.length > 1 ? planFromCsv(rows, all.filter((f) => f !== csv)) : []);
      if (rows.length <= 1) setError(`${csv.name} has no rows under its header.`);
    } else {
      setPlan(planFromFolder(all));
    }
    setPhase('pick');
  }

  async function check() {
    setPhase('checking');
    setError(null);
    try {
      const withFp: Plan[] = [];
      let n = 0;
      for (const p of plan) {
        const bad = p.file ? refusal(p.file) : null;
        withFp.push(p.problem || !p.file ? p : bad ? { ...p, problem: bad } : { ...p, sha256: await sha256Of(p.file) });
        setProgress(++n / plan.length);
      }
      const ask = withFp.filter((p) => !p.problem);
      const out = new Map<string, Plan>();
      for (let i = 0; i < ask.length; i += 500) {
        const chunk = ask.slice(i, i + 500);
        const r = await authedFetch<{ results: Array<{ status: Status; docId?: string; docNo?: string; lineId?: string | null; lineNo?: number; lineLabel?: string }> }>(
          '/doc-attachments/resolve',
          { method: 'POST', body: JSON.stringify({ items: chunk.map((p) => ({ docType: p.type, docNo: p.docNo, line: p.line || undefined, sha256: p.sha256 })) }) },
        );
        chunk.forEach((p, j) => {
          const x = r.results[j];
          out.set(p.key, { ...p, status: x.status, docId: x.docId, lineId: x.lineId, lineText: x.lineNo ? `Line ${x.lineNo}${x.lineLabel ? ` · ${x.lineLabel}` : ''}` : undefined });
        });
      }
      setPlan(withFp.map((p) => out.get(p.key) ?? p));
      setPhase('checked');
    } catch (e) {
      setError((e as Error).message);
      setPhase('pick');
    }
  }

  async function run() {
    setPhase('importing');
    const todo = plan.filter((p) => p.status === 'new' && p.file && p.type && p.docId);
    let done = 0;
    let next = 0;
    const worker = async () => {
      while (next < todo.length) {
        const p = todo[next++];
        try {
          const r = await uploadDocFile(p.type!, p.docId!, p.file!, { source: 'import', sha256: p.sha256, lineId: p.lineId, caption: p.caption || undefined });
          setPlan((all) => all.map((x) => (x.key === p.key ? { ...x, result: r.duplicate ? 'same' : 'done' } : x)));
        } catch (e) {
          setPlan((all) => all.map((x) => (x.key === p.key ? { ...x, result: 'failed', error: (e as Error).message } : x)));
        }
        setProgress(++done / todo.length);
      }
    };
    await Promise.all([worker(), worker()]);
    setPhase('done');
  }

  const counts = useMemo(() => {
    const c = { total: plan.length, problem: 0, new: 0, skip: 0, notFound: 0, done: 0, failed: 0 };
    for (const p of plan) {
      if (p.problem) c.problem++;
      else if (p.status === 'new') c.new++;
      else if (p.status === 'attached' || p.status === 'removed') c.skip++;
      else if (p.status) c.notFound++;
      if (p.result === 'done' || p.result === 'same') c.done++;
      if (p.result === 'failed') c.failed++;
    }
    return c;
  }, [plan]);

  const btn = 'inline-flex h-9 items-center justify-center gap-1.5 rounded-md border px-3 text-[13px] font-semibold disabled:opacity-40';
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-3 sm:p-6">
      <div>
        <h1 className="text-[20px] font-semibold text-ink">Import document files</h1>
        <p className="mt-1 text-[13px] text-ink-secondary">
          Attach a folder of photos, videos and PDFs to documents that already exist (quotations, sales orders, POs, DOs,
          goods received, invoices, and the rest), on the whole document or on one of its lines. Check first: nothing is
          changed until you press Import, and a file that is already attached is never added twice.
        </p>
      </div>

      <section className="rounded-lg border border-border bg-surface p-3 text-[12.5px] text-ink-secondary sm:p-4">
        <h2 className="mb-1 text-[13px] font-semibold text-ink">How to lay out the files</h2>
        <p><b>A.</b> Folders: <code>PO/PO-2610-0012/photo1.jpg</code> puts the photo on that PO; <code>GR/GRN-2610-0003/2/crack.jpg</code> puts it on line 2 of that goods receipt (a line can also be named by its item code, e.g. <code>DO/DO-2610-0001/TILE-600/</code>).</p>
        <p className="mt-1"><b>B.</b> Or a CSV file in the folder with the columns <code>file, type, document, line, caption</code> (line and caption may be blank; file is the name or the path inside the folder).</p>
        <p className="mt-1">Type names: {(Object.keys(ALIASES) as DocType[]).map((t) => `${ALIASES[t][0]} = ${DOC_LABEL[t]}`).join(', ')}.</p>
      </section>

      <div className="flex flex-wrap gap-2">
        <input ref={folderInput} type="file" multiple className="hidden" aria-label="Choose a folder"
          {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} onChange={(e) => { void choose(e.target.files); }} />
        <input ref={filesInput} type="file" multiple className="hidden" aria-label="Choose files" onChange={(e) => { void choose(e.target.files); }} />
        <button type="button" className={`${btn} border-border bg-surface text-ink-secondary hover:border-primary hover:text-primary`} onClick={() => folderInput.current?.click()} disabled={phase === 'checking' || phase === 'importing'}>
          <FolderOpen size={15} /> Choose a folder
        </button>
        <button type="button" className={`${btn} border-border bg-surface text-ink-secondary hover:border-primary hover:text-primary`} onClick={() => filesInput.current?.click()} disabled={phase === 'checking' || phase === 'importing'}>
          <FileSpreadsheet size={15} /> Choose files and a CSV
        </button>
        <button type="button" className={`${btn} border-primary bg-primary text-white`} onClick={() => { void check(); }} disabled={plan.length === 0 || phase === 'checking' || phase === 'importing'}>
          <Search size={15} /> {phase === 'checking' ? `Checking... ${Math.round(progress * 100)}%` : 'Check (changes nothing)'}
        </button>
        <button type="button" className={`${btn} border-primary bg-primary text-white`} onClick={() => { void run(); }} disabled={phase !== 'checked' || counts.new === 0}>
          <Upload size={15} /> {phase === 'importing' ? `Importing... ${Math.round(progress * 100)}%` : `Import ${counts.new} new file${counts.new === 1 ? '' : 's'}`}
        </button>
      </div>

      {error && <p role="alert" className="text-[13px] text-err">{error}</p>}
      {files.length > 0 && (
        <p className="text-[13px] text-ink-secondary">
          {plan.length} file{plan.length === 1 ? '' : 's'} chosen.
          {phase !== 'pick' && ` ${counts.new} to attach, ${counts.skip} already there, ${counts.notFound + counts.problem} with a problem.`}
          {phase === 'done' && ` Done: ${counts.done} attached${counts.failed ? `, ${counts.failed} failed (press Check again, then Import, to retry)` : ''}.`}
        </p>
      )}

      {plan.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <ul className="divide-y divide-border">
            {plan.map((p) => {
              const text = p.problem ?? (p.result === 'done' ? 'Attached' : p.result === 'same' ? 'Already attached' : p.result === 'failed' ? `Failed: ${p.error}` : p.status ? STATUS_TEXT[p.status] : 'Not checked yet');
              const tone = p.problem || p.result === 'failed' || (p.status && !['new', 'attached', 'removed'].includes(p.status)) ? 'text-err' : p.result === 'done' || p.status === 'new' ? 'text-ok' : 'text-ink-muted';
              return (
                <li key={p.key} className="grid gap-0.5 px-3 py-2 text-[12.5px] sm:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,2fr)] sm:gap-3">
                  <span className="min-w-0 truncate text-ink" title={p.path}>{p.path}{p.file ? ` (${mimeOf(p.file) || 'unknown type'})` : ''}</span>
                  <span className="min-w-0 truncate text-ink-secondary">
                    {p.type ? DOC_LABEL[p.type] : '?'} {p.docNo}{p.lineText ? ` · ${p.lineText}` : p.line ? ` · line ${p.line}` : ''}
                  </span>
                  <span className={`min-w-0 ${tone}`}>{text}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
