/* Project Monitor (/projects?view=monitor): one page instead of the team's Notion
   panels. Role tabs (Sales, Design, Renovation, Admin, Boss) show tiles that count
   each queue; a tile or a red flag narrows the project list below; the person
   filter narrows everything to "my" projects. The site-task calendar sits at the
   bottom. Everything is read from GET /api/renovation/monitor, one request.
   State lives in the URL (tab, person, show) so a view can be shared. */

import { useMemo, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, LayoutList, X } from "lucide-react";
import { PageHeader } from "../../../components/Layout";
import { Button } from "../../../components/Button";
import { useQuery } from "../../../hooks/useQuery";
import { cn } from "../../../lib/utils";
import { simpleApi } from "./simpleApi";
import { TONE_CLASS, money, shortDate, supplyLabel, supplyTone } from "./renovationModel";
import { Pill, inputClass } from "./renovationUi";
import { StatusCell, received } from "./RenovationBoard";
import { RenovationCalendar } from "./RenovationCalendar";
import {
  ROLE_TABS, isMonitorRole, matchesSearch, matchesSelection, monitorApi, roleTabFor, rowReasons, selectionLabel, selectionOf, selectionParam,
  type MonitorData, type MonitorRole, type MonitorRow, type MonitorSelection,
} from "./monitorModel";

function Tile({ label, hint, count, active, tone, onClick }: { label: string; hint?: string; count: number; active: boolean; tone?: "err" | "default"; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={hint}
      className={cn(
        "min-w-0 rounded-lg border bg-surface p-3 text-left transition-colors hover:bg-surface-dim",
        active ? "border-primary ring-2 ring-primary/30" : "border-border",
      )}
    >
      <div className={cn("text-2xl font-semibold tabular-nums", count === 0 ? "text-ink-secondary" : tone === "err" ? "text-err" : "text-ink")}>{count}</div>
      <div className="text-sm font-medium text-ink leading-snug">{label}</div>
      {hint && <div className="mt-0.5 text-xs text-ink-secondary leading-snug line-clamp-2">{hint}</div>}
    </button>
  );
}

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

function SoCell({ r }: { r: MonitorRow }) {
  if (!r.soDocNo) return <span className="text-ink-secondary">Not signed</span>;
  return <Link to={`/scm/sales-orders/${encodeURIComponent(r.soDocNo)}`} onClick={stop} className="text-primary hover:underline">{r.soDocNo}</Link>;
}

function VoCell({ r }: { r: MonitorRow }) {
  if (r.openVo) {
    return <Link to={`/scm/renovation/variation-orders/${r.openVo.id}`} onClick={stop} className="text-primary hover:underline whitespace-nowrap">{r.openVo.voNo}{r.openVo.count > 1 ? ` +${r.openVo.count - 1}` : ""} (open)</Link>;
  }
  return <>{r.vo ? (r.vo.has ? `Yes (${r.vo.count})` : "No") : "-"}</>;
}

function Extras({ r, d }: { r: MonitorRow; d: MonitorData }) {
  const reasons = rowReasons(r, d.paymentNormPct);
  const flags = r.flags.filter((f) => f !== "in_defect");
  if (!reasons.length && !flags.length && !r.openQuotation && !r.worksBeforeGateText) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {flags.includes("no_so_after_days") && <Pill tone="err">No SO after {d.noSoFlagDays} days</Pill>}
      {flags.includes("handed_over_unpaid") && <Pill tone="err">Handed over, not fully paid</Pill>}
      {r.worksBeforeGateText && <Pill tone="warn" title="A warning only: the gate does not stop the works">{r.worksBeforeGateText}</Pill>}
      {reasons.map((x) => <Pill key={x} tone="warn">{x}</Pill>)}
      {r.openQuotation && (
        <Link to={`/scm/renovation/quotations/${r.openQuotation.id}`} onClick={stop} className="inline-flex">
          <Pill tone="info">Quotation {r.openQuotation.quoteNo} open</Pill>
        </Link>
      )}
    </div>
  );
}

function RowsTable({ rows, d, open }: { rows: MonitorRow[]; d: MonitorData; open: (id: number) => void }) {
  return (
    <div className="hidden lg:block overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full text-sm">
        <thead className="bg-surface-dim text-left text-xs uppercase tracking-wide text-ink-secondary">
          <tr>
            <th className="px-3 py-2">Building</th>
            <th className="px-3 py-2 min-w-[13rem]">Project</th>
            <th className="px-3 py-2">SO no.</th>
            <th className="px-3 py-2">Sales</th>
            <th className="px-3 py-2 text-right">Contract total</th>
            <th className="px-3 py-2 text-right">Received</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Furniture</th>
            <th className="px-3 py-2">Reno items</th>
            <th className="px-3 py-2">Key holder</th>
            <th className="px-3 py-2">VO</th>
            <th className="px-3 py-2">Handover</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border hover:bg-surface-dim cursor-pointer align-top" onClick={() => open(r.id)}>
              <td className="px-3 py-2 whitespace-nowrap">{r.building ?? "-"}</td>
              <td className="px-3 py-2">
                <Link to={`/projects/${r.id}`} onClick={stop} className="font-medium text-ink hover:underline">{r.name}</Link>
                <div className="text-xs text-ink-secondary">{[r.code, r.customerName, r.designer?.name && `Design: ${r.designer.name}`].filter(Boolean).join(" · ")}</div>
                <Extras r={r} d={d} />
              </td>
              <td className="px-3 py-2 whitespace-nowrap"><SoCell r={r} /></td>
              <td className="px-3 py-2">{r.sales.name ?? "-"}</td>
              <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{r.moneyHidden ? "Hidden" : r.soDocNo ? money(r.contractSen) : "-"}</td>
              <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{received(r)}</td>
              <td className="px-3 py-2"><StatusCell r={r} /></td>
              <td className="px-3 py-2">{r.soDocNo ? <Pill tone={supplyTone(r.furnitureArrival)}>{supplyLabel(r.furnitureArrival)}</Pill> : "-"}</td>
              <td className="px-3 py-2">{r.soDocNo ? <Pill tone={supplyTone(r.renoItemArrival)}>{supplyLabel(r.renoItemArrival)}</Pill> : "-"}</td>
              <td className="px-3 py-2 whitespace-nowrap">{r.keyHolder?.name ?? "-"}</td>
              <td className="px-3 py-2"><VoCell r={r} /></td>
              <td className="px-3 py-2 whitespace-nowrap">{r.handoverDate ? shortDate(r.handoverDate) : r.plannedHandoverDate ? <span className="text-ink-secondary">plan {shortDate(r.plannedHandoverDate)}</span> : "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RowCards({ rows, d, open }: { rows: MonitorRow[]; d: MonitorData; open: (id: number) => void }) {
  return (
    <ul className="lg:hidden space-y-2">
      {rows.map((r) => (
        <li key={r.id}>
          <div role="link" tabIndex={0} onClick={() => open(r.id)} onKeyDown={(e) => { if (e.key === "Enter") open(r.id); }}
            className="w-full cursor-pointer rounded-lg border border-border bg-surface p-3 text-left">
            <div className="min-w-0">
              <div className="font-medium text-ink break-words">{r.name}</div>
              <div className="text-xs text-ink-secondary break-words">{[r.building, r.unitNo, r.customerName].filter(Boolean).join(" · ") || "-"}</div>
            </div>
            <div className="mt-2 text-sm"><StatusCell r={r} /></div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <div className="min-w-0"><dt className="text-ink-secondary">SO</dt><dd className="truncate"><SoCell r={r} /></dd></div>
              <div className="min-w-0"><dt className="text-ink-secondary">Sales</dt><dd className="text-ink truncate">{r.sales.name ?? "-"}</dd></div>
              <div className="min-w-0"><dt className="text-ink-secondary">Contract</dt><dd className="text-ink tabular-nums">{r.moneyHidden ? "Hidden" : r.soDocNo ? money(r.contractSen) : "-"}</dd></div>
              <div className="min-w-0"><dt className="text-ink-secondary">Received</dt><dd className="text-ink tabular-nums">{received(r)}</dd></div>
              <div className="min-w-0"><dt className="text-ink-secondary">Key holder</dt><dd className="text-ink truncate">{r.keyHolder?.name ?? "-"}</dd></div>
              <div className="min-w-0"><dt className="text-ink-secondary">Handover</dt><dd className="text-ink">{r.handoverDate ? shortDate(r.handoverDate) : r.plannedHandoverDate ? `plan ${shortDate(r.plannedHandoverDate)}` : "-"}</dd></div>
              <div className="min-w-0"><dt className="text-ink-secondary">VO</dt><dd className="text-ink truncate"><VoCell r={r} /></dd></div>
            </dl>
            {r.soDocNo && (
              <div className="mt-2 flex flex-wrap gap-1">
                <Pill tone={supplyTone(r.furnitureArrival)}>Furniture: {supplyLabel(r.furnitureArrival)}</Pill>
                <Pill tone={supplyTone(r.renoItemArrival)}>Reno: {supplyLabel(r.renoItemArrival)}</Pill>
              </div>
            )}
            <Extras r={r} d={d} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="mt-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function ProjectMonitor({ canWrite }: { canWrite: boolean }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const personId = Number(params.get("person")) || null;
  const people = useQuery(["renovation", "people", "active"], () => simpleApi.people({ active: true }), [], { staleTime: 5 * 60_000 });
  const person = (people.data?.data ?? []).find((p) => p.id === personId) ?? null;
  const rawTab = params.get("tab");
  const tab: MonitorRole = isMonitorRole(rawTab) ? rawTab : (roleTabFor(person?.roles) ?? "boss");
  const sel = selectionOf(params.get("show"));
  const search = params.get("q") ?? "";
  const q = useQuery(["renovation", "monitor", personId ?? 0], () => monitorApi.get(personId), [personId]);
  const d = q.data ?? null;

  const set = (patch: Record<string, string | null>) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) { if (v == null || v === "") next.delete(k); else next.set(k, v); }
      return next;
    }, { replace: true });
  };
  const pick = (s: MonitorSelection) => set({ show: selectionParam(s) === params.get("show") ? null : selectionParam(s) });

  const rows = useMemo(() => (d?.rows ?? []).filter((r) => matchesSelection(r, sel) && matchesSearch(r, search)), [d, sel, search]);
  const open = (id: number) => navigate(`/projects/${id}`);
  const tabQueues = (d?.queues ?? []).filter((x) => x.role === tab);
  const flags = (d?.flags ?? []).filter((f) => f.count > 0);
  const isSel = (s: MonitorSelection) => selectionParam(s) === selectionParam(sel);

  return (
    <div className="min-w-0">
      <PageHeader
        eyebrow="Operations · Projects"
        title="Project monitor"
        description="What needs doing, per team. Each count comes from its own module: the sales order, quotations and VOs, purchases and receipts, site tasks, design records."
        actions={<Button variant="secondary" icon={<LayoutList size={16} />} onClick={() => navigate("/projects?view=list")}>Project list</Button>}
      />

      <div className="flex flex-col sm:flex-row gap-2 mb-3">
        <select className={inputClass + " sm:max-w-xs"} value={personId ?? ""} aria-label="Person"
          onChange={(e) => set({ person: e.target.value || null, tab: null, show: null })}>
          <option value="">Everyone's projects</option>
          {(people.data?.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input className={inputClass + " sm:max-w-xs"} placeholder="Search building, unit, customer, SO, people" value={search}
          onChange={(e) => set({ q: e.target.value || null })} aria-label="Search projects" />
      </div>

      <div role="tablist" aria-label="Team" className="flex flex-wrap gap-1 border-b border-border mb-3">
        {ROLE_TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} title={t.who}
            onClick={() => set({ tab: t.key, show: null })}
            className={cn("px-3 py-2 text-sm font-medium -mb-px border-b-2", tab === t.key ? "border-primary text-primary" : "border-transparent text-ink-secondary hover:text-ink")}>
            {t.label}
          </button>
        ))}
      </div>

      {q.loading && !d && <p className="text-sm text-ink-secondary py-8 text-center">Loading the monitor...</p>}
      {q.error && <p role="alert" className="text-sm text-err py-4">The monitor could not be loaded: {q.error}</p>}

      {d && (
        <>
          <div aria-label="Red flags" className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
            <span className="inline-flex items-center gap-1 text-sm font-medium text-ink"><AlertTriangle size={14} className={flags.length ? "text-err" : "text-ink-secondary"} />Red flags</span>
            {flags.length === 0 && <span className="text-sm text-ink-secondary">None right now.</span>}
            {flags.map((f) => (
              <button key={f.key} type="button" aria-pressed={isSel({ kind: "flag", key: f.key })} onClick={() => pick({ kind: "flag", key: f.key })}
                className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium",
                  f.key === "works_before_gate" ? TONE_CLASS.warn : TONE_CLASS.err,
                  isSel({ kind: "flag", key: f.key }) && "ring-2 ring-primary/30")}>
                {f.key === "no_so_after_days" ? `No SO after ${d.noSoFlagDays} days` : f.label}
                <span className="tabular-nums font-semibold">{f.count}</span>
              </button>
            ))}
          </div>

          {d.moneyHidden && <p className="mb-3 text-xs text-ink-secondary">Amounts are hidden for your role, so the payment queues stay empty.</p>}

          {tab === "boss" && (
            <div className="mb-3 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2" aria-label="Projects by step">
              {d.steps.map((s, i) => (
                <Tile key={s.key} label={`${i + 1}. ${s.label}`} count={d.stepCounts[s.key] ?? 0} active={isSel({ kind: "step", key: s.key })} onClick={() => pick({ kind: "step", key: s.key })} />
              ))}
              <Tile label="On hold" count={d.holdCounts.on_hold} active={isSel({ kind: "hold", key: "on_hold" })} onClick={() => pick({ kind: "hold", key: "on_hold" })} />
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2" aria-label="Queues">
            {tabQueues.map((x) => (
              <Tile key={x.key} label={x.label} hint={x.hint} count={x.count} tone={x.key === "sales_ongoing" || x.key === "boss_closed" || x.key === "reno_in_progress" || x.key === "design_in_design" ? "default" : "err"}
                active={isSel({ kind: "queue", key: x.key })} onClick={() => pick({ kind: "queue", key: x.key })} />
            ))}
          </div>

          <Section
            title={`${selectionLabel(sel, d)} (${rows.length})`}
            actions={sel.kind !== "all" ? <Button variant="ghost" icon={<X size={14} />} onClick={() => set({ show: null })}>Show all projects</Button> : undefined}
          >
            {rows.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-ink-secondary">
                {d.rows.length === 0 ? (personId ? "No project has this person on it." : "No renovation projects yet.") : "Nothing here. Good."}
              </p>
            ) : (
              <>
                <RowsTable rows={rows} d={d} open={open} />
                <RowCards rows={rows} d={d} open={open} />
              </>
            )}
          </Section>
        </>
      )}

      <Section title="Site calendar">
        <RenovationCalendar key={personId ?? 0} canWrite={canWrite} embedded initialPersonId={person?.roles.includes("site_crew") ? person.id : null} />
      </Section>
    </div>
  );
}
