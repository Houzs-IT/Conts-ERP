// Conts only (not part of Houzs's code): on a payment voucher, the project it pays and that project's limit (finance
// phase 1.5; SOP 3.4). Pick the project (left blank, the server takes the one its bills belong to); the limit left
// shows beside it, and when the voucher is more than is left, a request for extra limit can be sent from here.
import { useState } from "react";
import { fmtSenPlain } from "../vendor/shared/format";
import { useAskLimit, useProjectLimit, useProjectOptions } from "./projectLimitQueries";

const BAD = "var(--c-festive-b, #b3261e)";

export function ProjectLimitField({ projectId, onChange, amountSen, disabled, exceptPvId, fieldClass, labelClass, inputClass }: {
  projectId: number | null; onChange: (id: number | null) => void; amountSen: number; disabled?: boolean;
  /** A voucher already submitted, being edited: its own reservation is not counted against it. */
  exceptPvId?: string | null;
  fieldClass?: string; labelClass?: string; inputClass?: string;
}) {
  const projects = useProjectOptions();
  const limit = useProjectLimit(projectId, exceptPvId ?? null);
  const ask = useAskLimit();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const l = limit.data;
  const over = l ? Math.max(0, amountSen - l.leftSen) : 0;

  const send = async () => {
    if (!l || !reason.trim()) return;
    setSent(null);
    try {
      await ask.mutateAsync({ projectId: l.projectId, kind: l.funding === "internal" ? "budget" : "amount", amountSen: over, reason: reason.trim() });
      setSent(`Asked for RM ${fmtSenPlain(over)} more. It waits for approval (Finance → Limit Requests).`);
      setAsking(false);
      setReason("");
    } catch (e) {
      setSent(e instanceof Error ? e.message : "The request was not sent.");
    }
  };

  return (
    <div className={fieldClass} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span className={labelClass}>Project</span>
        <select aria-label="Project" className={inputClass} value={projectId ?? ""} disabled={disabled}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
          <option value="">— None, or the one its bills belong to —</option>
          {(projects.data?.projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.code ? `${p.code} · ` : ""}{p.name}{p.funding === "internal" ? " (internal)" : ""}</option>)}
        </select>
      </label>
      {l && (
        <span style={{ fontSize: "var(--fs-12)", color: over > 0 ? BAD : "var(--fg-muted)" }}>
          {l.funding === "internal" ? "Budget" : "Limit"} left RM {fmtSenPlain(l.leftSen)} of RM {fmtSenPlain(l.limitSen)}
          {l.reservedSen > 0 ? ` (RM ${fmtSenPlain(l.reservedSen)} reserved)` : ""}
          {over > 0 ? ` — this voucher is RM ${fmtSenPlain(over)} over` : ""}
        </span>
      )}
      {l && over > 0 && !disabled && !asking && (
        <button type="button" style={{ alignSelf: "flex-start", fontSize: "var(--fs-12)" }} onClick={() => setAsking(true)}>Request extra limit</button>
      )}
      {asking && (
        <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          <input aria-label="Why the project needs more" className={inputClass} value={reason} placeholder="Why the project needs more" onChange={(e) => setReason(e.target.value)} />
          <button type="button" onClick={() => void send()} disabled={!reason.trim() || ask.isPending}>{ask.isPending ? "Sending…" : `Ask for RM ${fmtSenPlain(over)}`}</button>
          <button type="button" onClick={() => setAsking(false)}>Cancel</button>
        </span>
      )}
      {sent && <span role="status" style={{ fontSize: "var(--fs-12)" }}>{sent}</span>}
    </div>
  );
}
