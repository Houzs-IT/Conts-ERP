/* Renovation project board (replaces the owner's Notion "Project" table): one
   row per project with building, SO, salesperson, the derived furniture / reno
   item / reno / payment conditions, unit key and red flags. Table on desktop,
   cards on a phone. */

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CalendarDays, Plus } from "lucide-react";
import { PageHeader } from "../../../components/Layout";
import { Button } from "../../../components/Button";
import { useQuery } from "../../../hooks/useQuery";
import { renovationApi, type BoardRow } from "./renovationApi";
import { UNIT_KEY_LABEL, shortDate, supplyLabel, supplyTone } from "./renovationModel";
import { Pill, inputClass } from "./renovationUi";
import { CreateRenovationPanel } from "./CreateRenovationPanel";
import { RENO_STAGES, STAGE_LABEL } from "../../../vendor/shared/renovation-stages";

function paymentTone(c: string) {
  if (c === "fully_paid") return "ok" as const;
  if (c === "partly_paid" || c === "billed_unpaid") return "info" as const;
  if (c === "not_billed") return "warn" as const;
  return "muted" as const;
}

export function matchesBoardFilter(r: BoardRow, q: string, stage: string): boolean {
  if (stage && r.renoCondition !== stage) return false;
  if (!q.trim()) return true;
  const hay = [r.code, r.name, r.building, r.unitNo, r.customerName, r.soDocNo, r.salesperson].filter(Boolean).join(" ").toLowerCase();
  return q.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
}

export function RenovationBoard({ canCreate }: { canCreate: boolean }) {
  const navigate = useNavigate();
  const q = useQuery(["renovation", "board"], () => renovationApi.board());
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("");
  const [creating, setCreating] = useState(false);
  const rows = useMemo(() => (q.data?.data ?? []).filter((r) => matchesBoardFilter(r, search, stage)), [q.data, search, stage]);
  const open = (id: number) => navigate(`/projects/${id}`);

  return (
    <div>
      <PageHeader
        eyebrow="Operations · Projects"
        title="Renovation projects"
        description="Every project with its contract, supply and payment state. Conditions are worked out from purchase orders, receipts and billing."
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" icon={<CalendarDays size={16} />} onClick={() => navigate("/projects?view=calendar")}>Calendar</Button>
            {canCreate && <Button icon={<Plus size={16} />} onClick={() => setCreating(true)}>New project</Button>}
          </div>
        }
      />
      <div className="flex flex-col sm:flex-row gap-2 mb-3">
        <input className={inputClass + " sm:max-w-xs"} placeholder="Search building, unit, customer, SO" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search projects" />
        <select className={inputClass + " sm:max-w-xs"} value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Filter by stage">
          <option value="">All stages</option>
          {RENO_STAGES.map((k) => <option key={k} value={k}>{STAGE_LABEL[k]}</option>)}
        </select>
      </div>

      {q.loading && <p className="text-sm text-ink-secondary py-8 text-center">Loading projects...</p>}
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
                  <th className="px-3 py-2">Project</th>
                  <th className="px-3 py-2">Building / unit</th>
                  <th className="px-3 py-2">SO</th>
                  <th className="px-3 py-2">Salesperson</th>
                  <th className="px-3 py-2">Furniture</th>
                  <th className="px-3 py-2">Reno items</th>
                  <th className="px-3 py-2">Reno condition</th>
                  <th className="px-3 py-2">Payment</th>
                  <th className="px-3 py-2">Unit key</th>
                  <th className="px-3 py-2">Flags</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-border hover:bg-surface-dim cursor-pointer" onClick={() => open(r.id)}>
                    <td className="px-3 py-2">
                      <div className="font-medium text-ink">{r.name}</div>
                      <div className="text-xs text-ink-secondary">{r.code} · {r.customerName ?? "-"}</div>
                    </td>
                    <td className="px-3 py-2">{[r.building, r.unitNo].filter(Boolean).join(" ") || "-"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.soDocNo ? <>{r.soDocNo}<div className="text-xs text-ink-secondary">{shortDate(r.soDate)}</div></> : <span className="text-ink-secondary">No SO</span>}</td>
                    <td className="px-3 py-2">{r.salesperson ?? "-"}</td>
                    <td className="px-3 py-2"><Pill tone={supplyTone(r.furnitureCondition)}>{supplyLabel(r.furnitureCondition)}</Pill></td>
                    <td className="px-3 py-2"><Pill tone={supplyTone(r.renoItemCondition)}>{supplyLabel(r.renoItemCondition)}</Pill></td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.renoConditionLabel}</td>
                    <td className="px-3 py-2"><Pill tone={paymentTone(r.payment.condition)}>{r.payment.label}</Pill></td>
                    <td className="px-3 py-2 whitespace-nowrap">{UNIT_KEY_LABEL[r.unitKey]}</td>
                    <td className="px-3 py-2">{r.redFlags.length > 0 ? <Pill tone="err" title={r.redFlags.map((f) => f.text).join("\n")}><AlertTriangle size={12} />{r.redFlags.length}</Pill> : <span className="text-ink-secondary">-</span>}</td>
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
                      <div className="text-xs text-ink-secondary truncate">{r.code} · {[r.building, r.unitNo].filter(Boolean).join(" ") || "-"} · {r.customerName ?? "-"}</div>
                    </div>
                    {r.redFlags.length > 0 && <Pill tone="err"><AlertTriangle size={12} />{r.redFlags.length}</Pill>}
                  </div>
                  <div className="mt-2 text-sm text-ink">{r.renoConditionLabel}</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Pill tone={supplyTone(r.furnitureCondition)}>Furniture: {supplyLabel(r.furnitureCondition)}</Pill>
                    <Pill tone={supplyTone(r.renoItemCondition)}>Reno: {supplyLabel(r.renoItemCondition)}</Pill>
                    <Pill tone={paymentTone(r.payment.condition)}>{r.payment.label}</Pill>
                    <Pill tone="muted">Key: {UNIT_KEY_LABEL[r.unitKey]}</Pill>
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
