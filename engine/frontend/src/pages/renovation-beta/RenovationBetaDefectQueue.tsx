/* Projects > Defects (TODO item 17, after Hookka's QC pending queue): every open defect of every renovation project in
   one list, under its project, most overdue first, with the handover checks still open. Tabs: All open, To fix,
   To check (fixed, waiting for someone to check and close), Overdue, No one named. A row opens the project's Defects
   tab, where the ticket is worked as before. */

import { useMemo, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, ChevronRight, ClipboardCheck, MapPin, Search, User } from "lucide-react";
import { useQuery } from "../../hooks/useQuery";
import { BetaLoading } from "./BetaLoading";
import { BetaSkin, WS, WsBadge, WsEmpty, WsFilterPill, WsPageHead, WsStyle, inputStyle, TONE_ALERT, TONE_QUIET, TONE_WAIT } from "./BetaWsUi";
import { tradeLabel } from "./betaShared";
import { handoverApi, type QueueDefect } from "./renovationBetaHandoverApi";
import { QUEUE_TABS, inTab, matchesSearch, progressLine, queueByProject, queueDaysLate, queueStage, tabCounts, type QueueTab } from "./renovationBetaHandoverModel";
import { dayMonth, mytDay } from "./renovationBetaModel";
import { BETA } from "./renovationBetaTheme";

const projectHref = (id: number): string => `/beta/projects/${id}?tab=defects`;

export function RenovationBetaDefectQueue(): ReactElement {
  return (
    <>
      <BetaSkin />
      <QueueScreen />
    </>
  );
}

function QueueScreen(): ReactElement {
  const q = useQuery(["renovation-beta", "defect-queue"], () => handoverApi.queue(), []);
  const [tab, setTab] = useState<QueueTab>("all");
  const [search, setSearch] = useState("");
  const today = mytDay(new Date().toISOString());
  const defects = useMemo(() => q.data?.defects ?? [], [q.data]);
  const counts = useMemo(() => tabCounts(defects, today), [defects, today]);
  const shown = useMemo(() => defects.filter((d) => inTab(d, tab, today) && matchesSearch(d, search)), [defects, tab, search, today]);
  const checks = q.data?.checks ?? [];
  // Open checks show with every tab but To check and Overdue, which are about defects only.
  const showChecks = (tab === "all" || tab === "to_fix") && !search.trim();
  const groups = useMemo(() => queueByProject(shown, showChecks ? checks : [], today), [shown, checks, showChecks, today]);

  return (
    <div className="bws" style={{ display: "flex", flexDirection: "column", gap: 16, width: "100%", minWidth: 0, paddingBottom: 40 }}>
      <WsStyle />
      <WsPageHead
        title="Defects"
        sub={<>Every open defect across projects{counts.overdue > 0 && <span style={{ color: WS.red, fontWeight: 600 }}> · {counts.overdue} overdue</span>}</>}
      />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        {QUEUE_TABS.map(([key, label]) => (
          <WsFilterPill key={key} on={tab === key} onClick={() => setTab(key)}>{label} · {counts[key]}</WsFilterPill>
        ))}
        <label style={{ position: "relative", flex: "1 1 220px", maxWidth: 360, marginLeft: "auto" }}>
          <span className="sr">Search defects</span>
          <Search size={16} aria-hidden="true" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: BETA.muted }} />
          <input type="search" value={search} placeholder="Project, area, who fixes it" style={{ ...inputStyle, paddingLeft: 32 }} onChange={(e) => setSearch(e.target.value)} />
        </label>
      </div>

      {q.loading && !q.data ? <BetaLoading label="Loading defects" size="inline" />
        : q.error && !q.data ? <p role="alert" style={{ fontSize: 14, color: WS.red }}>The defects could not be loaded: {q.error}</p>
        : groups.length === 0 ? <WsEmpty>{defects.length === 0 && checks.length === 0 ? "No open defects. Everything reported has been closed." : "Nothing matches."}</WsEmpty>
        : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {groups.map((g) => (
              <section key={g.projectId} aria-label={g.label} style={{ background: BETA.surface, border: `1px solid ${BETA.line}`, borderRadius: 12, overflow: "hidden" }}>
                <Link to={projectHref(g.projectId)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: WS.panel, color: "inherit", textDecoration: "none" }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 700, overflowWrap: "anywhere" }}>{g.label}</span>
                  {g.defects.length > 0 && <span style={{ fontSize: 13, color: BETA.muted }}>{g.defects.length} open</span>}
                  <ChevronRight size={18} aria-hidden="true" style={{ color: BETA.muted }} />
                </Link>
                {g.check && (
                  <Link to={projectHref(g.projectId)} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 10px", padding: "10px 14px", borderTop: `1px solid ${BETA.line}`, color: "inherit", textDecoration: "none" }}>
                    <ClipboardCheck size={16} aria-hidden="true" style={{ color: BETA.muted }} />
                    <span style={{ fontSize: 14, fontWeight: 600 }}>Handover check open: {g.check.templateName}</span>
                    <span style={{ fontSize: 13, color: BETA.muted }}>{progressLine(g.check)}{g.check.startedAt ? ` · started ${dayMonth(mytDay(g.check.startedAt))}` : ""}</span>
                  </Link>
                )}
                {g.defects.length > 0 && (
                  <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                    {g.defects.map((d) => <li key={d.id} style={{ borderTop: `1px solid ${BETA.line}` }}><DefectRow d={d} today={today} /></li>)}
                  </ul>
                )}
              </section>
            ))}
          </div>
        )}
    </div>
  );
}

function DefectRow({ d, today }: { d: QueueDefect; today: string }): ReactElement {
  const stage = queueStage(d);
  const late = queueDaysLate(d, today);
  const who = [d.assigneeName, tradeLabel(d.trade)].filter(Boolean).join(" · ");
  return (
    <Link to={projectHref(d.projectId)} aria-label={`Open defect: ${d.location ?? "no area"}, ${d.description ?? ""}`}
      style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 14px", padding: "10px 14px", color: "inherit", textDecoration: "none" }}>
      <span style={{ flex: "2 1 260px", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: BETA.muted }}><MapPin size={13} aria-hidden="true" />{d.location ?? "No area given"}</span>
        <span style={{ fontSize: 14, fontWeight: 600, overflowWrap: "anywhere" }}>{d.description ?? "No description"}</span>
      </span>
      <span style={{ flex: "1 1 160px", display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: who ? WS.text2 : WS.amber, fontWeight: who ? 400 : 600 }}>
        <User size={13} aria-hidden="true" />{who || "No one named"}
      </span>
      <span style={{ flex: "1 1 140px", display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: late > 0 ? WS.red : BETA.muted, fontWeight: late > 0 ? 700 : 400 }}>
        <CalendarDays size={13} aria-hidden="true" />
        {stage === "check" ? `Fixed ${d.fixedAt ? dayMonth(mytDay(d.fixedAt)) : ""}` : late > 0 ? `Overdue ${late} day${late === 1 ? "" : "s"}` : d.dueDate ? `Fix by ${dayMonth(d.dueDate)}` : "No fix-by date"}
      </span>
      <WsBadge tone={stage === "check" ? TONE_QUIET : late > 0 ? TONE_ALERT : TONE_WAIT}>{stage === "check" ? "To check" : "To fix"}</WsBadge>
    </Link>
  );
}
