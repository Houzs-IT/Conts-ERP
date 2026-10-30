// Conts only (not part of Houzs's code): the "Renovation contracts at go-live" block of the Ledger setup page (plan
// 2026-10-30-renovation-revenue-ledger.md Task 8). Finance uploads one row per contract signed before the books start —
// its SO, customer account, advance sub-account and what AutoCount invoiced before go-live — sees the server's check of
// every row, and applies. A row with a problem stops the whole file. Nothing posts: the opening balances carry it.
import { useRef, useState } from "react";
import { Button } from "@2990s/design-system";
import styles from "../pages/scm-v2/SalesOrderDetail.module.css";
import { useConfirm } from "../vendor/scm/components/ConfirmDialog";
import { readWorkbookGrid } from "./opening";
import {
  RENO_OPENING_COLUMNS, downloadRenoOpeningTemplate, parseRenoOpeningGrid, useRenoOpeningApply, useRenoOpeningPreview,
  type RenoOpeningPreviewRow, type RenoOpeningRow,
} from "./renoOpening";

const GOOD = "var(--c-secondary-a, #2F5D4F)";
const BAD = "var(--c-festive-b, #B8331F)";
const MUTED = "var(--fg-muted)";
const num: React.CSSProperties = { textAlign: "right", fontVariantNumeric: "tabular-nums", padding: "4px 8px", whiteSpace: "nowrap" };
const cell: React.CSSProperties = { padding: "4px 8px" };
const rm = (sen: number): string => (sen / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const errText = (e: unknown, fallback: string): string => (e instanceof Error ? e.message : fallback);

/** What a row changes, against what the contract holds now. */
const changed = (now: string | null | undefined, next: string): string => (now && now !== next ? ` (was ${now})` : "");

export function RenovationOpening({ canSave, ledgerStartDate }: { canSave: boolean; ledgerStartDate: string | null }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<RenoOpeningRow[]>([]);
  const [checked, setChecked] = useState<RenoOpeningPreviewRow[] | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const preview = useRenoOpeningPreview();
  const apply = useRenoOpeningApply();
  const askConfirm = useConfirm();

  const reset = () => { setRows([]); setChecked(null); if (fileRef.current) fileRef.current.value = ""; };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setNote(null); setChecked(null); setFileName(f.name);
    try {
      const sheet = parseRenoOpeningGrid(await readWorkbookGrid(f));
      if (sheet.error) { setRows([]); setNote({ ok: false, text: sheet.error }); return; }
      const bad = sheet.rows.filter((r) => r.error);
      if (bad.length > 0) {
        setRows([]);
        setNote({ ok: false, text: `Fix the file first: ${bad.slice(0, 5).map((r) => `row ${r.line} — ${r.error}`).join("; ")}${bad.length > 5 ? ` (and ${bad.length - 5} more)` : ""}.` });
        return;
      }
      if (sheet.rows.length === 0) { setNote({ ok: false, text: "The file has no rows." }); return; }
      const values = sheet.rows.map((r) => r.value);
      setRows(values);
      const r = await preview.mutateAsync(values);
      setChecked(r.rows);
    } catch (e) {
      setRows([]);
      setNote({ ok: false, text: errText(e, "The file could not be checked.") });
    }
  };

  const problems = (checked ?? []).filter((r) => r.problems.length > 0).length;
  const canApply = canSave && !!checked && checked.length > 0 && problems === 0 && !apply.isPending;

  const onApply = async () => {
    if (!(await askConfirm({
      title: `Seed ${rows.length} renovation contract${rows.length === 1 ? "" : "s"}?`,
      body: "Each contract takes this customer account and advance account, and its invoices from now on start after the amount invoiced before go-live. Nothing is posted: the opening balances carry the money.",
      confirmLabel: "Apply",
    }))) return;
    setNote(null);
    try {
      const r = await apply.mutateAsync(rows);
      setNote({ ok: true, text: `${r.applied} contract${r.applied === 1 ? "" : "s"} seeded.` });
      reset();
    } catch (e) {
      setNote({ ok: false, text: errText(e, "Nothing was applied.") });
    }
  };

  return (
    <section className={styles.card} style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <h2 className={styles.cardTitle}>Renovation contracts at go-live</h2>
      {!ledgerStartDate ? (
        <p style={{ margin: 0, color: MUTED }}>Set the day the books start first: only contracts signed before it are seeded here.</p>
      ) : (
        <>
          <span style={{ fontSize: "var(--fs-12)", color: MUTED }}>
            One row per renovation contract signed before {ledgerStartDate}: its customer account (under 301, 302 or 303), its
            advance account (under 480-0000 or 481-0000) and what AutoCount invoiced on it before go-live, in RM. Invoices from now
            on carry on from that amount, and a variation order posts only its difference. Nothing is posted.
            Columns: {RENO_OPENING_COLUMNS.join(", ")}.
          </span>
          <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" }}>
            <Button variant="secondary" size="sm" onClick={() => downloadRenoOpeningTemplate()}>Template</Button>
            <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={!canSave || preview.isPending}>Upload Excel</Button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} aria-label="Renovation contracts at go-live file"
              onChange={(e) => void onFile(e.target.files?.[0])} />
            {fileName && checked && <span style={{ fontSize: "var(--fs-12)", color: MUTED }}>{fileName}</span>}
            {preview.isPending && <span style={{ fontSize: "var(--fs-12)", color: MUTED }}>Checking…</span>}
          </div>
          {checked && (
            <>
              <div style={{ fontSize: "var(--fs-13)" }} data-testid="reno-opening-summary">
                {checked.length} contract{checked.length === 1 ? "" : "s"} · RM {rm(checked.reduce((t, r) => t + r.billedBeforeGoLiveSen, 0))} invoiced before go-live
                {problems > 0 && <b style={{ color: BAD }}> · {problems} row{problems === 1 ? " needs" : "s need"} fixing — nothing is applied until every row is clean</b>}
              </div>
              <div style={{ overflowX: "auto", maxHeight: 400, overflowY: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--fs-13)" }}>
                  <thead style={{ position: "sticky", top: 0, background: "var(--bg-surface, var(--bg, #fff))" }}>
                    <tr style={{ textAlign: "left", color: MUTED }}>
                      <th style={cell}>SO</th><th style={cell}>Customer</th><th style={cell}>Advance</th>
                      <th style={{ ...num, fontWeight: 400 }}>Contract (RM)</th><th style={{ ...num, fontWeight: 400 }}>Invoiced before (RM)</th>
                      <th style={cell}>Problem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...checked].sort((a, b) => Number(b.problems.length > 0) - Number(a.problems.length > 0)).map((r, i) => (
                      <tr key={`${r.soDocNo}-${i}`} data-bad={r.problems.length > 0 ? true : undefined}
                        style={{ borderTop: "1px solid var(--line)", background: r.problems.length > 0 ? "rgba(184, 51, 31, 0.08)" : undefined }}>
                        <td style={cell}>{r.soDocNo}</td>
                        <td style={cell}>{r.debtorCode}<span style={{ color: MUTED }}>{changed(r.current?.debtorCode, r.debtorCode)}</span></td>
                        <td style={cell}>{r.advanceAccountCode}<span style={{ color: MUTED }}>{changed(r.current?.advanceAccountCode, r.advanceAccountCode)}</span></td>
                        <td style={num}>{r.contractSen == null ? "—" : rm(r.contractSen)}</td>
                        <td style={num}>{rm(r.billedBeforeGoLiveSen)}</td>
                        <td style={{ ...cell, color: BAD }}>{r.problems.join(" ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ display: "flex", gap: "var(--space-2)" }}>
                <Button variant="primary" size="sm" onClick={() => void onApply()} disabled={!canApply}>Apply</Button>
                <Button variant="secondary" size="sm" onClick={() => { reset(); setNote(null); }}>Clear</Button>
              </div>
            </>
          )}
          {note && <p style={{ margin: 0, color: note.ok ? GOOD : BAD }}>{note.text}</p>}
        </>
      )}
    </section>
  );
}
