// Conts only (not part of Houzs's code): the Ledger setup page (finance phase 1, spec 3.7 and 3.8). Its first block,
// Books, holds the two settings the whole ledger reads: the day the books start in the engine (nothing dated before
// it posts — it is in the AutoCount opening balances) and the month the fiscal year ends.
import { useEffect, useState } from "react";
import { Button } from "@2990s/design-system";
import { PageHeader } from "../components/Layout";
import { DateField } from "../vendor/scm/components/DateField";
import styles from "../pages/scm-v2/SalesOrderDetail.module.css";
import { useAuth } from "../auth/AuthContext";
import { useConfirm } from "../vendor/scm/components/ConfirmDialog";
import { MONTHS, useLedgerSettings, useSaveLedgerSettings, type LedgerSettings } from "./ledgerSettings";

export function LedgerSetup() {
  const q = useLedgerSettings();
  const save = useSaveLedgerSettings();
  const askConfirm = useConfirm();
  // Saving needs the ledger's post key (PUT /accounting/settings/ledger); everyone with the Ledger may read.
  const canSave = useAuth().can("scm.payment_voucher.post");
  const [start, setStart] = useState("");
  const [fyEnd, setFyEnd] = useState(8);
  const [note, setNote] = useState<string | null>(null);

  // The form opens on what is saved.
  useEffect(() => {
    if (!q.data) return;
    setStart(q.data.ledgerStartDate ?? "");
    setFyEnd(q.data.fiscalYearEndMonth);
  }, [q.data]);

  const onSave = async () => {
    setNote(null);
    // Saves only from what was read: a form that failed to load is not a statement of the settings.
    if (!q.isSuccess) return;
    /* Only what changed is sent — the start date decides what posts (spec 3.8), so it is never resent by the way. */
    const patch: Partial<LedgerSettings> = {};
    const savedStart = q.data.ledgerStartDate ?? "";
    if (start !== savedStart) patch.ledgerStartDate = start || null;
    if (fyEnd !== q.data.fiscalYearEndMonth) patch.fiscalYearEndMonth = fyEnd;
    if (Object.keys(patch).length === 0) { setNote("Nothing changed."); return; }
    if (savedStart && patch.ledgerStartDate !== undefined) {
      const ok = await askConfirm({
        title: start ? `Move the start of the books to ${start}?` : "Clear the start of the books?",
        body: start
          ? "Documents dated before the new day stop posting; ones already posted stay in the books. Do this only when the opening balances are moved to match."
          : "With no start date every document posts again, including edits of old ones that are already in the AutoCount opening balances.",
        confirmLabel: start ? "Move it" : "Clear it",
      });
      if (!ok) return;
    }
    try {
      await save.mutateAsync(patch);
      setNote("Saved.");
    } catch (err) {
      setNote(err instanceof Error ? err.message : "The settings could not be saved.");
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Finance" title="Ledger setup" />
      <section className={styles.card} style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)", maxWidth: 640 }}>
        <h2 className={styles.cardTitle}>Books</h2>
        {q.isError && <p style={{ color: "var(--c-festive-b, #B8331F)" }}>The ledger settings could not be loaded.</p>}
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Books start on</span>
          <DateField value={start} onChange={setStart} aria-label="Books start on" className={styles.fieldInput} />
          <span style={{ fontSize: "var(--fs-12)", color: "var(--fg-muted)" }}>
            {start
              ? "Anything dated before this day is in the AutoCount opening balances: the ledger posts and reverses nothing before it."
              : "No start date yet — every document posts as it does today. Set it to the day the books move to this system."}
          </span>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Fiscal year ends in</span>
          <select aria-label="Fiscal year ends in" className={styles.fieldInput} value={String(fyEnd)}
            onChange={(e) => setFyEnd(Number(e.target.value))}>
            {MONTHS.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
          </select>
          <span style={{ fontSize: "var(--fs-12)", color: "var(--fg-muted)" }}>
            The profit and loss opens on this fiscal year; the balance sheet keeps earlier years as retained earnings.
          </span>
        </label>
        <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
          <Button variant="primary" size="sm" onClick={() => void onSave()} disabled={save.isPending || !q.isSuccess || !canSave}>Save</Button>
          {note && <span style={{ fontSize: "var(--fs-13)" }}>{note}</span>}
          {!canSave && <span style={{ fontSize: "var(--fs-12)", color: "var(--fg-muted)" }}>Only someone who can post to the ledger may change these.</span>}
        </div>
      </section>
    </div>
  );
}
