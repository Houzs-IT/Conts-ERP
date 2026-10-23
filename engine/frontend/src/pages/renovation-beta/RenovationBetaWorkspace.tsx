/* Beta > Project workspace for one renovation project (owner, 23 Oct 2026; mockup "Renovation Project
   Workspace"): the header, the six steps and the tabs. Bundle A fills Overview, Drawings, Site & photos, Defects
   and Timeline; VO, PO and Client PO say so until bundle B (docs/superpowers/plans/2026-10-23-beta-project-workspace.md).
   The project, the workspace and the design records are loaded here once and handed to the tabs; every write
   shows a notice and reloads all three. */

import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { PageHeader } from "../../components/Layout";
import { useQuery } from "../../hooks/useQuery";
import { cn } from "../../lib/utils";
import { todayMyt } from "../projects/renovation/ProjectRecords";
import { simpleApi, type ProjectDetailV2 } from "../projects/renovation/simpleApi";
import { shortDate } from "../projects/renovation/renovationModel";
import { Pill } from "../projects/renovation/renovationUi";
import { BetaDefectsTab } from "./BetaDefectsTab";
import { BetaDrawingsTab } from "./BetaDrawingsTab";
import { BetaOverviewTab } from "./BetaOverviewTab";
import { BetaSiteTab } from "./BetaSiteTab";
import { BetaTimelineTab } from "./BetaTimelineTab";
import type { BetaTabProps } from "./betaShared";
import { betaApi } from "./renovationBetaApi";
import { BETA_TABS, tabFromParam, type BetaTabKey } from "./renovationBetaTabs";

const DAY_MS = 86_400_000;

function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  const today = new Date(new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10));
  return Math.round((new Date(iso.slice(0, 10)).getTime() - today.getTime()) / DAY_MS);
}

export function RenovationBetaWorkspace() {
  const id = Number(useParams().id);
  const [params, setParams] = useSearchParams();
  const tab = tabFromParam(params.get("tab"));
  const valid = Number.isInteger(id) && id > 0;
  const q = useQuery(["renovation-beta", "detail", id], () => simpleApi.detail(id), [id], { enabled: valid });
  const ws = useQuery(["renovation-beta", "workspace", id], () => betaApi.workspace(id), [id], { enabled: valid });
  const rec = useQuery(["renovation-beta", "records", id], () => simpleApi.designRecords(id), [id], { enabled: valid });
  const { can } = useAuth();
  const [notice, setNotice] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const d = q.data;

  if (!valid) return <p role="alert" className="py-6 text-sm text-err">This project address is not valid.</p>;
  if (q.loading && !d) return <p className="py-10 text-center text-sm text-ink-secondary">Loading project...</p>;
  if (q.error || !d) return <p role="alert" className="py-6 text-sm text-err">The project could not be loaded: {q.error ?? "not found"}</p>;

  const p = d.project;
  const handover = p.handed_over_at ?? p.planned_handover_date;
  const left = p.handed_over_at ? null : daysLeft(p.planned_handover_date);
  const current = BETA_TABS.find((t) => t.key === tab) ?? BETA_TABS[0];
  const reloadAll = () => { q.reload(); ws.reload(); rec.reload(); };
  const openTab = (key: BetaTabKey) => setParams((prev) => { const next = new URLSearchParams(prev); next.set("tab", key); return next; }, { replace: true });
  const props: BetaTabProps | null = ws.data && rec.data
    ? {
        projectId: id, detail: d, workspace: ws.data, records: rec.data, canWrite: can("projects.write"), today: todayMyt(), openTab,
        onDone: (text) => { setNotice({ tone: "ok", text }); reloadAll(); },
        onError: (text) => setNotice({ tone: "err", text }),
      }
    : null;

  return (
    <div className="pb-10">
      <PageHeader
        back="/beta/projects"
        eyebrow={`Beta · ${[p.code, [p.building, p.unit_no].filter(Boolean).join(" ")].filter(Boolean).join(" · ")}`}
        title={p.name}
        description={[
          p.customer_name,
          d.type?.name,
          handover ? `Handover ${shortDate(handover)}${left == null ? "" : left >= 0 ? ` (${left} days left)` : ` (${-left} days late)`}` : "No handover date yet",
        ].filter(Boolean).join(" · ")}
        actions={<Link to={`/projects/${id}`} className="text-sm text-primary underline-offset-2 hover:underline">Open the current project page</Link>}
      />

      <TeamLine d={d} />
      <StepStrip d={d} />

      <nav aria-label="Workspace sections" className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
        {BETA_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            aria-current={t.key === tab ? "page" : undefined}
            onClick={() => { setNotice(null); openTab(t.key); }}
            className={cn(
              "shrink-0 border-b-2 px-3 py-2 text-sm",
              t.key === tab ? "border-primary font-medium text-ink" : "border-transparent text-ink-secondary hover:text-ink",
            )}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div aria-live="polite">
        {notice && (
          <div role={notice.tone === "err" ? "alert" : "status"} className={cn("mb-3 rounded-md border px-3 py-2 text-sm", notice.tone === "err" ? "border-err/30 bg-err-bg text-err" : "border-synced/30 bg-synced-bg text-synced")}>
            {notice.text}
          </div>
        )}
      </div>

      {current.bundle !== "A" ? (
        <section aria-label={current.label} className="rounded-lg border border-dashed border-border bg-surface px-4 py-10 text-center">
          <h2 className="text-sm font-medium text-ink">{current.label}</h2>
          <p className="mt-1 text-sm text-ink-secondary">This section is being built (part {current.bundle} of the Beta plan).</p>
        </section>
      ) : ws.error || rec.error ? (
        <p role="alert" className="py-6 text-sm text-err">This section could not be loaded: {ws.error ?? rec.error}</p>
      ) : !props ? (
        <p className="py-10 text-center text-sm text-ink-secondary">Loading {current.label.toLowerCase()}...</p>
      ) : (
        <section aria-label={current.label}>
          {tab === "overview" && <BetaOverviewTab {...props} />}
          {tab === "drawings" && <BetaDrawingsTab {...props} />}
          {tab === "site" && <BetaSiteTab {...props} />}
          {tab === "defects" && <BetaDefectsTab {...props} />}
          {tab === "timeline" && <BetaTimelineTab {...props} />}
        </section>
      )}
    </div>
  );
}

function TeamLine({ d }: { d: ProjectDetailV2 }) {
  const team: Array<[string, string | null]> = [
    ["Designer", d.people.designer.name],
    ["Sales", d.people.sales.name],
    ["Project PIC", d.people.pic.name ?? d.people.renoPic.name],
    ["Key with", d.keyHolder?.name ?? null],
  ];
  return (
    <dl className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-xs">
      {team.map(([label, name]) => (
        <div key={label} className="flex items-center gap-1.5"><dt className="text-ink-secondary">{label}</dt><dd className="font-medium text-ink">{name ?? "-"}</dd></div>
      ))}
    </dl>
  );
}

function StepStrip({ d }: { d: ProjectDetailV2 }) {
  const { steps, currentIndex } = d.flow;
  return (
    <ol aria-label="Project steps" className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {steps.map((s, i) => (
        <li
          key={s.key}
          aria-current={i === currentIndex ? "step" : undefined}
          className={cn(
            "rounded-md border px-3 py-2 text-xs",
            i === currentIndex ? "border-primary bg-primary/10 text-ink" : i < currentIndex ? "border-border bg-surface text-ink-secondary" : "border-border bg-surface-dim text-ink-secondary",
          )}
        >
          <div className="font-medium">{s.label}</div>
          <div>{i < currentIndex ? "Done" : i === currentIndex ? "Now" : "Later"}</div>
          {i === currentIndex && d.hold && <div className="mt-1"><Pill tone="warn">{d.hold.flag === "in_defect" ? "In defect" : "On hold"}</Pill></div>}
        </li>
      ))}
    </ol>
  );
}
