// Conts only: what one payment voucher line is for, on the voucher screens (SOP 1.1, 3.2; chew 2 and 4 Nov 2026).
// Each line picks its sub-department — Rental (general), Maintenance, Cleaning…, Renovation (Dream Crafter), In-house
// Reno (The Conts), Company — and beside it a unit or a project: a renovation line one of its own brand's projects or
// none (the brand's own cost); a Rental line a unit, or the company's own Rental project. A read-only tag shows the
// department. conts/voucherPurpose.ts holds the older For rules; the server sets the final department (engine/backend
// payment-vouchers lineSubs / lineProjects).
import { useCallback, useMemo, type CSSProperties } from "react";
import type { Department } from "./department";
import { ProjectPicker, UnitPicker } from "./Pickers";
import { useProjectOptions, type ProjectOption } from "./projectLimitQueries";
import { TAG, departmentOf, lineForOf, nextLine, switchLine, type LineFor, type ProjectSide } from "./voucherPurpose";
import type { SubDepartment } from "./subDepartmentQueries";
import css from "./VoucherLine.module.css";

export { css as voucherLineCss };

/** What a saved line held, kept until the line is changed: an untouched line is sent back exactly as it was, so opening
    and saving an older voucher (one project stamped on every line, a Rental line with no unit) changes nothing. */
export type SavedPurpose = { department: Department; unitId: string | null; projectId: number | null; subDepartmentId?: string | null };
/** What a draft line holds about its purpose. */
export type PurposeDraft = {
  lineFor: LineFor; unitId: string | null; projectId: number | null; department: Department; subDepartmentId: string | null; saved?: SavedPurpose;
  /** A line saved before sub-departments (SOP 1.1): edited, it keeps its For until someone picks a sub-department. */
  legacy?: boolean;
};
export type SideOf = (projectId: number | null) => ProjectSide | null;

const BRAND_KIND: Partial<Record<NonNullable<SubDepartment["fixedKey"]>, string>> = { dreamcrafter: "RENOVATION", theconts: "INHOUSE_RENOVATION" };

/** A project's funding, internal department and brand, from the list the project picker reads (null until loaded). */
export function useProjectSides(): SideOf {
  const q = useProjectOptions();
  const byId = useMemo(() => new Map((q.data?.projects ?? []).map((p) => [
    p.id, { funding: p.funding ?? null, internalDepartment: p.internal_department ?? null, renoKind: p.reno_kind ?? null } as ProjectSide,
  ])), [q.data]);
  return useCallback((id: number | null) => (id == null ? null : byId.get(id) ?? null), [byId]);
}

/** Does a project fit a sub-department? Its side (Rental for the company's own Rental project, else Renovation) must be
    the sub-department's department, and a renovation one's brand must be the project's. Company names no project. */
export function projectFits(sub: SubDepartment, side: ProjectSide | null): boolean {
  if (sub.department === "shared") return false;
  if (!side) return true;
  if (departmentOf("project", side) !== sub.department) return false;
  const want = sub.fixedKey ? BRAND_KIND[sub.fixedKey] : undefined;
  return !want || !side.renoKind || side.renoKind === want;
}

/** The department a line carries. A line naming its sub-department carries that one's; an older Project line whose
    project has not loaded keeps the department it had. */
export function lineDepartment(l: Omit<PurposeDraft, "department" | "subDepartmentId"> & { department: Department | ""; subDepartmentId?: string | null }, side: ProjectSide | null): Department {
  if (l.saved) return l.saved.department;
  if (l.subDepartmentId && l.department) return l.department;
  if (l.lineFor !== "project") return departmentOf(l.lineFor);
  if (side) return departmentOf("project", side);
  return l.department === "rental" ? "rental" : "supply";
}

const forOfDepartment = (d: Department, projectId: number | null): LineFor =>
  d === "shared" ? "company" : d === "supply" ? "project" : projectId != null ? "project" : "unit";

/** A line changed to another sub-department, unit or project: what no longer fits is dropped and the department follows. */
export function repurpose<T extends PurposeDraft>(
  l: T, patch: Partial<Pick<PurposeDraft, "lineFor" | "unitId" | "projectId" | "subDepartmentId">>, sideOf: SideOf, subs: readonly SubDepartment[] = [],
): T {
  const merged = { ...l, ...patch, saved: undefined };
  const sub = merged.subDepartmentId ? subs.find((s) => s.id === merged.subDepartmentId) : undefined;
  if (!sub) {
    const cleaned = switchLine(merged, merged.lineFor);
    return { ...cleaned, department: lineDepartment(cleaned, sideOf(cleaned.projectId)) };
  }
  merged.legacy = undefined;
  let { unitId, projectId } = merged;
  if (sub.department !== "rental") unitId = null;
  if (projectId != null && !projectFits(sub, sideOf(projectId))) projectId = null;
  /* On a Rental line a unit and a project exclude each other: the one just picked wins. */
  if (sub.department === "rental" && unitId && projectId != null) {
    if (patch.projectId != null) unitId = null; else projectId = null;
  }
  return { ...merged, unitId, projectId, department: sub.department, lineFor: forOfDepartment(sub.department, projectId) };
}

/** A saved line's purpose (an older voucher's included: see lineForOf). */
export function purposeOfSaved(saved: { department: Department | ""; unitId: string | null; projectId: number | null; subDepartmentId?: string | null }): PurposeDraft {
  const lineFor = lineForOf(saved);
  const department = saved.department || lineDepartment({ lineFor, unitId: null, projectId: null, department: "" }, null);
  return {
    lineFor,
    unitId: lineFor === "unit" ? saved.unitId : null,
    projectId: lineFor === "project" ? saved.projectId : null,
    department,
    subDepartmentId: saved.subDepartmentId ?? null,
    ...(saved.subDepartmentId ? {} : { legacy: true }),
    saved: { department, unitId: saved.unitId, projectId: saved.projectId, subDepartmentId: saved.subDepartmentId ?? null },
  };
}

/** A new line's purpose: the line above's sub-department, unit and project; the first line has none yet. */
export function purposeOfNew(lines: ReadonlyArray<PurposeDraft>): PurposeDraft {
  const n = nextLine(lines);
  const above = lines[lines.length - 1];
  if (above?.subDepartmentId) {
    return { lineFor: above.lineFor, unitId: above.unitId, projectId: above.projectId, department: above.department, subDepartmentId: above.subDepartmentId };
  }
  return {
    lineFor: n.for, unitId: n.unitId, projectId: n.projectId, subDepartmentId: null,
    department: n.for === "project" && above ? above.department : departmentOf(n.for),
  };
}

/** What a line sends: its department and sub-department, and its unit or its project (never a hidden one). */
export function purposePayload(l: PurposeDraft, side: ProjectSide | null): { department: Department; unitId: string | null; projectId: number | null; subDepartmentId?: string } {
  if (l.saved) {
    const { subDepartmentId, ...rest } = l.saved;
    return subDepartmentId ? { department: rest.department, subDepartmentId, unitId: rest.unitId, projectId: rest.projectId } : rest;
  }
  const out = {
    department: lineDepartment(l, side),
    unitId: l.lineFor === "unit" ? l.unitId : null,
    projectId: l.lineFor === "project" ? l.projectId : null,
  };
  return l.subDepartmentId ? { department: out.department, subDepartmentId: l.subDepartmentId, unitId: out.unitId, projectId: out.projectId } : out;
}

/** The first line still missing its department, as the save's sentence. A renovation line may leave its project empty
    (the brand's own cost) and a Rental line its unit (a Rental general cost): SOP 1.1, 3.2. */
export function missingTarget(lines: ReadonlyArray<PurposeDraft & { n: number }>): { title: string; body: string } | null {
  for (const l of lines) {
    if (l.saved || l.legacy) continue; // as it was saved: an edit never forces a choice on an older line
    if (!l.subDepartmentId) return { title: "Pick the department", body: `Line ${l.n}: pick its department.` };
  }
  return null;
}

const GROUP_LABEL: Record<Department, string> = { rental: "Rental", supply: "Renovation", shared: "Company" };

/** Line N's sub-department, grouped by department: the active ones, and the line's own even if retired since. */
export function LineSubSelect({ n, line, subs, onChange, disabled, className }: {
  n: number; line: PurposeDraft; subs: readonly SubDepartment[]; onChange: (id: string | null) => void; disabled?: boolean; className?: string;
}) {
  const shown = subs.filter((s) => s.active || s.id === line.subDepartmentId);
  return (
    <select aria-label={`Line ${n} department`} className={className} value={line.subDepartmentId ?? ""} disabled={disabled}
      onChange={(e) => onChange(e.target.value || null)}>
      {!line.subDepartmentId && <option value="">{line.saved ? TAG[line.department] : "Choose…"}</option>}
      {(["rental", "supply", "shared"] as const).map((d) => (
        <optgroup key={d} label={GROUP_LABEL[d]}>
          {shown.filter((s) => s.department === d).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

/** The picker beside a line's sub-department: a renovation line's project (its brand's, optional); a Rental line's unit,
    or the company's own Rental project; nothing for the company. An older line without one keeps its For's picker. */
export function LineTarget({ n, line, onUnit, onProject, inputClass, subs = [] }: {
  n: number; line: PurposeDraft; onUnit: (id: string | null) => void; onProject: (id: number | null) => void; inputClass?: string; subs?: readonly SubDepartment[];
}) {
  const sub = line.subDepartmentId ? subs.find((s) => s.id === line.subDepartmentId) : undefined;
  const sideOfOption = (p: ProjectOption): ProjectSide => ({ funding: p.funding ?? null, internalDepartment: p.internal_department ?? null, renoKind: p.reno_kind ?? null });
  if (sub) {
    const fits = (p: ProjectOption) => projectFits(sub, sideOfOption(p));
    if (sub.department === "shared") return <span className={css.none}>Whole company</span>;
    if (sub.department === "supply") {
      return <ProjectPicker value={line.projectId} onChange={onProject} inputClass={inputClass} ariaLabel={`Line ${n} project`} filter={fits}
        placeholder={`No project: ${sub.name}'s own cost`} />;
    }
    return (
      <span style={{ display: "flex", gap: 4, minWidth: 0 }}>
        <UnitPicker value={line.unitId} onChange={onUnit} inputClass={inputClass} ariaLabel={`Line ${n} unit`} />
        <ProjectPicker value={line.projectId} onChange={onProject} inputClass={inputClass} ariaLabel={`Line ${n} project`} filter={fits} placeholder="Or its project" />
      </span>
    );
  }
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
    <span className={css.tag} data-department={department} style={TAG_STYLE} aria-label={n != null ? `Line ${n} department tag` : undefined}>
      {TAG[department]}
    </span>
  );
}
