// Conts only (not part of Houzs's code): the Project limit block of the Ledger setup page (SOP 3.4; chew 4 Nov 2026).
// Finance keeps the limit here: switched off while customer payments are not all in (nothing refused, the limit left
// still shows), and the share of what a customer paid that every customer project without its own may spend.
import { useEffect, useState } from "react";
import { Button } from "@2990s/design-system";
import { useConfirm } from "../vendor/scm/components/ConfirmDialog";
import { useLimitSettings, useSaveLimitSettings } from "./projectLimitQueries";

const pctText = (bp: number): string => `${Number.isInteger(bp / 100) ? bp / 100 : (bp / 100).toFixed(2)}%`;

export function ProjectLimitSettings({ canSave }: { canSave: boolean }) {
  const q = useLimitSettings();
  const save = useSaveLimitSettings();
  const askConfirm = useConfirm();
  const [checked, setChecked] = useState(true);
  const [pct, setPct] = useState("70");
  const [note, setNote] = useState<string | null>(null);

  // The form opens on what is saved.
  useEffect(() => {
    if (!q.data) return;
    setChecked(q.data.checked);
    setPct(String(q.data.pctBp / 100));
  }, [q.data]);

  const onSave = async () => {
    setNote(null);
    if (!q.isSuccess) return;
    const n = Number(pct);
    if (pct.trim() === "" || !Number.isFinite(n) || n < 0 || n > 100) { setNote("The default limit is between 0% and 100%."); return; }
    const pctBp = Math.round(n * 100);
    const was = q.data;
    if (pctBp === was.pctBp && checked === was.checked) { setNote("Nothing changed."); return; }
    const changes = [
      checked !== was.checked ? (checked ? "Switch the project limit check on" : "Switch the project limit check off") : null,
      pctBp !== was.pctBp ? `change the default limit from ${pctText(was.pctBp)} to ${pctText(pctBp)}` : null,
    ].filter(Boolean).join(", and ");
    const ok = await askConfirm({
      title: `${changes.charAt(0).toUpperCase()}${changes.slice(1)}?`,
      body: [
        checked !== was.checked && (checked
          ? "From now on a voucher, payment request or receipt over its project's limit is refused or flagged."
          : "Nothing is refused or flagged over its limit; the limit left still shows, for reference."),
        pctBp !== was.pctBp && "Every customer project without a percentage of its own changes at once.",
      ].filter(Boolean).join(" "),
      confirmLabel: "Save",
    });
    if (!ok) return;
    try {
      await save.mutateAsync({ checked, pctBp });
      setNote("Saved.");
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Not saved.");
    }
  };

  return (
    <section style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 8, maxWidth: 640 }}>
      <h2 style={{ margin: 0, fontSize: 16 }}>Project limit</h2>
      {q.isError && <div role="alert" style={{ color: "var(--c-festive-b, #b3261e)" }}>The project limit settings did not load.</div>}
      <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: "var(--fs-13)" }}>
        <input type="checkbox" aria-label="Check project limits" checked={checked} disabled={!canSave || !q.isSuccess} onChange={(e) => setChecked(e.target.checked)} />
        Check project limits
      </label>
      <span style={{ fontSize: "var(--fs-12)", color: "var(--fg-muted)" }}>
        {checked
          ? "A voucher over its project's limit cannot be submitted; extra limit is asked for on Limit Requests."
          : "Off: nothing is refused for its limit. The limit left still shows on a voucher, for reference."}
      </span>
      <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: "var(--fs-13)", flexWrap: "wrap" }}>
        Default limit
        <input aria-label="Default limit %" inputMode="decimal" value={pct} disabled={!canSave || !q.isSuccess}
          onChange={(e) => setPct(e.target.value)} style={{ width: 72, textAlign: "right", fontVariantNumeric: "tabular-nums" }} />
        % of what the customer has paid
      </label>
      <span style={{ fontSize: "var(--fs-12)", color: "var(--fg-muted)" }}>
        Used by every customer project that has no percentage of its own. Internal projects use their budget instead.
      </span>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <Button variant="primary" size="sm" onClick={() => void onSave()} disabled={save.isPending || !q.isSuccess || !canSave}>Save</Button>
        {note && <span style={{ fontSize: "var(--fs-13)" }}>{note}</span>}
        {!canSave && <span style={{ fontSize: "var(--fs-12)", color: "var(--fg-muted)" }}>Only someone who approves extra project limit may change these.</span>}
      </div>
    </section>
  );
}
