/* Beta > Project workspace: the renovation projects, each opening the Beta workspace (owner, 23 Oct 2026).
   Reads the same rows as the project list; nothing here writes. */

import { useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "../../components/Layout";
import { useQuery } from "../../hooks/useQuery";
import { simpleApi } from "../projects/renovation/simpleApi";
import { shortDate } from "../projects/renovation/renovationModel";
import { Pill, inputClass } from "../projects/renovation/renovationUi";

export function RenovationBetaProjects() {
  const q = useQuery(["renovation-beta", "projects"], () => simpleApi.boardRows(), []);
  const [search, setSearch] = useState("");
  const words = search.trim().toLowerCase();
  const rows = (q.data?.data ?? []).filter((r) =>
    !words || [r.name, r.code, r.building, r.unitNo, r.customerName, r.soDocNo].some((v) => v?.toLowerCase().includes(words)),
  );

  return (
    <div className="pb-10">
      <PageHeader eyebrow="Beta" title="Project workspace" description="Try the new project workspace. It is on staging only and uses the same project data." />
      <div className="mb-3 max-w-sm">
        <input className={inputClass} type="search" placeholder="Search project, unit, customer or SO" aria-label="Search projects" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {q.loading && !q.data && <p className="py-10 text-center text-sm text-ink-secondary">Loading projects...</p>}
      {q.error && <p role="alert" className="py-6 text-sm text-err">The projects could not be loaded: {q.error}</p>}
      {q.data && rows.length === 0 && <p className="py-10 text-center text-sm text-ink-secondary">{words ? "No project matches. Try another word." : "No renovation projects yet."}</p>}
      {rows.length > 0 && <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
        {rows.map((r) => (
          <li key={r.id}>
            <Link to={`/beta/projects/${r.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-surface-dim focus-visible:bg-surface-dim">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-ink">{r.name}</div>
                <div className="truncate text-xs text-ink-secondary">
                  {[r.code, [r.building, r.unitNo].filter(Boolean).join(" "), r.customerName].filter(Boolean).join(" · ")}
                </div>
              </div>
              <Pill tone={r.hold ? "warn" : "info"}>{r.statusText}</Pill>
              <span className="text-xs text-ink-secondary">Handover {shortDate(r.handoverDate ?? r.plannedHandoverDate)}</span>
            </Link>
          </li>
        ))}
      </ul>}
    </div>
  );
}
