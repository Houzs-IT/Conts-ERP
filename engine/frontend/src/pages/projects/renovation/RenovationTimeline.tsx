/* Timeline card of a renovation project (owner, 15 Oct 2026): the service case timeline's look (filter chips,
   "+ Add note", entries with time, type chip, "by", text) on the project page. System entries are read from the
   project's own history by the server; notes added here are typed Customer / Design / Supplier / Site / Sales.
   `refreshKey` changes whenever the page saved something, so the new System entry shows without a reload. */

import { useEffect, useState } from "react";
import { Clock, Plus, Trash2 } from "lucide-react";
import { useQuery } from "../../../hooks/useQuery";
import { useDialog } from "../../../hooks/useDialog";
import { cn, formatDate, formatDateTime } from "../../../lib/utils";
import { errorText } from "./renovationModel";
import {
  CATEGORY_LABEL, CHIP_CLASS, FILTERS, NOTE_MAX, NOTE_TYPES, RING_CLASS, countByCategory, filterEntries, timelineApi,
  type TimelineFilter, type TimelineNoteType,
} from "./renovationTimelineModel";

export function RenovationTimeline({ projectId, canWrite, refreshKey = 0 }: { projectId: number; canWrite: boolean; refreshKey?: number }) {
  const dialog = useDialog();
  const q = useQuery(["renovation", "timeline", projectId], () => timelineApi.list(projectId), [projectId]);
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const [formOpen, setFormOpen] = useState(false);
  const [type, setType] = useState<TimelineNoteType>("customer");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reload = q.reload;
  useEffect(() => { if (refreshKey) reload(); }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps -- reload on the page's saves only

  const entries = q.data?.entries ?? [];
  const counts = countByCategory(entries);
  const shown = filterEntries(entries, filter);
  const notesReady = q.data?.notesReady !== false;

  async function post() {
    const note = text.trim();
    if (!note || busy) return;
    setBusy(true);
    setError(null);
    try {
      await timelineApi.addNote(projectId, { type, note });
      setText("");
      setFormOpen(false);
      reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function archive(noteId: number) {
    if (!(await dialog.confirm("Archive this note? It is hidden from the timeline."))) return;
    try { await timelineApi.archiveNote(noteId); reload(); } catch (e) { setError(errorText(e)); }
  }

  return (
    <section id="reno-timeline" aria-label="Timeline" className="rounded-lg border border-border bg-surface p-3">
      <div className="mb-2 flex items-center gap-2">
        <Clock size={13} className="shrink-0 text-ink-muted" />
        <h3 className="flex-1 text-[10.5px] font-bold uppercase tracking-wide text-ink-secondary">Timeline</h3>
        {canWrite && notesReady && (
          <button type="button" onClick={() => { setFormOpen((x) => !x); setError(null); }}
            className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white shadow-sm hover:bg-accent/90">
            <Plus size={11} /> Add note
          </button>
        )}
      </div>

      {formOpen && canWrite && (
        <div className="mb-3 rounded-md border border-accent/30 bg-accent-soft/15 p-2">
          <div className="mb-2 flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Note type">
            {NOTE_TYPES.map((t) => (
              <button key={t} type="button" role="radio" aria-checked={type === t} onClick={() => setType(t)}
                className={cn("rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider",
                  type === t ? cn(CHIP_CLASS[t], "ring-2 ring-offset-1 ring-ink/30") : "border border-border bg-surface text-ink-muted hover:text-ink")}>
                {CATEGORY_LABEL[t]}
              </button>
            ))}
          </div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={NOTE_MAX} rows={2} aria-label="Note"
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void post(); }}
            placeholder={`${CATEGORY_LABEL[type]} note...`}
            className="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-[12px] outline-none focus:border-primary" />
          <div className="mt-2 flex items-center gap-2">
            <button type="button" onClick={() => { setText(""); setFormOpen(false); setError(null); }}
              className="rounded-md border border-border bg-surface px-3 py-1.5 text-[11px] font-semibold text-ink-secondary hover:text-ink">Cancel</button>
            <button type="button" onClick={() => void post()} disabled={!text.trim() || busy}
              className="ml-auto rounded-md bg-accent px-4 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white disabled:opacity-50">
              {busy ? "Posting..." : "Post note"}
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mb-2 text-[12px] text-err">{error}</p>}

      <div className="mb-3 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const active = filter === f;
          return (
            <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={active}
              className={cn("rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors",
                active ? "bg-primary text-white" : "border border-border bg-bg text-ink-muted hover:text-ink")}>
              {f === "all" ? "All" : CATEGORY_LABEL[f]}
              {counts[f] > 0 && <span className={cn("ml-1 tabular-nums", active ? "text-white/80" : "text-ink-muted")}>{counts[f]}</span>}
            </button>
          );
        })}
      </div>

      {q.loading && !q.data ? (
        <div className="space-y-2" aria-hidden>
          {[0, 1, 2].map((i) => <div key={i} className="h-9 animate-pulse rounded bg-surface-dim" />)}
        </div>
      ) : q.error && !q.data ? (
        <p role="alert" className="text-[12px] text-err">The timeline could not be loaded: {q.error}</p>
      ) : shown.length === 0 ? (
        <div className="text-[12px] text-ink-muted">{entries.length === 0 ? "No activity yet" : `No ${CATEGORY_LABEL[filter as Exclude<TimelineFilter, "all">]} entries`}</div>
      ) : (
        <div className="overflow-x-hidden lg:max-h-[28rem] lg:overflow-y-auto lg:pr-1">
          {/* A box of its own only beside the work column (lg); on a phone a scroll area inside the page scroll was a second scrollbar. */}
          <ol className="relative space-y-3 pl-5">
            <span className="pointer-events-none absolute bottom-1.5 left-[7px] top-1.5 w-px bg-border" />
            {shown.map((e) => (
              <li key={e.id} className="group relative">
                <span className={cn("absolute -left-5 top-1 h-3.5 w-3.5 rounded-full border-2 bg-surface", RING_CLASS[e.category])} />
                <div className="flex items-center gap-2 text-[10.5px] text-ink-muted">
                  <span>{e.dateOnly ? formatDate(e.at) : formatDateTime(e.at)}</span>
                  {canWrite && e.noteId != null && (
                    <button type="button" onClick={() => void archive(e.noteId!)} title="Archive note" aria-label="Archive note"
                      className="ml-auto rounded p-0.5 text-ink-muted transition-opacity hover:text-err sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100">
                      <Trash2 size={10} />
                    </button>
                  )}
                </div>
                {e.title && <div className="text-[12.5px] font-bold text-ink [overflow-wrap:anywhere]">{e.title}</div>}
                <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-ink-muted">
                  <span className={cn("rounded px-1.5 py-[1px] text-[9px] font-bold uppercase tracking-wider", CHIP_CLASS[e.category])}>{CATEGORY_LABEL[e.category]}</span>
                  {e.by && <span className="truncate">by {e.by}</span>}
                </div>
                {e.body && (
                  <div className={cn("mt-1 whitespace-pre-line [overflow-wrap:anywhere]", e.title ? "text-[12px] text-ink-secondary" : "text-[12.5px] text-ink")}>{e.body}</div>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
