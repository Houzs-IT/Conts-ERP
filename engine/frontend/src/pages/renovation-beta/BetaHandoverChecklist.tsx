/* Beta workspace > Defects > Handover check (TODO item 17, migration 0296): walk the unit with one of the company's
   checklists (Projects > Handover checklists). Each item is marked Pass, Fail or N/A; Fail opens the defect report
   filled from the item, and the defect goes into the To fix column with its photo. The check may stay open with items
   not yet marked and be carried on later; Finish needs every item marked. It does not stop the handover: only an
   open defect does. */

import { useState, type ReactElement } from "react";
import { Check, ClipboardCheck, Minus, X } from "lucide-react";
import { useQuery } from "../../hooks/useQuery";
import { errorText } from "../projects/renovation/renovationModel";
import { ReportForm, type ReportFromCheck } from "./BetaDefectsTab";
import { WS, WsBadge, WsBtn, WsDialog, inputStyle, TONE_ACCENT, TONE_ALERT, TONE_QUIET, TONE_WAIT } from "./BetaWsUi";
import { useGuarded, type BetaTabProps } from "./betaShared";
import { handoverApi, type CheckItem, type HandoverCheck } from "./renovationBetaHandoverApi";
import { currentCheck, failPrefill, itemsByArea, progressLine } from "./renovationBetaHandoverModel";
import { dayMonth, mytDay } from "./renovationBetaModel";
import { BETA } from "./renovationBetaTheme";

const DEFECT_WORDS = { open: "Defect to fix", fixed: "Fixed, to check", closed: "Defect closed", archived: "Defect archived" } as const;

export function BetaHandoverChecklist({ p, areas }: { p: BetaTabProps; areas: readonly string[] }): ReactElement | null {
  const q = useQuery(["renovation-beta", "handover-checks", p.projectId], () => handoverApi.checks(p.projectId), [p.projectId]);
  const tq = useQuery(["renovation-beta", "handover-templates"], () => handoverApi.templates(), [], { enabled: p.canWrite });
  const [picked, setPicked] = useState<number | "">("");
  const [failing, setFailing] = useState<ReportFromCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useGuarded();

  // Before migration 0296 the section is simply not shown.
  if (!q.data || !q.data.ready) return null;
  const check = currentCheck(q.data.checks);
  const templates = tq.data && tq.data.ready ? tq.data.templates : [];
  const act = (fn: () => Promise<unknown>, ok: string | null): Promise<void> => run(async () => {
    setError(null);
    try {
      await fn();
      if (ok) p.onDone(ok);
      else q.reload();
    } catch (e) {
      setError(errorText(e));
    }
  });
  const start = (): Promise<void> => {
    const id = picked === "" ? templates[0]?.id : picked;
    if (!id) return Promise.resolve();
    return act(() => handoverApi.start(p.projectId, id), "Handover check started.");
  };

  return (
    <section aria-label="Handover check" style={{ display: "flex", flexDirection: "column", gap: 12, padding: "16px 18px", background: BETA.surface, border: `1px solid ${BETA.line}`, borderRadius: 12 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 16px" }}>
        <ClipboardCheck size={20} aria-hidden="true" style={{ color: BETA.muted }} />
        <div style={{ flex: "1 1 240px", minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Handover check{check ? `: ${check.templateName}` : ""}</div>
          <div style={{ fontSize: 13, color: BETA.muted }}>
            {check ? <CheckLine check={check} /> : "Walk the unit with a checklist before the client signs. A failed item becomes a defect with its photo."}
          </div>
        </div>
        {check && p.canWrite && <CheckActions check={check} busy={busy} act={act} />}
      </div>

      {!check && p.canWrite && (
        templates.length === 0
          ? <p style={{ margin: 0, fontSize: 13, color: BETA.muted }}>{tq.loading ? "Loading checklists..." : "No checklist yet. Make one under Projects > Handover checklists."}</p>
          : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <select aria-label="Checklist" style={{ ...inputStyle, maxWidth: 320 }} value={picked} onChange={(e) => setPicked(e.target.value ? Number(e.target.value) : "")}>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.items.length})</option>)}
              </select>
              <WsBtn kind="dark" disabled={busy} onClick={() => void start()}>Start check</WsBtn>
            </div>
          )
      )}

      {check && <CheckItems check={check} canWrite={p.canWrite && !check.completedAt} busy={busy}
        onMark={(i, r) => act(() => handoverApi.mark(i.id, r, i.note), null)}
        onFail={(i) => setFailing({ checkItemId: i.id, ...failPrefill(i) })} />}

      {error && <p role="alert" style={{ margin: 0, fontSize: 13, color: WS.red }}>{error}</p>}

      {failing && (
        <WsDialog title="Failed: report the problem" sub="It goes into To fix with its photo" onClose={() => setFailing(null)} wide>
          <ReportForm p={p} areas={areas} fromCheck={failing} onClose={() => setFailing(null)} />
        </WsDialog>
      )}
    </section>
  );
}

function CheckLine({ check }: { check: HandoverCheck }): ReactElement {
  const started = check.startedAt ? `started ${dayMonth(mytDay(check.startedAt))}${check.startedByName ? ` by ${check.startedByName}` : ""}` : null;
  const done = check.completedAt ? `Finished ${dayMonth(mytDay(check.completedAt))}${check.completedByName ? ` by ${check.completedByName}` : ""}` : null;
  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
      <span>{progressLine(check.progress)}</span>
      {done ? <WsBadge tone={TONE_ACCENT}>{done}</WsBadge> : <WsBadge tone={TONE_WAIT}>Open</WsBadge>}
      {!done && started && <span>· {started}</span>}
    </span>
  );
}

function CheckActions({ check, busy, act }: { check: HandoverCheck; busy: boolean; act: (fn: () => Promise<unknown>, ok: string | null) => Promise<void> }): ReactElement {
  const [removing, setRemoving] = useState(false);
  if (check.completedAt) return <WsBtn disabled={busy} onClick={() => void act(() => handoverApi.reopen(check.id), "Check reopened.")}>Reopen</WsBtn>;
  const open = check.progress.open;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      {check.progress.checked === 0 && (removing ? (
        <>
          <span style={{ fontSize: 13 }}>Remove this check? Nothing is marked yet.</span>
          <WsBtn size="sm" disabled={busy} onClick={() => setRemoving(false)}>Keep it</WsBtn>
          <WsBtn size="sm" kind="danger" disabled={busy} onClick={() => void act(() => handoverApi.remove(check.id), "Check removed.")}>Remove</WsBtn>
        </>
      ) : <WsBtn size="sm" disabled={busy} onClick={() => setRemoving(true)}>Remove</WsBtn>)}
      <WsBtn kind="confirm" disabled={busy || open > 0} onClick={() => void act(() => handoverApi.finish(check.id), "Handover check finished.")}>
        {open > 0 ? `${open} left to mark` : "Finish check"}
      </WsBtn>
    </div>
  );
}

function CheckItems({ check, canWrite, busy, onMark, onFail }: {
  check: HandoverCheck; canWrite: boolean; busy: boolean;
  onMark: (i: CheckItem, r: "pass" | "na" | null) => void; onFail: (i: CheckItem) => void;
}): ReactElement {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {itemsByArea(check.items).map((g) => (
        <div key={g.area} role="group" aria-label={g.area}>
          <h3 style={{ margin: "0 0 6px", fontSize: 13, fontWeight: 700, color: BETA.muted, textTransform: "uppercase", letterSpacing: ".05em" }}>{g.area}</h3>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {g.items.map((i) => (
              <li key={i.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 12px", padding: "8px 10px", borderRadius: 10, background: WS.panel }}>
                <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, overflowWrap: "anywhere" }}>{i.item}</div>
                  {i.criteria && <div style={{ fontSize: 12, color: BETA.muted, overflowWrap: "anywhere" }}>{i.criteria}</div>}
                  {i.note && <div style={{ fontSize: 12, color: WS.text2 }}>Note: {i.note}</div>}
                </div>
                {i.defectState && <WsBadge tone={i.defectState === "closed" ? TONE_ACCENT : i.defectState === "fixed" || i.defectState === "archived" ? TONE_QUIET : TONE_ALERT}>{DEFECT_WORDS[i.defectState]}</WsBadge>}
                <Marks i={i} canWrite={canWrite} busy={busy} onMark={onMark} onFail={onFail} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Marks({ i, canWrite, busy, onMark, onFail }: {
  i: CheckItem; canWrite: boolean; busy: boolean; onMark: (i: CheckItem, r: "pass" | "na" | null) => void; onFail: (i: CheckItem) => void;
}): ReactElement {
  const locked = !canWrite || busy || i.defectId != null || i.result === "fail";
  const btn = (on: boolean, color: string) => ({
    minHeight: 36, minWidth: 64, padding: "0 10px", borderRadius: 999, font: "inherit", fontSize: 13, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4, justifyContent: "center",
    border: `1px solid ${on ? color : BETA.line}`, background: on ? color : "transparent", color: on ? "#FFFFFF" : BETA.ink, cursor: locked ? "default" : "pointer",
  });
  return (
    <div role="group" aria-label={`Mark ${i.item}`} style={{ display: "flex", gap: 6 }}>
      <button type="button" aria-pressed={i.result === "pass"} disabled={locked} style={btn(i.result === "pass", WS.green)} onClick={() => onMark(i, i.result === "pass" ? null : "pass")}>
        <Check size={14} aria-hidden="true" />Pass
      </button>
      <button type="button" aria-pressed={i.result === "fail"} disabled={locked} style={btn(i.result === "fail", WS.red)} onClick={() => onFail(i)}>
        <X size={14} aria-hidden="true" />Fail
      </button>
      <button type="button" aria-pressed={i.result === "na"} disabled={locked} style={btn(i.result === "na", WS.text2)} onClick={() => onMark(i, i.result === "na" ? null : "na")}>
        <Minus size={14} aria-hidden="true" />N/A
      </button>
    </div>
  );
}
