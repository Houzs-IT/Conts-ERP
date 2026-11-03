// Conts only: ordering and search for the payment voucher's project and unit pickers (chew 2 Nov 2026; SOP 3.2; plan
// 2026-11-02-voucher-purpose-unit-project-pickers.md Task 3). Projects not yet done come first, newest first; the
// completed ones follow and can still be picked; test projects (TESTING / DEMO) go last.

export type PickProject = {
  id: number; code: string | null; name: string; customer_name: string | null; contract_status: string | null;
  planned_handover_date: string | null; handed_over_at: string | null; created_at: string | null; done: boolean;
  funding?: string | null; internal_department?: string | null;
};
export type PickUnit = { id: string; building: string; unitNumber: string };

/** The project's name without the "SO - " some names start with. */
export const cleanProjectName = (name: string): string => name.replace(/^\s*SO\s*-\s*/i, "").trim();

export const isTestProject = (p: Pick<PickProject, "name">): boolean => /^(TESTING|DEMO)\b/i.test(cleanProjectName(p.name));

export function contractStatusLabel(p: PickProject): string {
  const s = String(p.contract_status ?? "").toUpperCase();
  if (/CANCEL/.test(s)) return "Cancelled";
  if (s === "RENO_COMPLETED" || s === "CLOSED") return "Completed";
  if (p.handed_over_at) return "Handed over";
  if (s === "RENO_IN_PROGRESS") return "In progress";
  if (s === "RENO_CONFIRMED") return "Confirmed";
  return s ? s.replace(/^RENO_/, "").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : "No contract";
}

/** Every word typed must appear somewhere in the row's text. */
const matches = (text: string, query: string): boolean => {
  const hay = text.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
};

export function projectRows(projects: PickProject[], query: string): { open: PickProject[]; completed: PickProject[]; test: PickProject[] } {
  const hits = projects.filter((p) => matches(`${p.name} ${p.customer_name ?? ""} ${p.code ?? ""}`, query));
  const newest = (a: PickProject, b: PickProject) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")) || b.id - a.id;
  const test = hits.filter(isTestProject).sort(newest);
  const real = hits.filter((p) => !isTestProject(p));
  return { open: real.filter((p) => !p.done).sort(newest), completed: real.filter((p) => p.done).sort(newest), test };
}

export function unitRows(units: PickUnit[], query: string): PickUnit[] {
  return units.filter((u) => matches(`${u.building} ${u.unitNumber}`, query));
}
