/* Beta workspace > Timeline, laid out as the mockup's Timeline view: a search box, Export, filter chips, and one card
   per day with a round icon per entry, a RECORD tag on approvals, key passes and the handover, and a CSV export of what
   is on screen. The engine's categories take the mockup's icons and colours. */

import { useMemo, useState, type ReactElement, type ReactNode } from "react";
import { useQuery } from "../../hooks/useQuery";
import {
  CATEGORY_LABEL, FILTERS, countByCategory, filterEntries, type TimelineCategory, type TimelineEntry,
} from "../projects/renovation/renovationTimelineModel";
import { WS, WsEmpty, WsFilterPill, WsPageHead, WsTag, btnStyle, cardStyle } from "./BetaWsUi";
import type { BetaTabProps } from "./betaShared";
import { dayHeading, groupByDay, isRecordEntry, mytDay, mytTime, plainTimelineEntry, searchEntries, timelineCsv } from "./renovationBetaModel";
import { betaSiteApi } from "./renovationBetaSiteApi";
import { BETA, TONES, type BetaTone } from "./renovationBetaTheme";
import type { BetaTabKey } from "./renovationBetaTabs";

const TONE: Readonly<Record<TimelineCategory, BetaTone>> = {
  site: [TONES.accent.ink, TONES.accent.soft],
  design: [TONES.grey.ink, TONES.grey.soft],
  customer: [TONES.grey.ink, TONES.grey.soft],
  supplier: [TONES.amber.ink, TONES.amber.soft],
  sales: [TONES.accent.ink, TONES.accent.soft],
  system: [TONES.grey.ink, TONES.grey.soft],
};

const TAB_NAME: Readonly<Partial<Record<BetaTabKey, string>>> = { drawings: "Drawings", site: "Site and photos", defects: "Defects", overview: "Overview" };

/** The tab an entry opens: drawings for design, the deliveries for supplier entries, the pipeline for a defect. */
function opensTab(e: Pick<TimelineEntry, "category" | "title">): BetaTabKey | null {
  if (e.category === "design") return "drawings";
  if (e.category === "supplier") return "site";
  if (e.category === "site") return /defect/i.test(e.title ?? "") ? "defects" : "site";
  if (e.category === "sales" && /payment/i.test(e.title ?? "")) return "overview";
  return null;
}

function Icon({ category }: { category: TimelineCategory }): ReactElement {
  const paths: Record<TimelineCategory, ReactNode> = {
    site: <><path d="M3 21h18M5 21V10l7-5 7 5v11" /><path d="M10 21v-6h4v6" /></>,
    design: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
    customer: <><circle cx="12" cy="8" r="4" /><path d="M4 21c.6-4.5 4-7 8-7s7.4 2.5 8 7" /></>,
    supplier: <><path d="M3 4h3l2.5 11h10L21 7H7" /><circle cx="10" cy="19" r="1.4" /><circle cx="17" cy="19" r="1.4" /></>,
    sales: <><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18" /></>,
    system: <><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M17 6l3 3" /></>,
  };
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">{paths[category]}</svg>;
}

export function BetaTimelineTab({ projectId, today, onDone, onError, openTab }: BetaTabProps): ReactElement {
  // Always ask again on opening the tab, so what was just saved on another tab shows.
  const q = useQuery(["renovation-beta", "timeline", projectId], () => betaSiteApi.timeline(projectId), [projectId], { refetchOnMount: "always", staleTime: 0 });
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [search, setSearch] = useState("");
  const entries = useMemo(() => (q.data?.entries ?? []).map(plainTimelineEntry), [q.data]);
  const counts = countByCategory(entries);
  const shown = searchEntries(filterEntries(entries, filter), search);
  const days = groupByDay(shown, (e) => mytDay(e.at));

  function exportCsv(): void {
    try {
      // The byte order mark lets Excel read the accents and names as UTF-8.
      const blob = new Blob(["﻿", timelineCsv(shown)], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `project-${projectId}-timeline.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onDone(`Exported ${shown.length} timeline ${shown.length === 1 ? "entry" : "entries"}.`);
    } catch (e) {
      onError(`The timeline could not be exported: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <>
      <WsPageHead
        title="Timeline"
        sub={<>Everything on this project, newest first · filled in automatically · <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><WsTag>RECORD</WsTag></span> = approvals, key passes and the handover kept as proof</>}
        right={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 40, padding: "0 12px", border: `1px solid ${BETA.border}`, borderRadius: 8, background: BETA.surface, minWidth: 0 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={BETA.muted} strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
              <span className="sr">Search timeline</span>
              <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search, e.g. sink" style={{ border: 0, outline: "none", font: "inherit", width: 160, maxWidth: "100%", background: "transparent", color: BETA.ink }} />
            </label>
            <button type="button" disabled={shown.length === 0} onClick={exportCsv} title="Download what is on screen as a CSV file" style={btnStyle("outline", "md")}>Export record</button>
          </div>
        }
      />

      <div role="group" aria-label="Filter timeline" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {FILTERS.map((f) => (
          <WsFilterPill key={f} on={filter === f} onClick={() => setFilter(f)}>
            {f === "all" ? "All" : CATEGORY_LABEL[f]}{counts[f] > 0 && <> <span style={{ opacity: 0.7 }}>{counts[f]}</span></>}
          </WsFilterPill>
        ))}
      </div>

      {q.loading && !q.data ? <p style={{ fontSize: 14, color: BETA.muted }}>Loading the timeline...</p>
        : q.error && !q.data ? <p role="alert" style={{ fontSize: 14, color: WS.red }}>The timeline could not be loaded: {q.error}</p>
        : shown.length === 0 ? <WsEmpty>{entries.length === 0 ? "No activity yet." : "Nothing matches. Try another word or filter."}</WsEmpty>
        : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {days.map((g) => (
              <section key={g.day ?? "undated"} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: BETA.muted, textTransform: "uppercase", letterSpacing: ".06em" }}>
                  {g.day === today ? `Today · ${dayHeading(g.day, today)}` : g.day ? dayHeading(g.day, today) : "No date"}
                </h3>
                <ol style={{ ...cardStyle, listStyle: "none", margin: 0, padding: 0, gap: 0, overflow: "hidden" }}>
                  {g.items.map((e, i) => <EntryRow key={e.id} e={e} first={i === 0} openTab={openTab} />)}
                </ol>
              </section>
            ))}
          </div>
        )}
    </>
  );
}

function EntryRow({ e, first, openTab }: { e: TimelineEntry; first: boolean; openTab: (tab: BetaTabKey) => void }): ReactElement {
  const [ink, bg] = TONE[e.category];
  const time = e.dateOnly ? null : mytTime(e.at);
  const target = opensTab(e);
  return (
    <li style={{ display: "flex", gap: 14, alignItems: "flex-start", padding: "14px 16px", borderTop: first ? undefined : `1px solid ${WS.rowLine}` }}>
      <span style={{ flex: "none", width: 36, height: 36, borderRadius: 18, background: bg, color: ink, display: "flex", alignItems: "center", justifyContent: "center" }}><Icon category={e.category} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 8px" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: ink }}>{CATEGORY_LABEL[e.category]}</span>
          {isRecordEntry(e) && <WsTag>RECORD</WsTag>}
          {time && <span style={{ fontSize: 12, color: BETA.muted, fontVariantNumeric: "tabular-nums" }}>{time}</span>}
        </div>
        {e.title && <div style={{ marginTop: 2, fontWeight: 600, overflowWrap: "anywhere" }}>{e.title}</div>}
        {e.by && <div style={{ fontSize: 13, color: BETA.muted }}>{e.by}</div>}
        {e.body && <div style={{ marginTop: 4, whiteSpace: "pre-line", fontSize: 14, color: WS.text2, overflowWrap: "anywhere" }}>{e.body}</div>}
      </div>
      {target && <button type="button" className="link" style={{ flex: "none", alignSelf: "center", textDecoration: "none" }} onClick={() => openTab(target)}>Open →<span className="sr"> {TAB_NAME[target] ?? ""}</span></button>}
    </li>
  );
}
