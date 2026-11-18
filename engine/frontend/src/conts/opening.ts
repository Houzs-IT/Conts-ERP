// Conts only (not part of Houzs's code): the opening balances (finance phase 1, spec 3.8) — reading AutoCount's
// three Excel lists and talking to /accounting/opening/* (backend/src/acc/opening.ts).
//   · the trial balance on the day before the books start: Account / Debit / Credit (RM);
//   · the invoices customers still owe: Invoice no / Customer code / Customer / Invoice date / Due date / Outstanding;
//   · the bills the company still owes: Bill no / Supplier code / Bill date / Due date / Outstanding.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { authedFetch } from "../vendor/scm/lib/authed-fetch";

export type OpeningKind = "journal" | "receivables" | "payables";

export const OPENING_COLUMNS: Record<OpeningKind, readonly string[]> = {
  journal: ["Account", "Debit", "Credit"],
  receivables: ["Invoice no", "Customer code", "Customer", "Invoice date", "Due date", "Outstanding"],
  payables: ["Bill no", "Supplier code", "Bill date", "Due date", "Outstanding"],
};

export type JournalRow = { accountCode: string; debitSen: number; creditSen: number };
export type ArRow = { docNo: string; debtorCode: string; debtorName: string; invoiceDate: string; dueDate: string; outstandingSen: number };
export type ApRow = { docNo: string; supplierCode: string; invoiceDate: string; dueDate: string; outstandingSen: number };
/** One sheet row as read: what it says, and what is wrong with it (null when nothing). */
export type Parsed<T> = { line: number; value: T; error: string | null };
export type ParsedSheet<T> = { rows: Parsed<T>[]; error: string | null };

/** RM in a cell → sen. Blank is 0; "1,234.56" and 1234.56 are 123456; anything else (a minus, brackets, text) is null. */
export function toSen(v: unknown): number | null {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) : null;
  const s = String(v).trim().replace(/,/g, "");
  if (s === "" || s === "-") return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

/** An outstanding amount → sen, a minus kept: on the ageing lists a minus is money paid ahead (a receipt, a credit
 *  note or a payment not yet knocked off). "-1,234.56", "(1,234.56)" and -1234.56 are -123456; blank is 0. */
export function toSignedSen(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) : null;
  const s = String(v ?? "").trim().replace(/,/g, "");
  const neg = /^\(.*\)$/.test(s) || s.startsWith("-");
  const sen = toSen(s.replace(/^\((.*)\)$/, "$1").replace(/^-/, ""));
  return sen == null ? null : neg ? -sen : sen;
}

/** A date cell → YYYY-MM-DD. Takes a real date, 2026-10-05, or 05/10/2026 (day first, as AutoCount prints it). */
export function toDay(v: unknown): string | null {
  const pad = (n: number) => String(n).padStart(2, "0");
  if (v instanceof Date && !Number.isNaN(v.getTime())) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  const s = String(v ?? "").trim();
  let y: number, m: number, d: number;
  let hit = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (hit) { y = +hit[1]; m = +hit[2]; d = +hit[3]; }
  else if ((hit = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) { d = +hit[1]; m = +hit[2]; y = +hit[3]; }
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();

/** The sheet's rows keyed by the template's column names, from the row that carries them all. */
/** `optional` columns are read when the sheet has them and left undefined when it does not. */
export function readGrid(grid: unknown[][], columns: readonly string[], optional: readonly string[] = []): { rows: { line: number; cells: Record<string, unknown> }[]; error: string | null } {
  const want = columns.map(norm);
  const headerAt = grid.findIndex((r) => want.every((c) => r.some((x) => norm(x) === c)));
  if (headerAt < 0) return { rows: [], error: `The sheet needs the columns ${columns.join(", ")}.` };
  const header = grid[headerAt].map(norm);
  const idx = want.map((c) => header.indexOf(c));
  const rows: { line: number; cells: Record<string, unknown> }[] = [];
  grid.slice(headerAt + 1).forEach((r, i) => {
    if (!r.some((x) => String(x ?? "").trim() !== "")) return;
    const cells: Record<string, unknown> = {};
    columns.forEach((c, k) => { cells[c] = r[idx[k]]; });
    optional.forEach((c) => { const at = header.indexOf(norm(c)); if (at >= 0) cells[c] = r[at]; });
    rows.push({ line: headerAt + i + 2, cells });
  });
  return { rows, error: null };
}

export function parseJournalGrid(grid: unknown[][]): ParsedSheet<JournalRow> {
  const g = readGrid(grid, OPENING_COLUMNS.journal);
  const rows: Parsed<JournalRow>[] = [];
  for (const { line, cells } of g.rows) {
    const accountCode = String(cells.Account ?? "").trim();
    const dr = toSen(cells.Debit);
    const cr = toSen(cells.Credit);
    const value = { accountCode, debitSen: dr ?? 0, creditSen: cr ?? 0 };
    // A zero line of the trial balance carries nothing into the books.
    if (accountCode && dr === 0 && cr === 0) continue;
    const error = !accountCode ? "No account."
      : dr == null || cr == null ? "The amount is not a plain RM figure."
      : dr > 0 && cr > 0 ? "Both a debit and a credit on one line." : null;
    rows.push({ line, value, error });
  }
  return { rows, error: g.error };
}

function parseDocs<T>(grid: unknown[][], kind: "receivables" | "payables", make: (c: Record<string, unknown>) => { value: T; problem: string | null }): ParsedSheet<T> {
  const g = readGrid(grid, OPENING_COLUMNS[kind]);
  return { error: g.error, rows: g.rows.map(({ line, cells }) => { const m = make(cells); return { line, value: m.value, error: m.problem }; }) };
}

export function parseReceivablesGrid(grid: unknown[][]): ParsedSheet<ArRow> {
  return parseDocs(grid, "receivables", (c) => {
    const sen = toSignedSen(c.Outstanding);
    const value = {
      docNo: String(c["Invoice no"] ?? "").trim(), debtorCode: String(c["Customer code"] ?? "").trim(), debtorName: String(c.Customer ?? "").trim(),
      invoiceDate: toDay(c["Invoice date"]) ?? "", dueDate: toDay(c["Due date"]) ?? "", outstandingSen: sen ?? 0,
    };
    const problem = !value.docNo ? "No invoice number." : !value.debtorCode ? "No customer code." : !value.debtorName ? "No customer."
      : !value.invoiceDate ? "The invoice date is not a date." : !value.dueDate ? "The due date is not a date."
      : !sen ? "The outstanding amount must be a plain RM figure, not zero (a minus is money paid ahead)." : null;
    return { value, problem };
  });
}

export function parsePayablesGrid(grid: unknown[][]): ParsedSheet<ApRow> {
  return parseDocs(grid, "payables", (c) => {
    const sen = toSignedSen(c.Outstanding);
    const value = {
      docNo: String(c["Bill no"] ?? "").trim(), supplierCode: String(c["Supplier code"] ?? "").trim(),
      invoiceDate: toDay(c["Bill date"]) ?? "", dueDate: toDay(c["Due date"]) ?? "", outstandingSen: sen ?? 0,
    };
    const problem = !value.docNo ? "No bill number." : !value.supplierCode ? "No supplier code."
      : !value.invoiceDate ? "The bill date is not a date." : !value.dueDate ? "The due date is not a date."
      : !sen ? "The outstanding amount must be a plain RM figure, not zero (a minus is money paid ahead)." : null;
    return { value, problem };
  });
}

/** The first sheet of an uploaded workbook as a grid: dates as dates, numbers as numbers. */
export async function readWorkbookGrid(file: File): Promise<unknown[][]> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]] as XLSX.WorkSheet | undefined;
  return sheet ? XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "" }) : [];
}

/** An empty workbook with the template's columns, to fill from AutoCount. */
export function downloadTemplate(kind: OpeningKind): void {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[...OPENING_COLUMNS[kind]]]), "Opening");
  XLSX.writeFile(wb, `opening-${kind}.xlsx`);
}

/* ── The server ─────────────────────────────────────────────────────────────────────────────────────────────── */
/** One control account against the documents that should explain it (backend/src/acc/opening.ts ControlLine). */
export type ControlLine = { role: "AR" | "AP" | "AP_OTHER"; accountCode: string; controlSen: number; documentsSen: number; erpDocuments: number; unbilledContractsSen?: number };
export type OpeningCheck = {
  ok: true; openingDay: string; openingJeNo: string | null; openingJeDate: string | null;
  /** The day the controls and the open documents are compared on: the documents' cut-over when set (migration 0333). */
  documentsDay?: string;
  trialDebitSen: number; trialCreditSen: number;
  controls: ControlLine[];
  banks: { accountCode: string; name: string; balanceSen: number }[];
  balanced: boolean;
};
export type OpeningImportResult = { created: number; skipped: number; errors: { docNo: string; error: string }[] };

const CHECK_KEY = ["opening-check"];

export const useOpeningCheck = (enabled: boolean) => useQuery({
  queryKey: CHECK_KEY,
  queryFn: () => authedFetch<OpeningCheck>("/accounting/opening/check"),
  enabled,
  staleTime: 30_000,
});

/** Import one list. Every import moves the balances, so the check and the reports read again. */
export const useImportOpening = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ kind, items }: { kind: OpeningKind; items: unknown[] }) =>
      authedFetch<{ ok: true; jeNo: string } | OpeningImportResult>(`/accounting/opening/${kind}`, {
        method: "POST", body: JSON.stringify(kind === "journal" ? { lines: items } : { rows: items }),
      }),
    onSuccess: () => invalidateOpening(qc),
  });
};

export const useReverseOpening = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => authedFetch<{ ok: true; jeNo: string }>("/accounting/opening/journal/reverse", { method: "POST" }),
    onSuccess: () => invalidateOpening(qc),
  });
};

/** What reads the balances again after an import (the AutoCount ledger books outside a mutation hook). */
export const useRefreshAfterOpening = (): (() => void) => {
  const qc = useQueryClient();
  return () => invalidateOpening(qc);
};

export function invalidateOpening(qc: ReturnType<typeof useQueryClient>): void {
  for (const key of [CHECK_KEY, ["account-balances"], ["report-bs"], ["report-pnl"], ["finance-dashboard"], ["ar-aging"], ["ap-aging"],
    ["control-check"], ["journal-entries"], ["gl-entries"], ["gl-ledger"], ["sales-invoices"], ["purchase-invoices"]]) {
    void qc.invalidateQueries({ queryKey: key });
  }
}

/* ── AutoCount's books after the ledger start, as journals (backend/src/acc/autocount-journals.ts; chew, 17 Nov 2026) ── */
export const AUTOCOUNT_COLUMNS = ["Doc no", "Date", "Account", "Debit", "Credit"] as const;
export const AUTOCOUNT_OPTIONAL = ["Kind", "Description", "Department", "Unit", "Project"] as const;
export type AutocountLine = { accountCode: string; debitSen: number; creditSen: number; notes?: string; department?: string; unitId?: string; projectId?: number };
export type AutocountDoc = { docNo: string; date: string; kind?: string; narration?: string; lines: AutocountLine[] };
export type AutocountSheet = { docs: AutocountDoc[]; lines: number; debitSen: number; creditSen: number; problems: string[]; error: string | null };
export type AutocountImport = { posted: number; already: number; errors: { docNo: string; error: string }[] };
const DEPTS = new Set(["rental", "supply", "shared"]);

/** The ledger's lines, one row each, grouped into documents by Doc no; what is wrong with a row or a document, by name. */
export function parseAutocountGrid(grid: unknown[][]): AutocountSheet {
  const g = readGrid(grid, AUTOCOUNT_COLUMNS, AUTOCOUNT_OPTIONAL);
  const out: AutocountSheet = { docs: [], lines: 0, debitSen: 0, creditSen: 0, problems: [], error: g.error };
  const byNo = new Map<string, AutocountDoc>();
  for (const { line, cells } of g.rows) {
    const docNo = String(cells["Doc no"] ?? "").trim();
    const date = toDay(cells.Date);
    const accountCode = String(cells.Account ?? "").trim().toUpperCase();
    const dr = toSen(cells.Debit), cr = toSen(cells.Credit);
    const dept = String(cells.Department ?? "").trim().toLowerCase();
    const project = String(cells.Project ?? "").trim();
    const bad = !docNo ? "no Doc no" : !date ? "the date is not a date" : !accountCode ? "no account" : dr == null || cr == null ? "the amount is not a plain RM figure"
      : dept && !DEPTS.has(dept) ? `department ${dept} is not rental, supply or shared` : project && !/^\d+$/.test(project) ? "the project is not a project number" : null;
    if (bad) { out.problems.push(`Row ${line}: ${bad}.`); continue; }
    const doc = byNo.get(docNo) ?? { docNo, date: date!, kind: String(cells.Kind ?? "").trim() || undefined, lines: [] };
    if (doc.date !== date) { out.problems.push(`Row ${line}: ${docNo} has two dates.`); continue; }
    const notes = String(cells.Description ?? "").trim();
    if (!doc.narration && notes) doc.narration = notes.slice(0, 120);
    doc.lines.push({ accountCode, debitSen: dr!, creditSen: cr!, ...(notes ? { notes: notes.slice(0, 200) } : {}), ...(dept ? { department: dept } : {}),
      ...(String(cells.Unit ?? "").trim() ? { unitId: String(cells.Unit).trim() } : {}), ...(project ? { projectId: Number(project) } : {}) });
    byNo.set(docNo, doc);
    out.lines += 1; out.debitSen += dr!; out.creditSen += cr!;
  }
  out.docs = [...byNo.values()];
  for (const d of out.docs) {
    const net = d.lines.reduce((n, l) => n + l.debitSen - l.creditSen, 0);
    if (net !== 0) out.problems.push(`${d.docNo}: debit and credit differ by ${(net / 100).toFixed(2)}.`);
  }
  return out;
}

/** Books the documents a hundred at a time, telling how far it got; what each batch refused is kept, the rest go on. */
export async function importAutocount(docs: AutocountDoc[], onBatch: (done: number, total: number) => void): Promise<AutocountImport> {
  const out: AutocountImport = { posted: 0, already: 0, errors: [] };
  for (let i = 0; i < docs.length; i += 100) {
    const part = docs.slice(i, i + 100);
    try {
      const r = await authedFetch<AutocountImport>("/accounting/opening/autocount-journals", { method: "POST", body: JSON.stringify({ docs: part }) });
      out.posted += r.posted; out.already += r.already; out.errors.push(...r.errors);
    } catch (e) {
      out.errors.push(...part.map((d) => ({ docNo: d.docNo, error: e instanceof Error ? e.message : "The batch failed." })));
    }
    onBatch(Math.min(i + 100, docs.length), docs.length);
  }
  return out;
}
