/* Beta workspace > Overview > Site progress (BRIEF-beta-oct24 section 8): the vertical step list of the mockup. Each
   live site task with its date, done / in progress / late, the photos on its PO's goods receipts, and "Waits for Nth
   payment" when its step needs a payment not received yet; the handover at the end. */

import { useState, type ReactElement } from "react";
import { Camera } from "lucide-react";
import { useQuery } from "../../hooks/useQuery";
import { WS, WsCard, WsCheck } from "./BetaWsUi";
import type { BetaTabProps } from "./betaShared";
import { dayMonth, renovationDays, siteTimeline, trimTimeline } from "./renovationBetaModel";
import { betaSiteApi } from "./renovationBetaSiteApi";
import { photosByPo, siteStepsPlus, type SiteStepPlus } from "./renovationBetaSiteModel";
import { BETA } from "./renovationBetaTheme";

export function BetaSiteProgressCard({ p }: { p: BetaTabProps }): ReactElement {
  const { detail: d, today, workspace } = p;
  const site = useQuery(["renovation-beta", "site", p.projectId], () => betaSiteApi.site(p.projectId), [p.projectId]);
  const [showAll, setShowAll] = useState(false);
  const handoverOn = d.project.handed_over_at ?? d.project.planned_handover_date;
  const all = siteTimeline(d.tasks, today, handoverOn);
  const trimmed = trimTimeline(all, showAll);
  const canTrim = trimTimeline(all, false).hiddenDone + trimTimeline(all, false).hiddenLater > 0;
  const rows = siteStepsPlus(trimmed.steps, d.tasks, workspace.payments, photosByPo(site.data?.deliveries ?? []));
  const live = all.filter((s) => s.id !== "handover");
  const done = live.filter((s) => s.state === "done").length;
  const late = live.filter((s) => s.state === "late").length;
  const span = renovationDays(d.tasks, today);
  const sub = live.length === 0
    ? "No site tasks yet"
    : [span && span.day > 0 ? `Day ${span.day} of ${span.total}` : null, `${done} of ${live.length} steps done`, late > 0 ? `${late} late` : null].filter(Boolean).join(" · ");
  return (
    <WsCard title="Site progress" sub={sub} right={<button type="button" className="link" onClick={() => p.openTab("site")}>Site photos →</button>}>
      {live.length > 0 ? (
        <>
          <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
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

function SiteRow({ s, last, today, onPhotos }: { s: SiteStepPlus; last: boolean; today: string; onPhotos: () => void }): ReactElement {
  const now = s.state === "current";
  const done = s.state === "done";
  const isLate = s.state === "late";
  const ring = isLate ? "2px solid #E8A5A2" : `2px solid ${BETA.border}`;
  const extra = (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: s.photos > 0 || s.waitsFor ? 4 : 0 }}>
      {s.waitsFor && <span style={{ padding: "2px 8px", borderRadius: 6, background: "#FDF1E2", color: WS.amber, fontSize: 12, fontWeight: 600 }}>{s.waitsFor}</span>}
      {s.photos > 0 && (
        <button type="button" onClick={onPhotos} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 6, border: 0, background: WS.chip, color: WS.text2, font: "inherit", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
          <Camera size={12} aria-hidden="true" />{s.photos} photo{s.photos === 1 ? "" : "s"}
        </button>
      )}
    </div>
  );
  return (
    <li aria-current={now ? "step" : undefined} style={{ display: "grid", gridTemplateColumns: "64px 24px 1fr", gap: 10 }}>
      <div style={{ padding: last ? "2px 0 0" : "2px 0 14px", color: now ? BETA.accentInk : isLate ? WS.red : BETA.muted, fontSize: 13, fontWeight: now || isLate ? 700 : 400 }}>
        {now ? <>Today<br />{dayMonth(today)}</> : dayMonth(s.date)}
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        {done ? (
          <span style={{ width: 18, height: 18, borderRadius: 9, background: BETA.accent, display: "flex", alignItems: "center", justifyContent: "center" }}><WsCheck size={10} stroke={3.5} /></span>
        ) : now ? (
          <span style={{ width: 18, height: 18, borderRadius: 9, background: BETA.surface, border: `3px solid ${BETA.accent}` }} />
        ) : s.state === "handover" ? (
          <span style={{ width: 18, height: 18, borderRadius: 4, background: BETA.ink }} />
        ) : (
          <span style={{ width: 18, height: 18, borderRadius: 9, background: BETA.surface, border: ring }} />
        )}
        {!last && (done ? <span style={{ flex: 1, width: 2, background: BETA.accent }} /> : <span style={{ flex: 1, width: 0, borderLeft: `2px dashed ${BETA.border}` }} />)}
      </div>
      {now ? (
        <div style={{ marginBottom: last ? 0 : 14, padding: "10px 12px", borderRadius: 8, background: "#E4F1EF", minWidth: 0 }}>
          <div style={{ fontWeight: 700, color: BETA.accentInk, overflowWrap: "anywhere" }}>{s.label}</div>
          {s.sub && <div style={{ fontSize: 13, color: "#2B3533" }}>{s.sub}</div>}
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
