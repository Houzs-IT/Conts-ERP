// Conts only (not part of Houzs's code): a line's sub-department on AP invoices, debtor bills, manual journals and
// receipts (SOP 1.1; chew 4 Nov 2026). Grouped by Rental, Renovation and Company; picking one sets the line's
// department too. The server checks it again (engine/backend conts/sub-departments resolveLinesSub).
import type { CSSProperties } from "react";
import { DEPARTMENT_OPTIONS, type Department } from "./department";
import { useSubDepartments } from "./subDepartmentQueries";

export type LineSub = { department: Department | ""; subDepartmentId: string | null };

const GROUPS: ReadonlyArray<{ department: Department; label: string }> = [
  { department: "rental", label: "Rental" },
  { department: "supply", label: "Renovation" },
  { department: "shared", label: "Company" },
];

const DEPT_LABEL: Record<Department, string> = { rental: "Rental", supply: "Renovation", shared: "Company" };

/** How a saved line's department reads on a list: its sub-department's name, else its department; a Rental line on a
    team's sub-department (Maintenance, Cleaning…) with no unit says "No unit" (SOP 1.1). */
export function useLineDepartmentLabel(): (l: { department: string; subDepartmentId?: string | null; unitId?: string | null }) => string {
  const list = useSubDepartments().data?.subDepartments ?? [];
  return (l) => {
    const s = l.subDepartmentId ? list.find((x) => x.id === l.subDepartmentId) : undefined;
    if (!s) return DEPT_LABEL[l.department as Department] ?? l.department;
    return s.department === "rental" && !s.fixedKey && !l.unitId ? `${s.name} · No unit` : s.name;
  };
}

/** A new line's: the nearest line above that has a department; none on the first. */
export function nextLineSub(lines: ReadonlyArray<LineSub>): LineSub {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i]!.department) return { department: lines[i]!.department, subDepartmentId: lines[i]!.subDepartmentId ?? null };
  }
  return { department: "", subDepartmentId: null };
}

/** The active sub-departments, and the line's own even if retired since. An older line with a department and no
    sub-department shows its department until one is picked. */
export function SubDepartmentSelect({ value, onChange, label, blank = "Choose…", className, style, disabled }: {
  value: LineSub; onChange: (v: { department: Department; subDepartmentId: string }) => void; label: string; blank?: string;
  className?: string; style?: CSSProperties; disabled?: boolean;
}) {
  const list = useSubDepartments().data?.subDepartments ?? [];
  const shown = list.filter((s) => s.active || s.id === value.subDepartmentId);
  const placeholder = value.subDepartmentId ? null : value.department ? DEPARTMENT_OPTIONS.find((o) => o.value === value.department)?.label ?? blank : blank;
  return (
    <select aria-label={label} value={value.subDepartmentId ?? ""} className={className} style={style} disabled={disabled}
      onChange={(e) => {
        const s = list.find((x) => x.id === e.target.value);
        if (s) onChange({ department: s.department, subDepartmentId: s.id });
      }}>
      {placeholder != null && <option value="">{placeholder}</option>}
      {GROUPS.map((g) => (
        <optgroup key={g.department} label={g.label}>
          {shown.filter((s) => s.department === g.department).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </optgroup>
      ))}
    </select>
  );
}
