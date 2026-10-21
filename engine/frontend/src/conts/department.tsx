// Conts only (not part of Houzs's code): the department on each ledger line (finance phase 1, spec 3.5).
// Rental, Supply chain or Shared (the company's own costs). The server's list is backend/src/acc/rules.ts DEPARTMENTS;
// a line that names none is Supply chain there.
import type { CSSProperties } from "react";

export type Department = "rental" | "supply" | "shared";

export const DEPARTMENT_OPTIONS: ReadonlyArray<{ value: Department; label: string }> = [
  { value: "rental", label: "Rental" },
  { value: "supply", label: "Supply chain" },
  { value: "shared", label: "Shared" },
];

/** A stored department as the forms hold it; anything else is "not chosen". */
export const departmentOf = (d: unknown): Department | "" => (DEPARTMENT_OPTIONS.some((o) => o.value === d) ? (d as Department) : "");

export const departmentLabel = (d: string | null | undefined): string =>
  DEPARTMENT_OPTIONS.find((o) => o.value === d)?.label ?? "Supply chain";

/** A new line starts with the department of the nearest line above that has one; the first line starts empty. */
export function nextLineDepartment(lines: ReadonlyArray<{ department: Department | "" }>): Department | "" {
  for (let i = lines.length - 1; i >= 0; i -= 1) if (lines[i].department) return lines[i].department;
  return "";
}

/** One line's department. `blank` is the empty choice's words: "Choose…" on a line, "All departments" on a report. */
export function DepartmentSelect({ value, onChange, label, blank, style, className }: {
  value: Department | ""; onChange: (d: Department | "") => void; label: string; blank?: string; style?: CSSProperties; className?: string;
}) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as Department | "")} style={style} className={className}>
      {blank !== undefined && <option value="">{blank}</option>}
      {DEPARTMENT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
