// ----------------------------------------------------------------------------
// ApInvoiceForm — the one form behind New, Edit and Copy of an AP invoice
// (owner 2026-09-06, round 3: 都可以 — Insert adds a line and lands on it,
// amounts read 1,800.00, a bill can be copied, and everything can be edited).
//
// It knows nothing about routes or modals: it takes initial values, hands
// back the payload the routes want plus the scanned pages waiting to attach,
// and the page decides whether that is a POST, a PATCH, or a re-post. The
// scan (the voucher's own OCR) is offered on New and Copy — an edit of a
// bill that exists keeps the bill's own paper.
// ----------------------------------------------------------------------------

import { useEffect, useRef, useState } from 'react';
import { type Department } from '../../conts/department';
import { nextLineSub, SubDepartmentSelect } from '../../conts/SubDepartmentSelect';
import { ProjectPicker, UnitPicker } from '../../conts/Pickers';
import { Plus, X } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { AddLineButton } from '../../vendor/scm/components/AddLineButton';
import type { Account } from '../../vendor/scm/lib/accounting-queries';
import {
  useExtractBills, fileToBase64, PV_FILE_ACCEPT, type BillExtraction, type VendorMemory, type PvFilePayload,
} from '../../vendor/scm/lib/payment-voucher-queries';
import { AccountSelect } from '../../vendor/scm/components/AccountSelect';
import { ResizableTh, useColumnWidths } from '../../vendor/scm/components/ResizableColumns';
import { useSaveHotkey, SAVE_HOTKEY_HINT } from '../../vendor/scm/lib/use-save-hotkey';
import { upperFill } from '../../vendor/scm/lib/ocr-fill';
import { SearchCombo } from '../../vendor/scm/components/SearchCombo';
import { DateField } from '../../vendor/scm/components/DateField';
import { MoneyInput } from '../../vendor/scm/components/MoneyInput';
import { sortByText } from '../../vendor/scm/lib/sort-options';
import { fmtSen } from '../../vendor/shared/format';
import styles from './SalesOrderDetail.module.css';

/* Conts: each line's department (finance phase 1, spec 3.5), required before saving. */
/* Conts: and the project a cost belongs to (a renovation subcontractor's bill), blank for none — the renovation
   completion % reads booked cost by project. */
/* Conts (chew, 15 Nov 2026): the unit, and the payment request line a bill line came from (kept through every edit, so
   the request follows its bill line by line); a bill may be a quotation booked before its formal invoice. */
export type ApFormLine = { rid: number; description: string; debitAccountCode: string; amountSen: number; department: Department | ''; projectId?: number | null; subDepartmentId?: string | null; unitId?: string | null; sourceRequestLineId?: string | null };
export type ApFormValues = { supplierId: string; supplierRef: string; invoiceDate: string; dueDate: string; description: string; lines: ApFormLine[]; provisional?: boolean };
export type ApFormMode = 'new' | 'edit' | 'copy';
/** What the routes take — POST / for new and copy, PATCH /:id for edit. */
export type ApFormSubmit = {
  supplierId: string; supplierInvoiceRef?: string; invoiceDate: string; dueDate: string | null; notes?: string; provisional: boolean;
  lines: Array<{ description?: string; debitAccountCode: string; amountSen: number; department?: Department; projectId?: number | null; unitId?: string | null; sourceRequestLineId?: string | null }>;
};

const myt = (): string => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
export const emptyLine = (rid: number, department: Department | '' = '', subDepartmentId: string | null = null): ApFormLine => ({ rid, description: '', debitAccountCode: '', amountSen: 0, department, subDepartmentId });
export const emptyApForm = (): ApFormValues => ({ supplierId: '', supplierRef: '', invoiceDate: myt(), dueDate: '', description: '', lines: [emptyLine(1)] });

export const toSubmit = (v: ApFormValues): ApFormSubmit => ({
  supplierId: v.supplierId,
  ...(v.supplierRef.trim() ? { supplierInvoiceRef: v.supplierRef.trim() } : {}),
  invoiceDate: v.invoiceDate,
  dueDate: v.dueDate || null,
  ...(v.description.trim() ? { notes: v.description.trim() } : {}),
  provisional: v.provisional === true,
  lines: v.lines
    .filter((l) => l.debitAccountCode && l.amountSen > 0)
    .map((l) => ({
      ...(l.description.trim() ? { description: l.description.trim() } : {}),
      debitAccountCode: l.debitAccountCode, amountSen: l.amountSen, ...(l.department ? { department: l.department } : {}),
      ...(l.subDepartmentId ? { subDepartmentId: l.subDepartmentId } : {}),
      projectId: l.projectId ?? null,
      unitId: l.unitId ?? null,
      ...(l.sourceRequestLineId ? { sourceRequestLineId: l.sourceRequestLineId } : {}),
    })),
});

/** The project every line shares, for the bill's own Project box: null when they differ or name none. */
export const sharedProject = (lines: readonly ApFormLine[]): number | null => {
  const ids = [...new Set(lines.map((l) => l.projectId ?? null))];
  return ids.length === 1 ? ids[0] ?? null : null;
};

/* The reader's answer as form values — the supplier from the server's match,
   the bill's number and dates, its lines under the REMEMBERED account only
   (never a model guess); text the reader fills goes upper case (owner
   2026-09-08). One home: the form's own Scan bill and the pile page's
   hand-off (ApInvoices.tsx) both fill through here. */
export const formFromExtraction = (ex: BillExtraction, match: { id: string } | null, memory: VendorMemory | null): Partial<ApFormValues> => {
  const account = memory?.debitAccountCode ?? '';
  const drafts: ApFormLine[] = ex.lines
    .filter((l): l is { description: string | null; amountSen: number } => l.amountSen != null && l.amountSen > 0)
    .map((l, i) => ({ rid: i + 1, description: upperFill(l.description) ?? '', debitAccountCode: account, amountSen: l.amountSen, department: '' as const }));
  /* A bill with no readable lines still carries its total — one line. */
  if (drafts.length === 0 && ex.totalSen != null && ex.totalSen > 0) {
    drafts.push({ rid: 1, description: upperFill(ex.invoiceNumber ? `Bill ${ex.invoiceNumber}` : 'As per bill') ?? '', debitAccountCode: account, amountSen: ex.totalSen, department: '' });
  }
  return {
    ...(match ? { supplierId: match.id } : {}),
    ...(ex.invoiceNumber ? { supplierRef: upperFill(ex.invoiceNumber) ?? '' } : {}),
    ...(ex.invoiceDate ? { invoiceDate: ex.invoiceDate } : {}),
    ...(ex.dueDate ? { dueDate: ex.dueDate } : {}),
    ...(drafts.length > 0 ? { lines: drafts } : {}),
  };
};

/* What the form says after a read — the same sentences whether the bill was
   picked here or handed over from the pile. */
export const scanNoteFor = (bill: { extraction: BillExtraction; supplierMatch: { name: string } | null; memory: VendorMemory | null }): string => [
  'Read — check every figure before saving.',
  bill.supplierMatch ? `Looks like supplier ${bill.supplierMatch.name}.` : 'No supplier matched the printed name — pick it yourself.',
  bill.memory?.debitAccountCode
    ? `Account ${bill.memory.debitAccountCode} filled from your last ${bill.memory.payeeName ?? 'same-vendor'} bill — check it.`
    : null,
  bill.extraction.totalSen == null ? 'The TOTAL was not readable — enter it yourself.' : null,
  bill.extraction.currency !== 'MYR' ? `The bill reads as ${bill.extraction.currency}; AP invoices are MYR — a foreign bill goes through a purchase invoice.` : null,
].filter(Boolean).join(' ');

const soft: React.CSSProperties = { fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' };
const th: React.CSSProperties = {
  padding: '6px 8px', textAlign: 'left', fontSize: 'var(--fs-11)', fontWeight: 600, letterSpacing: '0.04em',
  textTransform: 'uppercase', color: 'var(--fg-muted)', borderBottom: '1px solid var(--border-weak, #e3e1da)', whiteSpace: 'nowrap',
};
const td: React.CSSProperties = { padding: '6px 8px', verticalAlign: 'middle' };
const right: React.CSSProperties = { textAlign: 'right', fontFamily: 'var(--font-mono)' };
const iconBtn: React.CSSProperties = { border: 'none', background: 'none', cursor: 'pointer', color: 'var(--fg-muted)', padding: 2 };
/* The line table's columns, in px; the person drags them wider or narrower (chew, 25 Nov 2026: description too small). */
const LINE_COLS = { account: 190, description: 190, amount: 100, department: 115, project: 110, unit: 95, actions: 50 }; // 850: fits the New AP invoice window

export const ApInvoiceForm = ({
  mode, initial, suppliers, suppliersLoading = false, lineAccounts, posted = false, paidSen = 0, saving, onSubmit, onCancel,
  initialFiles, initialNote,
}: {
  mode: ApFormMode;
  initial: ApFormValues;
  suppliers: Array<{ id: string; code: string; name: string }>;
  suppliersLoading?: boolean;
  lineAccounts: Account[];
  /** A bill handed over from the pile page: its read pages, waiting to attach
      on save, and the reader's sentence about it. */
  initialFiles?: PvFilePayload[];
  initialNote?: string | null;
  /** Editing a bill already on the books: saving re-posts, and money paid
      caps the total and pins the supplier — the same rules the route holds. */
  posted?: boolean;
  paidSen?: number;
  saving: boolean;
  onSubmit: (values: ApFormSubmit, pendingFiles: PvFilePayload[]) => void | Promise<void>;
  onCancel: () => void;
}) => {
  const [v, setV] = useState<ApFormValues>(initial);
  const set = (patch: Partial<ApFormValues>) => setV((prev) => ({ ...prev, ...patch }));
  const patchLine = (rid: number, patch: Partial<ApFormLine>) =>
    setV((prev) => ({ ...prev, lines: prev.lines.map((l) => (l.rid === rid ? { ...l, ...patch } : l)) }));
  const nextRid = (lines: ApFormLine[]) => Math.max(0, ...lines.map((x) => x.rid)) + 1;
  /* The bill's own project (chew, 18 Nov 2026: set it once and every line takes it): choosing it fills every line and
     each line added after; a line may still name another. */
  const [billProject, setBillProject] = useState<number | null>(() => sharedProject(initial.lines));
  const chooseBillProject = (id: number | null) => {
    setBillProject(id);
    setV((prev) => ({ ...prev, lines: prev.lines.map((l) => ({ ...l, projectId: id })) }));
  };

  /* Insert adds a line and LANDS on it (owner: 按 Ins 直接加然后直接跳到那一行);
     Enter on an amount hops to the next line's account, adding one when
     there is none. The landing happens after React has drawn the row. */
  const tableRef = useRef<HTMLTableElement>(null);
  const [landOn, setLandOn] = useState<number | null>(null);
  useEffect(() => {
    if (landOn == null) return;
    const el = tableRef.current?.querySelector<HTMLInputElement>(`tr[data-line="${landOn}"] input[role="combobox"]`);
    el?.focus();
    setLandOn(null);
  }, [landOn, v.lines]);
  /* A line goes at the end, or right below `afterRid` (chew, 25 Nov 2026: add a line between lines); it takes the
     department of the line above it. */
  const addLine = (land: boolean, afterRid?: number) => {
    setV((prev) => {
      const rid = nextRid(prev.lines);
      if (land) setLandOn(rid);
      const at = afterRid == null ? prev.lines.length : prev.lines.findIndex((x) => x.rid === afterRid) + 1;
      const upTo = prev.lines.slice(0, at > 0 ? at : prev.lines.length);
      const above = nextLineSub(upTo.map((x) => ({ department: x.department, subDepartmentId: x.subDepartmentId ?? null })));
      const line = { ...emptyLine(rid, above.department, above.subDepartmentId), projectId: billProject };
      const lines = [...prev.lines];
      lines.splice(at > 0 ? at : lines.length, 0, line);
      return { ...prev, lines };
    });
  };
  /* The line the cursor is in: Insert adds the new line right below it. */
  const lineOfFocus = (target: EventTarget | null): number | undefined => {
    const tr = target instanceof Element ? target.closest('tr[data-line]') : null;
    const rid = tr ? Number(tr.getAttribute('data-line')) : NaN;
    return Number.isFinite(rid) ? rid : undefined;
  };
  const cols = useColumnWidths('conts.apInvoiceForm.cols.v2', LINE_COLS);
  const removeLine = (rid: number) => setV((prev) => (prev.lines.length > 1 ? { ...prev, lines: prev.lines.filter((l) => l.rid !== rid) } : prev));
  const hopFrom = (rid: number) => {
    const i = v.lines.findIndex((l) => l.rid === rid);
    const next = v.lines.at(i + 1);
    if (next) setLandOn(next.rid); else addLine(true);
  };

  const total = v.lines.reduce((s, l) => s + (l.amountSen > 0 ? l.amountSen : 0), 0);
  const belowPaid = posted && total < paidSen;
  const supplierLocked = posted && paidSen > 0;
  const ready = !!v.supplierId && !!v.invoiceDate && total > 0 && !belowPaid
    && v.lines.filter((l) => l.amountSen > 0).every((l) => !!l.debitAccountCode && !!l.department);

  /* ── Scan bill (OCR) — the voucher's reader fills THIS form: the supplier
     from the server's match, the bill's own number, its dates and lines; the
     account ONLY from vendor memory, never a model guess. MULTI-SELECT MEANS
     ONE BILL (its pages); the read pages attach after save. */
  const extract = useExtractBills();
  const [scanNote, setScanNote] = useState<string | null>(initialNote ?? null);
  const [pendingFiles, setPendingFiles] = useState<PvFilePayload[]>(initialFiles ?? []);
  /* 拖进来 upload (owner 2026-09-08): the scan row takes a dropped bill too. */
  const [dragOver, setDragOver] = useState(false);
  /* F3 / Ctrl+S = the save button (owner 2026-09-08: 像 autocount 按 f3);
     a form that is not ready ignores it, as the button would. */
  useSaveHotkey(() => { if (ready) void onSubmit(toSubmit(v), pendingFiles); }, !saving);
  const applyExtraction = (ex: BillExtraction, match: { id: string } | null, memory: VendorMemory | null) => {
    setV((prev) => ({ ...prev, ...formFromExtraction(ex, match, memory) }));
  };
  const onScanFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setScanNote('Reading the bill…');
    try {
      const files = await Promise.all([...list].map(async (f) => ({ name: f.name, mime: f.type || 'application/pdf', dataBase64: await fileToBase64(f) })));
      const res = await extract.mutateAsync([{ files }]);
      const bill = res.bills.at(0);
      if (!bill) { setScanNote('The bill could not be read.'); return; }
      if (!bill.ok) { setScanNote(bill.reason); return; }
      applyExtraction(bill.extraction, bill.supplierMatch, bill.memory);
      /* The LAST successful read wins, matching applyExtraction overwriting
         the lines — this form reads ONE bill at a time. */
      setPendingFiles(files);
      setScanNote(scanNoteFor(bill));
    } catch (e) {
      setScanNote(e instanceof Error ? e.message : 'The bill could not be read.');
    }
  };

  const saveLabel = mode === 'edit' ? (posted ? 'Save & re-post' : 'Save changes') : 'Save as draft';
  /* A quotation on the books, its formal invoice come (chew, 15 Nov 2026): the same bill is changed to match it — the
     invoice's number and date (the date the expense is booked on, by default), its lines and amounts, more or less. */
  const wasQuotation = mode === 'edit' && initial.provisional === true;
  const refRef = useRef<HTMLInputElement>(null);
  const replaceWithInvoice = () => {
    set({ provisional: false, invoiceDate: myt() });
    setTimeout(() => refRef.current?.focus(), 0);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', fontSize: 'var(--fs-13)' }}>
      {mode !== 'edit' && (
        <div
          aria-label="Drop the bill here"
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => { setDragOver(false); }}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); if (!extract.isPending) void onScanFiles(e.dataTransfer.files); }}
          style={{
            display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap',
            padding: '6px 8px', borderRadius: 6, border: `1px dashed ${dragOver ? 'var(--c-orange)' : 'var(--border-weak, #e3e1da)'}`,
          }}>
          {/* Scan bill — pick the bill's page(s); MULTI-SELECT = ONE BILL. A
              pile of bills goes through the pile page ("Scan bills" on the
              list), one AP invoice each. */}
          <label style={{ fontSize: 'var(--fs-12)', color: 'var(--c-orange)', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}>
            📷 {extract.isPending ? 'Reading…' : 'Scan bill (OCR)'}
            <input type="file" multiple accept={PV_FILE_ACCEPT} aria-label="Scan bill files" style={{ display: 'none' }}
              disabled={extract.isPending}
              onChange={(e) => { void onScanFiles(e.target.files); e.target.value = ''; }} />
          </label>
          <span style={soft}>or drag the bill here</span>
          {scanNote && (
            <span style={{ fontSize: 'var(--fs-12)', color: extract.isPending ? 'var(--fg-muted)' : 'var(--c-orange)' }}>{scanNote}</span>
          )}
          {pendingFiles.length > 0 && (
            <span style={soft}>📎 {pendingFiles.length} scanned file(s) will be attached to this bill on save: {pendingFiles.map((f) => f.name).join(', ')}</span>
          )}
        </div>
      )}
      {wasQuotation && (
        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap', fontSize: 'var(--fs-12)' }}>
          {v.provisional
            ? <>
                <span style={{ color: 'var(--c-orange)' }}>This is a quotation, booked before its formal invoice.</span>
                <Button variant="secondary" size="sm" onClick={replaceWithInvoice}>Replace with formal invoice</Button>
              </>
            : <span style={{ color: 'var(--c-orange)' }}>Replacing the quotation: enter the formal invoice's number and date, and its lines and amounts as it reads (more or less is fine). The expense is booked on the invoice date.</span>}
        </div>
      )}
      {posted && (
        <div style={{ fontSize: 'var(--fs-12)', color: 'var(--c-orange)' }}>
          This bill is on the books — saving re-posts it: the old journal gets a contra, a fresh one books what you save.
          {paidSen > 0 ? ` ${fmtSen(paidSen)} is already paid against it, so the total cannot fall below that and the supplier stays.` : ''}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 2fr) minmax(170px, 1fr) minmax(150px, 1fr) minmax(150px, 1fr)', gap: 'var(--space-3)' }}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Supplier *</span>
          <SearchCombo
            options={sortByText(suppliers).map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))}
            value={v.supplierId} onChange={(id) => set({ supplierId: id })} aria-label="AP invoice supplier" className={styles.fieldInput}
            disabled={supplierLocked}
            placeholder={suppliersLoading ? 'Loading suppliers…' : 'Type to find the supplier'} />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Supplier's invoice no.</span>
          <input ref={refRef} className={styles.fieldInput} value={v.supplierRef} onChange={(e) => set({ supplierRef: e.target.value })} aria-label="Supplier invoice ref" placeholder="As printed on the bill" />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Invoice date *</span>
          <DateField fullWidth className={styles.fieldInput} value={v.invoiceDate} onChange={(iso) => set({ invoiceDate: iso })} aria-label="AP invoice date" />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Due date</span>
          <DateField fullWidth className={styles.fieldInput} value={v.dueDate} onChange={(iso) => set({ dueDate: iso })} aria-label="AP invoice due date" />
        </label>
      </div>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Description</span>
        <input className={styles.fieldInput} value={v.description} onChange={(e) => set({ description: e.target.value })} aria-label="AP invoice description"
          placeholder="What this bill is for — shows on the list and prints on the listing" />
      </label>
      <label className={styles.field} style={{ maxWidth: 420 }}>
        <span className={styles.fieldLabel}>Project (every line)</span>
        <ProjectPicker inputClass={styles.fieldInput} ariaLabel="Bill project" placeholder="No project — or choose per line"
          value={billProject} onChange={chooseBillProject} />
      </label>
      <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 'var(--fs-13)' }}>
        <input type="checkbox" checked={v.provisional === true} onChange={(e) => set({ provisional: e.target.checked })} aria-label="Quotation, no formal invoice yet" />
        Quotation (no formal invoice yet)
        <span style={soft}>— booked now; replaced by the formal invoice when it comes (SOP 3.8)</span>
      </label>

      {/* The lines, in the owner's order: account number, description, amount.
          Insert anywhere in the table adds a line and lands on it. */}
      <div style={{ overflowX: 'auto' }}>
      <table ref={tableRef} style={{ width: cols.total, minWidth: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }}
        onKeyDown={(e) => { if (e.key === 'Insert') { e.preventDefault(); addLine(true, lineOfFocus(e.target)); } }}>
        <thead>
          <tr>
            <ResizableTh col="account" width={cols.widths.account} onResize={cols.resize} onReset={cols.reset} style={th}>Account</ResizableTh>
            <ResizableTh col="description" width={cols.widths.description} onResize={cols.resize} onReset={cols.reset} style={th}>Description</ResizableTh>
            <ResizableTh col="amount" width={cols.widths.amount} onResize={cols.resize} onReset={cols.reset} style={{ ...th, textAlign: 'right', paddingRight: 14 }}>Amount (RM)</ResizableTh>
            <ResizableTh col="department" width={cols.widths.department} onResize={cols.resize} onReset={cols.reset} style={th}>Department</ResizableTh>
            <ResizableTh col="project" width={cols.widths.project} onResize={cols.resize} onReset={cols.reset} style={th}>Project</ResizableTh>
            <ResizableTh col="unit" width={cols.widths.unit} onResize={cols.resize} onReset={cols.reset} style={th}>Unit</ResizableTh>
            <th style={{ ...th, width: cols.widths.actions }} />
          </tr>
        </thead>
        <tbody>
          {v.lines.map((l) => (
            <tr key={l.rid} data-line={l.rid}>
              <td style={td}>
                <AccountSelect accounts={lineAccounts} value={l.debitAccountCode} className={styles.fieldInput}
                  onChange={(code) => patchLine(l.rid, { debitAccountCode: code })} placeholder="— account this line charges —" />
              </td>
              <td style={td}>
                <input className={styles.fieldInput} style={{ width: '100%' }} placeholder="Description" value={l.description} aria-label={`line ${l.rid} description`}
                  onChange={(e) => patchLine(l.rid, { description: e.target.value })} />
              </td>
              <td style={td}>
                <MoneyInput bare valueSen={l.amountSen} inputClassName={styles.fieldInput} selectOnFocus aria-label={`line ${l.rid} amount`}
                  placeholder="0.00" style={{ width: '100%' }}
                  onCommit={(sen) => patchLine(l.rid, { amountSen: sen ?? 0 })}
                  onKeyDown={(e) => { if (e.key === 'Enter') hopFrom(l.rid); }} />
              </td>
              <td style={td}>
                <SubDepartmentSelect className={styles.fieldInput} style={{ width: '100%' }} label={`line ${l.rid} department`}
                  value={{ department: l.department, subDepartmentId: l.subDepartmentId ?? null }} onChange={(v) => patchLine(l.rid, v)} />
              </td>
              <td style={td}>
                <ProjectPicker inputClass={styles.fieldInput} ariaLabel={`line ${l.rid} project`} placeholder="No project"
                  value={l.projectId ?? null} onChange={(id) => patchLine(l.rid, { projectId: id })} />
              </td>
              <td style={td}>
                <UnitPicker inputClass={styles.fieldInput} ariaLabel={`line ${l.rid} unit`} placeholder="No unit"
                  value={l.unitId ?? null} onChange={(id) => patchLine(l.rid, { unitId: id })} />
              </td>
              <td style={{ ...td, whiteSpace: 'nowrap' }}>
                <button type="button" aria-label={`add a line below line ${l.rid}`} title="Add a line below" onClick={() => addLine(true, l.rid)} style={iconBtn}>
                  <Plus size={14} strokeWidth={1.75} />
                </button>
                {v.lines.length > 1 && (
                  <button type="button" aria-label={`remove line ${l.rid}`} onClick={() => removeLine(l.rid)} style={iconBtn}>
                    <X size={14} strokeWidth={1.75} />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: '1px solid var(--border-weak, #e3e1da)' }}>
            <td colSpan={2} style={td}>
              <AddLineButton variant="ghost" onClick={() => addLine(true)} />
              <span style={{ ...soft, marginLeft: 'var(--space-3)' }}>Insert or + adds a line below · Enter on an amount moves down · drag a heading's edge to resize</span>
            </td>
            <td style={{ ...td, ...right, fontWeight: 700, color: belowPaid ? 'var(--c-festive-b, #B8331F)' : undefined }}>Total {fmtSen(total)}</td>
            <td />
            <td />
            <td />
          </tr>
        </tfoot>
      </table>
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end', alignItems: 'center' }}>
        {belowPaid && <span style={{ fontSize: 'var(--fs-12)', color: 'var(--c-festive-b, #B8331F)' }}>The total cannot fall below the {fmtSen(paidSen)} already paid.</span>}
        <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>{SAVE_HOTKEY_HINT}</span>
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" size="sm" onClick={() => void onSubmit(toSubmit(v), pendingFiles)} disabled={saving || !ready}>
          {saving ? 'Saving…' : saveLabel}
        </Button>
      </div>
    </div>
  );
};
