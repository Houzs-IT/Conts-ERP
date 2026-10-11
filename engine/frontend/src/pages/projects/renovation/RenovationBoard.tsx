/* Renovation project board (owner decisions 11 Oct 2026, replaces the Notion
   "Project" table): Building, Project, SO no., Sales, Contract total, Received
   (%), Status (step + IN DEFECT / ON HOLD), Furniture and Reno-item arrival, Key
   holder, VO and Handover date. Everything is read from its own module: money
   from the sales order, arrival from POs and receipts, the key from the key log.
   Table on desktop, cards on a phone. */

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CalendarDays, Plus } from "lucide-react";
import { PageHeader } from "../../../components/Layout";
import { Button } from "../../../components/Button";
import { useQuery } from "../../../hooks/useQuery";
import { simpleApi, type BoardRowV2 } from "./simpleApi";
import { money, shortDate, supplyLabel, supplyTone } from "./renovationModel";
import { Pill, inputClass } from "./renovationUi";
import { CreateRenovationPanel } from "./CreateRenovationPanel";

/** Search words over building, unit, project, customer, SO and sales; step filter by key; "hold" = flagged only. */
export function matchesBoardFilter(r: Pick<BoardRowV2, "code" | "name" | "building" | "unitNo" | "customerName" | "soDocNo" | "sales" | "step" | "hold">, q: string, step: string): boolean {
  if (step === "hold") { if (!r.hold) return false; }
  else if (step && r.step.key !== step) return false;
  if (!q.trim()) return true;
  const hay = [r.code, r.name, r.building, r.unitNo, r.customerName, r.soDocNo, r.sales.name].filter(Boolean).join(" ").toLowerCase();
  return q.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
}

function received(r: BoardRowV2): string {
  if (r.moneyHidden) return "Hidden";
  if (!r.soDocNo) return "-";
  if (r.receivedSen == null) return "Not available";
  return `${money(r.receivedSen)}${r.receivedPct != null ? ` (${r.receivedPct}%)` : ""}`;
}

function StatusCell({ r }: { r: BoardRowV2 }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {r.hold && <Pill tone="err">{r.hold.label}</Pill>}
      <span className="whitespace-nowrap" title={r.step.manual ? "Set by hand" : undefined}>{r.step.index + 1}. {r.step.label}{r.step.manual ? " *" : ""}</span>
    </span>
  );
}

export function RenovationBoard({ canCreate }: { canCreate: boolean }) {
  const navigate = useNavigate();
  const q = useQuery(["renovation", "board-rows"], () => simpleApi.boardRows());
  const steps = useQuery(["renovation", "flow-steps"], () => simpleApi.flowSteps(), [], { staleTime: 5 * 60_000 });
  const [search, setSearch] = useState("");
  const [step, setStep] = useState("");
  const [creating, setCreating] = useState(false);
  const rows = useMemo(() => (q.data?.data ?? []).filter((r) => matchesBoardFilter(r, search, step)), [q.data, search, step]);
  const open = (id: number) => navigate(`/projects/${id}`);

  return (
    <div>
      <PageHeader
        eyebrow="Operations · Projects"
        title="Renovation projects"
        description="Every project with its step, contract and arrivals. Each fact comes from its own module: the sales order, purchase orders and receipts, the key log."
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" icon={<CalendarDays size={16} />} onClick={() => navigate("/projects?view=calendar")}>Calendar</Button>
            {canCreate && <Button icon={<Plus size={16} />} onClick={() => setCreating(true)}>New project</Button>}
          </div>
        }
      />
      <div className="flex flex-col sm:flex-row gap-2 mb-3">
        <input className={inputClass + " sm:max-w-xs"} placeholder="Search building, unit, customer, SO, sales" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search projects" />
        <select className={inputClass + " sm:max-w-xs"} value={step} onChange={(e) => setStep(e.target.value)} aria-label="Filter by step">
          <option value="">All steps</option>
          {(steps.data?.data ?? []).filter((s) => s.active).map((s) => <option key={s.step_key} value={s.step_key}>{s.label}</option>)}
          <option value="hold">In defect / on hold</option>
        </select>
      </div>

      {q.loading && !q.data && <p className="text-sm text-ink-secondary py-8 text-center">Loading projects...</p>}
      {q.error && <p role="alert" className="text-sm text-err py-4">Projects could not be loaded: {q.error}</p>}
      {!q.loading && !q.error && rows.length === 0 && (
        <p className="text-sm text-ink-secondary py-8 text-center">{(q.data?.data.length ?? 0) === 0 ? "No renovation projects yet." : "No project matches the filter."}</p>
      )}

      {rows.length > 0 && (
        <>
          <div className="hidden md:block overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full text-sm">
              <thead className="bg-surface-dim text-left text-xs uppercase tracking-wide text-ink-secondary">
                <tr>
                  <th className="px-3 py-2">Building</th>
                  <th className="px-3 py-2 min-w-[11rem]">Project</th>
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
                  <tr key={r.id} className="border-t border-border hover:bg-surface-dim cursor-pointer" onClick={() => open(r.id)}>
                    <td className="px-3 py-2 whitespace-nowrap">{r.building ?? "-"}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-ink flex items-center gap-1">{r.name}{r.redFlagCount > 0 && <AlertTriangle size={12} className="text-err" aria-label={`${r.redFlagCount} red flags`} />}</div>
                      <div className="text-xs text-ink-secondary">{[r.code, r.unitNo, r.customerName].filter(Boolean).join(" · ")}</div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.soDocNo ?? <span className="text-ink-secondary">Not signed</span>}</td>
                    <td className="px-3 py-2">{r.sales.name ?? "-"}</td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{r.moneyHidden ? "Hidden" : r.soDocNo ? money(r.contractSen) : "-"}</td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{received(r)}</td>
                    <td className="px-3 py-2"><StatusCell r={r} /></td>
                    <td className="px-3 py-2">{r.soDocNo ? <Pill tone={supplyTone(r.furnitureArrival)}>{supplyLabel(r.furnitureArrival)}</Pill> : "-"}</td>
                    <td className="px-3 py-2">{r.soDocNo ? <Pill tone={supplyTone(r.renoItemArrival)}>{supplyLabel(r.renoItemArrival)}</Pill> : "-"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.keyHolder?.name ?? "-"}</td>
                    <td className="px-3 py-2">{r.vo ? (r.vo.has ? `Yes (${r.vo.count})` : "No") : "-"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.handoverDate ? shortDate(r.handoverDate) : r.plannedHandoverDate ? <span className="text-ink-secondary">plan {shortDate(r.plannedHandoverDate)}</span> : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="md:hidden space-y-2">
            {rows.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => open(r.id)} className="w-full text-left rounded-lg border border-border bg-surface p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-ink truncate">{r.name}</div>
                      <div className="text-xs text-ink-secondary truncate">{[r.building, r.unitNo, r.customerName].filter(Boolean).join(" · ") || "-"}</div>
                    </div>
                    {r.redFlagCount > 0 && <Pill tone="err"><AlertTriangle size={12} />{r.redFlagCount}</Pill>}
                  </div>
                  <div className="mt-2 text-sm"><StatusCell r={r} /></div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <div><dt className="text-ink-secondary">SO</dt><dd className="text-ink">{r.soDocNo ?? "Not signed"}</dd></div>
                    <div><dt className="text-ink-secondary">Sales</dt><dd className="text-ink">{r.sales.name ?? "-"}</dd></div>
                    <div><dt className="text-ink-secondary">Contract</dt><dd className="text-ink tabular-nums">{r.moneyHidden ? "Hidden" : r.soDocNo ? money(r.contractSen) : "-"}</dd></div>
                    <div><dt className="text-ink-secondary">Received</dt><dd className="text-ink tabular-nums">{received(r)}</dd></div>
                    <div><dt className="text-ink-secondary">Key holder</dt><dd className="text-ink">{r.keyHolder?.name ?? "-"}</dd></div>
                    <div><dt className="text-ink-secondary">Handover</dt><dd className="text-ink">{r.handoverDate ? shortDate(r.handoverDate) : "-"}</dd></div>
                  </dl>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {r.soDocNo && <Pill tone={supplyTone(r.furnitureArrival)}>Furniture: {supplyLabel(r.furnitureArrival)}</Pill>}
                    {r.soDocNo && <Pill tone={supplyTone(r.renoItemArrival)}>Reno: {supplyLabel(r.renoItemArrival)}</Pill>}
                    {r.vo?.has && <Pill tone="info">VO {r.vo.count}</Pill>}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {creating && (
        <CreateRenovationPanel
          onClose={() => setCreating(false)}
          onCreated={(id) => { setCreating(false); q.reload(); open(id); }}
        />
      )}
    </div>
  );
}
