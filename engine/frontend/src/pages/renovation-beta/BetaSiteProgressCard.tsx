/* Beta workspace > Overview > Site progress (BRIEF-beta-oct24 section 8): the vertical step list of the mockup. Each
   live site task with its date, done / in progress / late, the photos on its PO's goods receipts, and "Waits for Nth
   payment" when its step needs a payment not received yet; the handover at the end. */

import { useState, type ReactElement } from "react";
import { Camera } from "lucide-react";
import { useQuery } from "../../hooks/useQuery";
import { WS, WsCard, WsCheck } from "./BetaWsUi";
import type { BetaTabProps } from "./betaShared";
import { dayMonth, renovationDays, siteTimeline, trimTimeline, type SiteStep } from "./renovationBetaModel";
import { betaSiteApi } from "./renovationBetaSiteApi";
import { photosByPo, progressDayText, siteStepsPlus, type SiteStepPlus } from "./renovationBetaSiteModel";
import { BETA, TONES } from "./renovationBetaTheme";

/** The handover always closes the list (the mockup), saying so when its date is not set yet. */
function withHandover(steps: SiteStep[]): SiteStep[] {
  if (steps.length === 0 || steps.some((s) => s.id === "handover")) return steps;
  return [...steps, { id: "handover", state: "handover", date: null, label: "Handover", sub: "Final payment · keys to client · date not set yet" }];
}

/** One step in progress is "Today" (the one started last); any other reads "Started" on the day it started, in date
    order with the rest. The handover stays last. */
function startedSteps(rows: SiteStepPlus[], tasks: BetaTabProps["detail"]["tasks"]): Array<SiteStepPlus & { started?: boolean }> {
  const startOf = (id: string): string | null => {
    const t = tasks.find((x) => `task-${x.id}` === id);
    const on = t?.actual_start ?? t?.planned_start ?? null;
    return on ? on.slice(0, 10) : null;
  };
  const current = rows.filter((s) => s.state === "current");
  if (current.length < 2) return rows;
  const today = [...current].sort((a, b) => String(startOf(b.id) ?? "").localeCompare(String(startOf(a.id) ?? "")))[0];
  const mapped = rows.map((s) => {
    if (s.state !== "current" || s === today) return s;
    return { ...s, started: true, date: startOf(s.id) ?? s.date, sub: (s.sub ?? "").replace(/^In progress/, "Started") };
  });
  const handover = mapped.filter((s) => s.id === "handover");
  const rest = mapped.filter((s) => s.id !== "handover");
  const key = (s: SiteStepPlus): string => s.date ?? "9999";
  return [...rest.map((s, i) => ({ s, i })).sort((a, b) => key(a.s).localeCompare(key(b.s)) || a.i - b.i).map((x) => x.s), ...handover];
}

export function BetaSiteProgressCard({ p }: { p: BetaTabProps }): ReactElement {
  const { detail: d, today, workspace } = p;
  const site = useQuery(["renovation-beta", "site", p.projectId], () => betaSiteApi.site(p.projectId), [p.projectId]);
  const [showAll, setShowAll] = useState(false);
  const handoverOn = d.project.handed_over_at ?? d.project.planned_handover_date;
  const all = withHandover(siteTimeline(d.tasks, today, handoverOn));
  const trimmed = trimTimeline(all, showAll);
  const canTrim = trimTimeline(all, false).hiddenDone + trimTimeline(all, false).hiddenLater > 0;
  const rows = startedSteps(siteStepsPlus(trimmed.steps, d.tasks, workspace.payments, photosByPo(site.data?.deliveries ?? [])), d.tasks);
  const live = all.filter((s) => s.id !== "handover");
  const done = live.filter((s) => s.state === "done").length;
  const late = live.filter((s) => s.state === "late").length;
  const span = renovationDays(d.tasks, today);
  const stepLabel = d.flow.steps.find((x) => x.key === d.stepSla?.stepKey)?.label ?? null;
  const sub = live.length === 0
    ? "No site tasks yet"
    : [progressDayText(d.stepSla, stepLabel, span, today), `${done} of ${live.length} steps done`, late > 0 ? `${late} late` : null].filter(Boolean).join(" · ");
  return (
    <WsCard title="Site progress" sub={sub} right={<button type="button" className="link" onClick={() => p.openTab("site")}>Site photos →</button>}>
      {live.length > 0 ? (
        <>
          <ol className="stag" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {rows.map((s, i) => <SiteRow key={s.id} s={s} last={i === rows.length - 1} today={today} onPhotos={() => p.openTab("site")} />)}
          </ol>
          {canTrim && (
            <button type="button" className="link" style={{ alignSelf: "flex-start" }} onClick={() => setShowAll((x) => !x)}>
              {showAll ? "Show fewer steps" : `Show all ${all.length} steps`}
            </button>
          )}
        </>
      ) : (
        <p style={{ fontSize: 14, color: BETA.muted }}>Site steps appear here once the project's site tasks are planned.</p>
      )}
    </WsCard>
  );
}

function SiteRow({ s, last, today, onPhotos }: { s: SiteStepPlus & { started?: boolean }; last: boolean; today: string; onPhotos: () => void }): ReactElement {
  const now = s.state === "current" && !s.started;
  const started = s.state === "current" && s.started === true;
  const done = s.state === "done";
  const isLate = s.state === "late";
  const ring = isLate ? `2px solid ${TONES.red.line}` : `2px solid ${BETA.border}`;
  const extra = (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: s.photos > 0 || s.waitsFor ? 4 : 0 }}>
      {s.waitsFor && <span style={{ padding: "2px 8px", borderRadius: 999, background: TONES.red.strong, color: WS.red, fontSize: 12, fontWeight: 600 }}>{s.waitsFor}</span>}
      {s.photos > 0 && (
        <button type="button" onClick={onPhotos} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 999, border: 0, background: WS.chip, color: WS.text2, font: "inherit", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
          <Camera size={12} aria-hidden="true" />{s.photos} photo{s.photos === 1 ? "" : "s"}
        </button>
      )}
    </div>
  );
  return (
    <li aria-current={now ? "step" : undefined} style={{ display: "grid", gridTemplateColumns: "64px 24px 1fr", gap: 10 }}>
      <div style={{ padding: last ? "2px 0 0" : "2px 0 14px", color: now ? BETA.accentInk : isLate ? WS.red : BETA.muted, fontSize: 13, fontWeight: now || isLate ? 700 : 400 }}>
        {now ? <>Today<br />{dayMonth(today)}</> : s.date ? dayMonth(s.date) : "No date"}
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        {done ? (
          <span style={{ width: 18, height: 18, borderRadius: 9, background: BETA.accentFill, display: "flex", alignItems: "center", justifyContent: "center" }}><WsCheck size={10} stroke={3.5} /></span>
        ) : now ? (
          <span style={{ width: 18, height: 18, borderRadius: 9, background: BETA.surface, border: `3px solid ${TONES.accent.dot}` }} />
        ) : started ? (
          <span style={{ width: 18, height: 18, borderRadius: 9, background: TONES.accent.soft, border: `2px solid ${TONES.accent.dot}` }} />
        ) : s.state === "handover" ? (
          <span style={{ width: 18, height: 18, borderRadius: 4, background: BETA.ink }} />
        ) : (
          <span style={{ width: 18, height: 18, borderRadius: 9, background: BETA.surface, border: ring }} />
        )}
        {!last && (done ? <span style={{ flex: 1, width: 2, background: TONES.accent.dot }} /> : <span style={{ flex: 1, width: 0, borderLeft: `2px dashed ${BETA.border}` }} />)}
      </div>
      {now ? (
        <div style={{ marginBottom: last ? 0 : 14, padding: "10px 12px", borderRadius: 14, background: TONES.accent.soft, minWidth: 0 }}>
          <div style={{ fontWeight: 700, color: BETA.accentInk, overflowWrap: "anywhere" }}>{s.label}</div>
          {s.sub && <div style={{ fontSize: 13, color: BETA.text2 }}>{s.sub}</div>}
          {extra}
        </div>
      ) : (
        <div style={{ padding: last ? 0 : "0 0 14px", color: done ? BETA.ink : WS.text2, minWidth: 0 }}>
          <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{s.label}</div>
          {s.sub && <div style={{ fontSize: 13, color: isLate ? WS.red : BETA.muted, fontWeight: isLate ? 600 : 400 }}>{s.sub}</div>}
          {extra}
        </div>
      )}
    </li>
  );
}
