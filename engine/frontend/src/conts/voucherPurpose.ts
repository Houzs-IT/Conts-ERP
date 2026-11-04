// Conts only: what each payment voucher line is for (chew 2 Nov 2026; SOP 3.2; plan 2026-11-02-voucher-line-purpose).
// A line names a unit (Rental), a project (Renovation, or the side the company's own project was made for) or the
// company. There is no voucher-wide For: the department follows each line's choice, and every line can name its own
// project. The server works out the same department (engine/backend payment-vouchers lineProjects).
import type { Department } from "./department";

export type LineFor = "unit" | "project" | "company";
export const LINE_FOR: ReadonlyArray<{ value: LineFor; label: string }> = [
  { value: "unit", label: "Unit" },
  { value: "project", label: "Project" },
  { value: "company", label: "Company" },
];
/** The words on a line's department tag. */
export const TAG: Record<Department, string> = { rental: "Rental", supply: "Renovation", shared: "Company" };

export type ProjectSide = { funding: string | null; internalDepartment: string | null; /** Its brand (SOP 1.1): RENOVATION or INHOUSE_RENOVATION. */ renoKind?: string | null };
type PurposeLine = { department: Department | ""; unitId: string | null; projectId: number | null };

/** A line's department: a unit is Rental, the company is Company; a project is Renovation unless it is the company's own
    project made for a unit to rent out. */
export function departmentOf(f: LineFor, project?: ProjectSide | null): Department {
  if (f === "unit") return "rental";
  if (f === "company") return "shared";
  return project?.funding === "internal" && project.internalDepartment === "rental" ? "rental" : "supply";
}

/** What a saved line is for: its unit, a Company department, its project, else its department (an older voucher's Rental line with no unit is
    a Unit line still to be filled in; a Renovation line with no project is a Project line still to be filled in). */
export function lineForOf(l: PurposeLine): LineFor {
  if (l.unitId) return "unit";
  /* The department saved wins over a project an older voucher stamped on every line: a Company line stays Company. */
  if (l.department === "shared") return "company";
  if (l.projectId != null) return "project";
  if (l.department === "rental") return "unit";
  if (l.department === "supply") return "project";
  return "company";
}

/** A line switched to another For keeps only what still applies. */
export function switchLine<T extends { unitId: string | null; projectId: number | null }>(l: T, f: LineFor): T {
  return { ...l, unitId: f === "unit" ? l.unitId : null, projectId: f === "project" ? l.projectId : null };
}

/** A new line: the For, unit and project of the line above (chew: the last unit is used again unless changed by hand); Company first. */
export function nextLine(lines: ReadonlyArray<PurposeLine>): { for: LineFor; unitId: string | null; projectId: number | null } {
  const above = lines[lines.length - 1];
  if (!above) return { for: "company", unitId: null, projectId: null };
  const f = lineForOf(above);
  return { for: f, unitId: f === "unit" ? above.unitId : null, projectId: f === "project" ? above.projectId : null };
}
