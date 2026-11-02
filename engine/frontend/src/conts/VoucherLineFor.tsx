// Conts only: what one payment voucher line is for, on the voucher screens (chew 2 Nov 2026; SOP 3.2; plan
// 2026-11-02-voucher-line-purpose Task 3). Each line picks Unit, Project or Company; the unit or project picker sits
// beside it and a read-only tag shows the department that follows. conts/voucherPurpose.ts holds the rules; the server
// sets the final department (engine/backend payment-vouchers lineProjects).
import { useCallback, useMemo, type CSSProperties } from "react";
import type { Department } from "./department";
import { ProjectPicker, UnitPicker } from "./Pickers";
import { useProjectOptions } from "./projectLimitQueries";
import { LINE_FOR, TAG, departmentOf, lineForOf, nextLine, switchLine, type LineFor, type ProjectSide } from "./voucherPurpose";
import css from "./VoucherLine.module.css";

export { css as voucherLineCss };

/** What a draft line holds about its purpose. */
export type PurposeDraft = { lineFor: LineFor; unitId: string | null; projectId: number | null; department: Department };
export type SideOf = (projectId: number | null) => ProjectSide | null;

/** A project's funding and internal department, from the list the project picker reads (null until it has loaded). */
export function useProjectSides(): SideOf {
  const q = useProjectOptions();
  const byId = useMemo(() => new Map((q.data?.projects ?? []).map((p) => [
    p.id, { funding: p.funding ?? null, internalDepartment: p.internal_department ?? null } as ProjectSide,
  ])), [q.data]);
  return useCallback((id: number | null) => (id == null ? null : byId.get(id) ?? null), [byId]);
}

/** The department a line carries. A Project line whose project has not loaded keeps the department it had. */
export function lineDepartment(l: Omit<PurposeDraft, "department"> & { department: Department | "" }, side: ProjectSide | null): Department {
  if (l.lineFor !== "project") return departmentOf(l.lineFor);
  if (side) return departmentOf("project", side);
  return l.department === "rental" ? "rental" : "supply";
}

/** A line changed to another For, unit or project: what no longer applies is dropped and the department follows. */
export function repurpose<T extends PurposeDraft>(l: T, patch: Partial<Pick<PurposeDraft, "lineFor" | "unitId" | "projectId">>, sideOf: SideOf): T {
  const merged = { ...l, ...patch };
  const cleaned = switchLine(merged, merged.lineFor);
  return { ...cleaned, department: lineDepartment(cleaned, sideOf(cleaned.projectId)) };
}

/** A saved line's purpose (an older voucher's included: see lineForOf). */
export function purposeOfSaved(saved: { department: Department | ""; unitId: string | null; projectId: number | null }): PurposeDraft {
  const lineFor = lineForOf(saved);
  return {
    lineFor,
    unitId: lineFor === "unit" ? saved.unitId : null,
    projectId: lineFor === "project" ? saved.projectId : null,
    department: lineDepartment({ lineFor, unitId: null, projectId: null, department: saved.department }, null),
  };
}

/** A new line's purpose: the line above's (Company when there is none). */
export function purposeOfNew(lines: ReadonlyArray<PurposeDraft>): PurposeDraft {
  const n = nextLine(lines);
  const above = lines[lines.length - 1];
  return { lineFor: n.for, unitId: n.unitId, projectId: n.projectId, department: n.for === "project" && above ? above.department : departmentOf(n.for) };
}

/** What a line sends: its department, and its unit or its project (never a hidden one). */
export function purposePayload(l: PurposeDraft, side: ProjectSide | null): { department: Department; unitId: string | null; projectId: number | null } {
  return {
    department: lineDepartment(l, side),
    unitId: l.lineFor === "unit" ? l.unitId : null,
    projectId: l.lineFor === "project" ? l.projectId : null,
  };
}

/** The first line still missing its unit or project, as the save's sentence. */
export function missingTarget(lines: ReadonlyArray<PurposeDraft & { n: number }>): { title: string; body: string } | null {
  for (const l of lines) {
    if (l.lineFor === "unit" && !l.unitId) return { title: "Pick the unit", body: `Line ${l.n} is for a unit. Pick which one, or set the line to Project or Company.` };
    if (l.lineFor === "project" && l.projectId == null) return { title: "Pick the project", body: `Line ${l.n} is for a project. Pick which one, or set the line to Unit or Company.` };
  }
  return null;
}

/** Line N's For: Unit, Project or Company. */
export function LineForSwitch({ n, value, onChange, disabled }: { n: number; value: LineFor; onChange: (f: LineFor) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label={`Line ${n} for`} className={css.segmented}>
      {LINE_FOR.map((o) => {
        const on = value === o.value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} disabled={disabled} className={css.segment}
            data-on={on ? "true" : undefined} onClick={() => { if (!on) onChange(o.value); }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** The picker for a line's For: a unit, a project, or nothing for the company. */
export function LineTarget({ n, line, onUnit, onProject, inputClass }: {
  n: number; line: PurposeDraft; onUnit: (id: string | null) => void; onProject: (id: number | null) => void; inputClass?: string;
}) {
  if (line.lineFor === "unit") return <UnitPicker value={line.unitId} onChange={onUnit} inputClass={inputClass} ariaLabel={`Line ${n} unit`} />;
  if (line.lineFor === "project") {
    return <ProjectPicker value={line.projectId} onChange={onProject} inputClass={inputClass} ariaLabel={`Line ${n} project`} placeholder="Pick the project" />;
  }
  return <span className={css.none}>Whole company</span>;
}

const TAG_STYLE: CSSProperties = { whiteSpace: "nowrap" };

/** The read-only department tag on a line. */
export function DepartmentTag({ department, n }: { department: Department; n?: number }) {
  return (
    <span className={css.tag} data-department={department} style={TAG_STYLE} aria-label={n != null ? `Line ${n} department` : undefined}>
      {TAG[department]}
    </span>
  );
}
