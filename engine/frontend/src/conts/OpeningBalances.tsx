// Conts only (not part of Houzs's code): the Opening balances block of the Ledger setup page (finance phase 1,
// spec 3.8). The check comes first — do the opening figures agree? — then the three AutoCount lists to import:
// upload, look at the preview (a bad row is marked red and stops the import), import.
import { useRef, useState } from "react";
import { Button } from "@2990s/design-system";
import styles from "../pages/scm-v2/SalesOrderDetail.module.css";
import { useConfirm } from "../vendor/scm/components/ConfirmDialog";
import {
  OPENING_COLUMNS, downloadTemplate, parseJournalGrid, parsePayablesGrid, parseReceivablesGrid, readWorkbookGrid, useImportOpening,
  useOpeningCheck, useReverseOpening, type OpeningCheck, type OpeningImportResult, type OpeningKind, type ParsedSheet,
} from "./opening";

const GOOD = "var(--c-secondary-a, #2F5D4F)";
const BAD = "var(--c-festive-b, #B8331F)";
const MUTED = "var(--fg-muted)";
const num: React.CSSProperties = { textAlign: "right", fontVariantNumeric: "tabular-nums", padding: "4px 8px" };
const cell: React.CSSProperties = { padding: "4px 8px" };
const rm = (sen: number): string => (sen / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function OpeningBalances({ canSave, ledgerStartDate }: { canSave: boolean; ledgerStartDate: string | null }) {
  const check = useOpeningCheck(!!ledgerStartDate);
  return (
    <section className={styles.card} style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <h2 className={styles.cardTitle}>Opening balances</h2>
      {!ledgerStartDate ? (
        <p style={{ margin: 0, color: MUTED }}>Set the day the books start first: the opening balances are dated the day before it.</p>
      ) : (
        <>
          {check.isError && <p style={{ margin: 0, color: BAD }}>The opening check could not be loaded.</p>}
          {check.isSuccess && <CheckPanel check={check.data} canSave={canSave} />}
          <UploadPanel kind="journal" canSave={canSave} title="1. Opening journal — AutoCount's trial balance"
            hint={`Every account's balance on ${check.data?.openingDay ?? "the day before the books start"}, profit and loss of this year included. Amounts in RM.`} />
          <UploadPanel kind="receivables" canSave={canSave} title="2. Invoices customers still owe"
            hint="AutoCount's outstanding debtor list. They post nothing (the journal holds the amount) but show in the ageing and take payments." />
          <UploadPanel kind="payables" canSave={canSave} title="3. Bills the company still owes"
            hint="AutoCount's outstanding creditor list. The supplier code must match a supplier in the system." />
        </>
      )}
    </section>
  );
}

/** One figure against what should explain it: green when they agree, red with the difference when not. */
function Compare({ label, left, leftLabel, right, rightLabel }: { label: string; left: number; leftLabel: string; right: number; rightLabel: string }) {
  const diff = left - right;
  return (
    <tr style={{ borderTop: "1px solid var(--line)" }} data-ok={diff === 0}>
      <td style={cell}>{label}</td>
      <td style={num}><span style={{ color: MUTED, fontSize: "var(--fs-12)" }}>{leftLabel} </span>{rm(left)}</td>
      <td style={num}><span style={{ color: MUTED, fontSize: "var(--fs-12)" }}>{rightLabel} </span>{rm(right)}</td>
      <td style={{ ...num, fontWeight: 600, color: diff === 0 ? GOOD : BAD }}>{diff === 0 ? "✓ Agrees" : `✗ Off by ${rm(Math.abs(diff))}`}</td>
    </tr>
  );
}

function CheckPanel({ check, canSave }: { check: OpeningCheck; canSave: boolean }) {
  const reverse = useReverseOpening();
  const askConfirm = useConfirm();
  const [note, setNote] = useState<string | null>(null);
  const onReverse = async () => {
    if (!check.openingJeNo) return;
    if (!(await askConfirm({
      title: `Reverse the opening journal ${check.openingJeNo}?`,
      body: "A reversal dated the same day takes every opening balance out, so a corrected trial balance can be imported. The opening invoices and bills stay.",
      confirmLabel: "Reverse it",
    }))) return;
    setNote(null);
    try { await reverse.mutateAsync(); } catch (e) { setNote(e instanceof Error ? e.message : "The journal could not be reversed."); }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <div style={{ fontWeight: 700, color: check.balanced ? GOOD : BAD }} data-testid="opening-verdict">
        {check.balanced ? "✓ The opening balances agree" : "✗ The opening balances do not agree yet"}
        <span style={{ fontWeight: 400, color: MUTED }}> — as at {check.openingDay}
          {check.openingJeNo ? `, journal ${check.openingJeNo}` : ", no opening journal yet"}</span>
      </div>
      {note && <p style={{ margin: 0, color: BAD }}>{note}</p>}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--fs-13)" }}>
          <thead>
            <tr style={{ textAlign: "left", color: MUTED }}>
              <th style={cell}>Check (RM)</th><th style={{ ...num, fontWeight: 400 }}>Books</th>
              <th style={{ ...num, fontWeight: 400 }}>Should be</th><th style={{ ...num, fontWeight: 400 }}>Result</th>
            </tr>
          </thead>
          <tbody>
            <Compare label="Trial balance" left={check.trialDebitSen} leftLabel="Dr" right={check.trialCreditSen} rightLabel="Cr" />
            <Compare label="Trade debtors" left={check.arControlSen} leftLabel="control" right={check.arDocumentsSen} rightLabel="invoices" />
            <Compare label="Trade creditors" left={check.apControlSen} leftLabel="control" right={check.apDocumentsSen} rightLabel="bills" />
          </tbody>
        </table>
      </div>
      <p style={{ margin: 0, fontSize: "var(--fs-12)", color: MUTED }}>
        Also compare the trial balance total ({rm(check.trialDebitSen)}) and each bank below with AutoCount's figures on {check.openingDay}.
      </p>
      {check.banks.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", maxWidth: 560, borderCollapse: "collapse", fontSize: "var(--fs-13)" }}>
            <thead><tr style={{ textAlign: "left", color: MUTED }}><th style={cell}>Bank and cash</th><th style={{ ...num, fontWeight: 400 }}>Balance (RM)</th></tr></thead>
            <tbody>
              {check.banks.map((b) => (
                <tr key={b.accountCode} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={cell}>{b.accountCode} {b.name}</td><td style={num}>{rm(b.balanceSen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {check.openingJeNo && canSave && (
        <div><Button variant="secondary" size="sm" onClick={() => void onReverse()} disabled={reverse.isPending}>Reverse the opening journal</Button></div>
      )}
    </div>
  );
}

const PARSERS = { journal: parseJournalGrid, receivables: parseReceivablesGrid, payables: parsePayablesGrid };
type AnyRow = Record<string, string | number | undefined>;
const PREVIEW_ROWS = 50;

function UploadPanel({ kind, title, hint, canSave }: { kind: OpeningKind; title: string; hint: string; canSave: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [sheet, setSheet] = useState<ParsedSheet<AnyRow> | null>(null);
  const [fileName, setFileName] = useState("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [rowErrors, setRowErrors] = useState<OpeningImportResult["errors"]>([]);
  const imp = useImportOpening();

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setNote(null); setRowErrors([]); setFileName(f.name);
    try {
      setSheet(PARSERS[kind](await readWorkbookGrid(f)) as unknown as ParsedSheet<AnyRow>);
    } catch (e) {
      setSheet(null);
      setNote({ ok: false, text: e instanceof Error ? e.message : "The file could not be read." });
    }
  };

  const rows = sheet?.rows ?? [];
  const bad = rows.filter((r) => r.error);
  const dr = kind === "journal" ? rows.reduce((t, r) => t + Number(r.value.debitSen ?? 0), 0) : 0;
  const cr = kind === "journal" ? rows.reduce((t, r) => t + Number(r.value.creditSen ?? 0), 0) : 0;
  const total = kind === "journal" ? dr : rows.reduce((t, r) => t + Number(r.value.outstandingSen ?? 0), 0);
  const unbalanced = kind === "journal" && dr !== cr;
  const canImport = canSave && !!sheet && !sheet.error && rows.length > 0 && bad.length === 0 && !unbalanced && !imp.isPending;
  // Bad rows first, so a long list shows what to fix without scrolling.
  const shown = [...bad, ...rows.filter((r) => !r.error)].slice(0, PREVIEW_ROWS);

  const onImport = async () => {
    setNote(null); setRowErrors([]);
    try {
      const r = await imp.mutateAsync({ kind, items: rows.map((x) => x.value) });
      if ("jeNo" in r) setNote({ ok: true, text: `Posted as ${r.jeNo}.` });
      else {
        setRowErrors(r.errors);
        setNote({ ok: r.errors.length === 0, text: `${r.created} imported, ${r.skipped} already there${r.errors.length ? `, ${r.errors.length} refused` : ""}.` });
      }
      if (fileRef.current) fileRef.current.value = "";
      setSheet(null);
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : "The import failed." });
    }
  };

  const cols = kind === "journal"
    ? [["accountCode", "Account"], ["debitSen", "Debit"], ["creditSen", "Credit"]]
    : [["docNo", kind === "receivables" ? "Invoice no" : "Bill no"], [kind === "receivables" ? "debtorName" : "supplierCode", kind === "receivables" ? "Customer" : "Supplier code"],
      ["invoiceDate", "Date"], ["dueDate", "Due"], ["outstandingSen", "Outstanding"]];
  const isMoney = (k: string) => k.endsWith("Sen");

  return (
    <div style={{ borderTop: "1px solid var(--line)", paddingTop: "var(--space-3)", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <b>{title}</b>
      <span style={{ fontSize: "var(--fs-12)", color: MUTED }}>{hint} Columns: {OPENING_COLUMNS[kind].join(", ")}.</span>
      <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" }}>
        <Button variant="secondary" size="sm" onClick={() => downloadTemplate(kind)}>Template</Button>
        <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={!canSave}>Upload Excel</Button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} aria-label={`${title} file`}
          onChange={(e) => void onFile(e.target.files?.[0])} />
        {fileName && sheet && <span style={{ fontSize: "var(--fs-12)", color: MUTED }}>{fileName}</span>}
      </div>
      {sheet?.error && <p style={{ margin: 0, color: BAD }}>{sheet.error}</p>}
      {sheet && !sheet.error && (
        <>
          <div style={{ fontSize: "var(--fs-13)" }} data-testid={`opening-${kind}-summary`}>
            {rows.length} row{rows.length === 1 ? "" : "s"}
            {kind === "journal"
              ? <> · Debit {rm(dr)} · Credit {rm(cr)}{unbalanced && <b style={{ color: BAD }}> · not balanced, off by {rm(Math.abs(dr - cr))}</b>}</>
              : <> · RM {rm(total)}</>}
            {bad.length > 0 && <b style={{ color: BAD }}> · {bad.length} row{bad.length === 1 ? " needs" : "s need"} fixing in the file</b>}
          </div>
          <div style={{ overflowX: "auto", maxHeight: 360, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--fs-13)" }}>
              <thead style={{ position: "sticky", top: 0, background: "var(--bg-surface, var(--bg, #fff))" }}>
                <tr style={{ textAlign: "left", color: MUTED }}>
                  <th style={cell}>Row</th>
                  {cols.map(([k, l]) => <th key={k} style={isMoney(k) ? { ...num, fontWeight: 400 } : cell}>{l}</th>)}
                  <th style={cell}>Problem</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.line} data-bad={r.error ? true : undefined}
                    style={{ borderTop: "1px solid var(--line)", background: r.error ? "rgba(184, 51, 31, 0.08)" : undefined }}>
                    <td style={{ ...cell, color: MUTED }}>{r.line}</td>
                    {cols.map(([k]) => <td key={k} style={isMoney(k) ? num : cell}>{isMoney(k) ? rm(Number(r.value[k] ?? 0)) : String(r.value[k] ?? "")}</td>)}
                    <td style={{ ...cell, color: BAD }}>{r.error ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > PREVIEW_ROWS && <span style={{ fontSize: "var(--fs-12)", color: MUTED }}>Showing {PREVIEW_ROWS} of {rows.length} rows.</span>}
          <div><Button variant="primary" size="sm" onClick={() => void onImport()} disabled={!canImport}>Import</Button></div>
        </>
      )}
      {note && <p style={{ margin: 0, color: note.ok ? GOOD : BAD }}>{note.text}</p>}
      {rowErrors.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18, color: BAD, fontSize: "var(--fs-13)" }}>
          {rowErrors.map((e) => <li key={e.docNo}>{e.docNo}: {e.error}</li>)}
        </ul>
      )}
    </div>
  );
}
