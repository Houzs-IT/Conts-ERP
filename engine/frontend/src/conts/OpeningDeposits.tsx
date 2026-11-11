// Conts only (not part of Houzs's code): the "Opening deposits" block of the Ledger setup page (chew 2 Nov 2026; plan
// 2026-11-02-renovation-close-out.md Task 2). Finance uploads, by 330 deposit account, the deposits still out at go-live
// with the project or unit each belongs to; the server checks every row (a dry run) and Apply posts one journal that
// tags them without moving any account's total. Reverse it to upload again.
import { useRef, useState } from "react";
import { Button } from "@2990s/design-system";
import { SetupCard } from "./SetupCard";
import { useConfirm } from "../vendor/scm/components/ConfirmDialog";
import { readWorkbookGrid } from "./opening";
import {
  OPENING_DEPOSIT_COLUMNS, downloadOpeningDepositsTemplate, parseOpeningDepositsGrid, refusedProblems, useOpeningDeposits,
  useReverseOpeningDeposits, type DepositProblem, type OpeningDepositRow,
} from "./openingDepositsQueries";

const GOOD = "var(--c-success)";
const BAD = "var(--c-error)";
const MUTED = "var(--fg-muted)";
const rm = (sen: number): string => (sen / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const errText = (e: unknown, fallback: string): string => (e instanceof Error ? e.message : fallback);

export function OpeningDeposits({ canSave, ledgerStartDate }: { canSave: boolean; ledgerStartDate: string | null }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<OpeningDepositRow[]>([]);
  const [checked, setChecked] = useState<{ rows: number; totalSen: number } | null>(null);
  const [problems, setProblems] = useState<DepositProblem[]>([]);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const post = useOpeningDeposits();
  const reverse = useReverseOpeningDeposits();
  const askConfirm = useConfirm();

  const reset = () => { setRows([]); setChecked(null); setProblems([]); if (fileRef.current) fileRef.current.value = ""; };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    reset(); setNote(null);
    try {
      const sheet = parseOpeningDepositsGrid(await readWorkbookGrid(f));
      if (sheet.error) { setNote({ ok: false, text: sheet.error }); return; }
      const bad = sheet.rows.filter((r) => r.error);
      if (bad.length > 0) {
        setNote({ ok: false, text: `Fix the file first: ${bad.slice(0, 5).map((r) => `row ${r.line} — ${r.error}`).join("; ")}${bad.length > 5 ? ` (and ${bad.length - 5} more)` : ""}.` });
        return;
      }
      if (sheet.rows.length === 0) { setNote({ ok: false, text: "The file has no rows." }); return; }
      const values = sheet.rows.map((r) => r.value);
      setRows(values);
      const r = await post.mutateAsync({ rows: values, dryRun: true });
      setChecked({ rows: r.rows, totalSen: r.totalSen });
    } catch (e) {
      const p = refusedProblems(e);
      if (p) setProblems(p); else setNote({ ok: false, text: errText(e, "The file could not be checked.") });
    }
  };

  const onApply = async () => {
    if (!checked || !(await askConfirm({
      title: `Tag ${checked.rows} opening deposit${checked.rows === 1 ? "" : "s"}?`,
      body: `RM ${rm(checked.totalSen)} of the deposit accounts' opening balances is put on its project or unit. No account's total changes.`,
      confirmLabel: "Apply",
    }))) return;
    setNote(null);
    try {
      const r = await post.mutateAsync({ rows, dryRun: false });
      setNote({ ok: true, text: `${r.rows} deposit${r.rows === 1 ? "" : "s"} tagged in ${r.jeNo}.` });
      reset();
    } catch (e) {
      const p = refusedProblems(e);
      if (p) setProblems(p);
      setNote({ ok: false, text: errText(e, "Nothing was applied.") });
    }
  };

  const onReverse = async () => {
    if (!(await askConfirm({ title: "Reverse the opening deposits?", body: "Their journal is reversed on its own day, so a corrected file can be uploaded.", confirmLabel: "Reverse", danger: true }))) return;
    setNote(null);
    try { const r = await reverse.mutateAsync(); setNote({ ok: true, text: `Reversed by ${r.jeNo}.` }); } catch (e) { setNote({ ok: false, text: errText(e, "Not reversed.") }); }
  };

  return (
    <SetupCard title="Opening deposits">
      {!ledgerStartDate ? (
        <p style={{ margin: 0, color: MUTED }}>Set the day the books start first, and import the opening balances.</p>
      ) : (
        <>
          <span style={{ fontSize: "var(--fs-12)", color: MUTED }}>
            One row per deposit still out on {ledgerStartDate}, on its 330 deposit account, with the renovation project (by its code)
            or the Rental unit (by building and unit) it belongs to, in RM. The deposit accounts' totals stay as the opening balances
            have them; this only says whose each deposit is, so a deposit returned later clears on its project or unit.
            Columns: {OPENING_DEPOSIT_COLUMNS.join(", ")}.
          </span>
          <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" }}>
            <Button variant="secondary" size="sm" onClick={() => downloadOpeningDepositsTemplate()}>Template</Button>
            <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={!canSave || post.isPending}>Upload Excel</Button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} aria-label="Opening deposits file"
              onChange={(e) => void onFile(e.target.files?.[0])} />
            <Button variant="secondary" size="sm" onClick={() => void onReverse()} disabled={!canSave || reverse.isPending}>Reverse</Button>
            {post.isPending && <span style={{ fontSize: "var(--fs-12)", color: MUTED }}>Checking…</span>}
          </div>
          {problems.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 18, color: BAD, fontSize: "var(--fs-13)" }}>
              {problems.map((p, i) => <li key={i}>{p.row > 0 ? `Row ${p.row}: ` : ""}{p.problem}</li>)}
            </ul>
          )}
          {checked && (
            <>
              <div style={{ fontSize: "var(--fs-13)" }}>{checked.rows} deposit{checked.rows === 1 ? "" : "s"} · RM {rm(checked.totalSen)} · every row checks out</div>
              <div style={{ display: "flex", gap: "var(--space-2)" }}>
                <Button variant="primary" size="sm" onClick={() => void onApply()} disabled={!canSave || post.isPending}>Apply</Button>
                <Button variant="secondary" size="sm" onClick={() => { reset(); setNote(null); }}>Clear</Button>
              </div>
            </>
          )}
          {note && <p style={{ margin: 0, color: note.ok ? GOOD : BAD }}>{note.text}</p>}
        </>
      )}
    </SetupCard>
  );
}
