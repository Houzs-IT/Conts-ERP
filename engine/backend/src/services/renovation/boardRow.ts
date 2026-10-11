/* One row of the simplified project board (owner decisions 11 Oct 2026, decision 7):
   Building, Project, SO no., Sales, Contract total, Received (%), Status (step +
   hold flag), Furniture / Reno-item arrival, Key holder, VO, Handover date.
   Also the shape GET /api/renovation/board-rows serves to the Project Monitor.
   Pure: built from loaded facts and the computed view. */

import { HOLD_FLAG_LABEL } from "../../scm/shared/renovation-stages";
import type { ProjectFacts } from "./load";
import type { ProjectView } from "./view";
import type { SupplyCondition } from "./conditions";

export interface BoardRowV2 {
  id: number;
  code: string | null;
  name: string;
  building: string | null;
  unitNo: string | null;
  customerName: string | null;
  soDocNo: string | null;
  soDate: string | null;
  sales: { personId: number | null; name: string | null };
  designer: { personId: number | null; name: string | null };
  renoPic: { personId: number | null; name: string | null };
  /** sen; null when there is no SO, or money is hidden from this user */
  contractSen: number | null;
  receivedSen: number | null;
  receivedPct: number | null;
  moneyHidden: boolean;
  step: { key: string; label: string; index: number; count: number; manual: boolean };
  hold: { flag: string; label: string; note: string | null } | null;
  /** "IN DEFECT · Renovation" style status text, the hold flag first */
  statusText: string;
  furnitureArrival: SupplyCondition | null;
  renoItemArrival: SupplyCondition | null;
  keyHolder: { personId: number | null; name: string | null; movedOn: string } | null;
  vo: { has: boolean; count: number; approved: number } | null;
  handoverDate: string | null;
  plannedHandoverDate: string | null;
  redFlagCount: number;
  archived: boolean;
  source: string;
  sourceRef: string | null;
}

export function boardRowOf(f: ProjectFacts, v: ProjectView, opts: { hideMoney: boolean }): BoardRowV2 {
  const p = f.project;
  const holdLabel = v.hold ? HOLD_FLAG_LABEL[v.hold.flag] : null;
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    building: p.building,
    unitNo: p.unit_no,
    customerName: p.customer_name,
    soDocNo: f.so?.doc_no ?? null,
    soDate: f.so?.so_date ?? null,
    sales: { personId: p.sales_person_id ?? null, name: p.sales_person_name ?? f.so?.agent ?? p.salesperson_name ?? null },
    designer: { personId: p.designer_person_id ?? null, name: p.designer_person_name ?? null },
    renoPic: { personId: p.reno_pic_person_id ?? null, name: p.reno_pic_person_name ?? null },
    contractSen: opts.hideMoney ? null : v.money.contractSen,
    receivedSen: opts.hideMoney ? null : v.money.receivedSen,
    receivedPct: opts.hideMoney ? null : v.money.receivedPct,
    moneyHidden: opts.hideMoney,
    step: { key: v.flow.current, label: v.flow.currentLabel, index: v.flow.currentIndex, count: v.flow.steps.length, manual: v.flow.manualInEffect },
    hold: v.hold && holdLabel ? { flag: v.hold.flag, label: holdLabel, note: v.hold.note } : null,
    statusText: [holdLabel, v.flow.currentLabel].filter(Boolean).join(" · "),
    furnitureArrival: v.conditions.furniture?.condition ?? null,
    renoItemArrival: v.conditions.renoItem?.condition ?? null,
    keyHolder: v.keyHolder,
    vo: v.vo ? { has: v.vo.count > 0, count: v.vo.count, approved: v.vo.approved } : null,
    handoverDate: f.handover?.signed_at ? String(f.handover.signed_at).slice(0, 10) : (p.handed_over_at ? String(p.handed_over_at).slice(0, 10) : null),
    plannedHandoverDate: p.planned_handover_date,
    redFlagCount: (opts.hideMoney ? v.redFlags.filter((r) => r.code !== "billing_due") : v.redFlags).length,
    archived: !!p.archived_at,
    source: p.source ?? "app",
    sourceRef: p.source_ref ?? null,
  };
}
