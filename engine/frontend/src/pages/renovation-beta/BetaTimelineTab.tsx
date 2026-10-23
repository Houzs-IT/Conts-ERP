/* Beta workspace > Timeline: the project's existing timeline entries with a search box, a RECORD tag on approvals,
   key passes and the handover, and a CSV export of what is on screen. */

import { useState, type ReactElement } from "react";
import { Clock, Download } from "lucide-react";
import { Button } from "../../components/Button";
import { useQuery } from "../../hooks/useQuery";
import { cn, formatDate, formatDateTime } from "../../lib/utils";
import { Card } from "../projects/renovation/ProjectRecords";
import {
  CATEGORY_LABEL, CHIP_CLASS, FILTERS, RING_CLASS, countByCategory, filterEntries, timelineApi, type TimelineFilter,
} from "../projects/renovation/renovationTimelineModel";
import { inputClass, smallBtn } from "../projects/renovation/renovationUi";
import type { BetaTabProps } from "./betaShared";
import { isRecordEntry, searchEntries, timelineCsv } from "./renovationBetaModel";

export function BetaTimelineTab({ projectId, onDone, onError }: BetaTabProps): ReactElement {
  // Always ask again on opening the tab, so what was just saved on another tab shows.
  const q = useQuery(["renovation-beta", "timeline", projectId], () => timelineApi.list(projectId), [projectId], { refetchOnMount: "always", staleTime: 0 });
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const [search, setSearch] = useState("");
  const entries = q.data?.entries ?? [];
  const counts = countByCategory(entries);
  const shown = searchEntries(filterEntries(entries, filter), search);

  function exportCsv() {
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
    <Card
      title="Timeline"
      icon={<Clock size={14} />}
      actions={<Button variant="secondary" className={smallBtn} icon={<Download size={12} />} disabled={shown.length === 0} onClick={exportCsv}>Export CSV</Button>}
    >
      <div className="mb-3 space-y-2">
        <label className="block text-xs text-ink-secondary">
          <span className="mb-1 block">Search the timeline</span>
          <input type="search" className={inputClass} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Words from the title, text or person" />
        </label>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}
              className={cn("rounded-md px-2.5 py-1 text-xs font-semibold", filter === f ? "bg-primary text-white" : "border border-border bg-surface text-ink-secondary hover:text-ink")}>
              {f === "all" ? "All" : CATEGORY_LABEL[f]}{counts[f] > 0 && <span className="ml-1 tabular-nums">{counts[f]}</span>}
            </button>
          ))}
        </div>
      </div>

      {q.loading && !q.data ? <p className="text-sm text-ink-secondary">Loading the timeline...</p>
        : q.error && !q.data ? <p role="alert" className="text-sm text-err">The timeline could not be loaded: {q.error}</p>
        : shown.length === 0 ? <p className="text-sm text-ink-secondary">{entries.length === 0 ? "No activity yet." : "No entries match."}</p>
        : (
          <ol className="relative space-y-3 pl-5">
            <span aria-hidden className="pointer-events-none absolute bottom-1.5 left-[7px] top-1.5 w-px bg-border" />
            {shown.map((e) => (
              <li key={e.id} className="relative">
                <span aria-hidden className={cn("absolute -left-5 top-1 h-3.5 w-3.5 rounded-full border-2 bg-surface", RING_CLASS[e.category])} />
                <div className="text-xs text-ink-secondary">{e.dateOnly ? formatDate(e.at) : formatDateTime(e.at)}</div>
                {e.title && <div className="text-sm font-semibold text-ink [overflow-wrap:anywhere]">{e.title}</div>}
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-secondary">
                  <span className={cn("rounded px-1.5 py-px text-[10px] font-bold uppercase tracking-wider", CHIP_CLASS[e.category])}>{CATEGORY_LABEL[e.category]}</span>
                  {isRecordEntry(e) && <span className="rounded border border-primary/40 bg-primary/10 px-1.5 py-px text-[10px] font-bold uppercase tracking-wider text-primary">Record</span>}
                  {e.by && <span>by {e.by}</span>}
                </div>
                {e.body && <div className="mt-1 whitespace-pre-line text-sm text-ink-secondary [overflow-wrap:anywhere]">{e.body}</div>}
              </li>
            ))}
          </ol>
        )}
    </Card>
  );
}
