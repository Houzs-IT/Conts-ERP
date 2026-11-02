// Conts only: who a payment voucher is for (chew 2 Nov 2026; SOP 3.2; plan 2026-11-02-voucher-purpose-unit-project-
// pickers.md Task 3). Rental, Renovation or Company sets every line's department (rental / supply / shared); Mixed
// keeps them per line, as older vouchers and split bills have them. Only a Rental line names a unit; a new line takes
// the unit of the line above unless it is changed by hand.
import type { Department } from "./department";

export type VoucherFor = "rental" | "renovation" | "company" | "mixed";
export const VOUCHER_FOR: ReadonlyArray<{ value: VoucherFor; label: string }> = [
  { value: "rental", label: "Rental" },
  { value: "renovation", label: "Renovation" },
  { value: "company", label: "Company" },
  { value: "mixed", label: "Mixed" },
];
const DEPARTMENT_OF: Record<Exclude<VoucherFor, "mixed">, Department> = { rental: "rental", renovation: "supply", company: "shared" };
const FOR_OF: Record<Department, VoucherFor> = { rental: "rental", supply: "renovation", shared: "company" };

type PurposeLine = { department: Department | ""; unitId: string | null };

/** The purpose the lines already have: "" when none is chosen yet. */
export function forOfLines(lines: ReadonlyArray<PurposeLine>): VoucherFor | "" {
  const set = new Set(lines.map((l) => l.department).filter(Boolean) as Department[]);
  if (set.size === 0) return "";
  /* Some lines chosen and some not is still being filled line by line: keep each line's own choice open. */
  if (set.size > 1 || lines.some((l) => !l.department)) return "mixed";
  return FOR_OF[[...set][0]!];
}

/** Every line in the purpose's department; a line no longer Rental drops its unit. Mixed leaves the lines alone. */
export function applyFor<T extends PurposeLine>(lines: ReadonlyArray<T>, f: VoucherFor): T[] {
  if (f === "mixed") return [...lines];
  const department = DEPARTMENT_OF[f];
  return lines.map((l) => ({ ...l, department, unitId: department === "rental" ? l.unitId : null }));
}

/** What switching to `f` would throw away, in words, so the screen asks before it does. */
export function whatSwitchingDrops(lines: ReadonlyArray<PurposeLine>, projectId: number | null, f: VoucherFor): string[] {
  if (f === "mixed") return [];
  const out: string[] = [];
  if (f !== "rental" && lines.some((l) => l.unitId)) out.push("the units");
  if (f !== "renovation" && projectId != null) out.push("the project");
  return out;
}

/** The department a purpose puts on a new line ("" for Mixed or none chosen). */
export const departmentFor = (f: VoucherFor | ""): Department | "" => (f && f !== "mixed" ? DEPARTMENT_OF[f] : "");

/** A new line's unit: the nearest line above that has one (chew: 自动用回上一次的 unit, 除非手动更改). */
export function nextLineUnit(lines: ReadonlyArray<PurposeLine>): string | null {
  for (let i = lines.length - 1; i >= 0; i -= 1) if (lines[i]!.unitId) return lines[i]!.unitId;
  return null;
}
