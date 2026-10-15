/* Renovation-mode service cases (owner, 15 Oct 2026): the New Service Case form looks up the PROJECT, not the
   SO. Pure helpers for the picker, the item category and the project link; the screens are in
   renovationServiceCase.tsx. */

export interface RenoCaseProject {
  id: number;
  code: string | null;
  name: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  address1: string;
  address2: string;
  postcode: string;
  city: string;
  state: string;
  siteAddress: string;
  building: string;
  unitNo: string;
  soDocNo: string;
  openCaseCount: number;
}

export interface RenoCaseCategory { code: string; label: string; subs: { code: string; label: string }[] }

/** "RN-2610-001 · Vista Harmoni B-8-2 · Tan Ah Kow": code, name, customer, whichever are filled. */
export function projectOptionLabel(p: Pick<RenoCaseProject, "code" | "name" | "customerName">): string {
  const name = p.name.trim();
  const customer = p.customerName.trim();
  return [p.code?.trim() ?? "", name, customer && customer !== name ? customer : ""].filter(Boolean).join(" · ");
}

/** The project's site address as one block: line 1, line 2, "postcode city", state (or the old single address). */
export function projectAddress(p: Pick<RenoCaseProject, "address1" | "address2" | "postcode" | "city" | "state" | "siteAddress">): string {
  const lines = [p.address1, p.address2, [p.postcode, p.city].filter((x) => x.trim()).join(" "), p.state].map((x) => x.trim()).filter(Boolean);
  return lines.length ? lines.join(", ") : p.siteAddress.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).join(", ");
}

/** The one Product Category value a renovation case stores: "Category / Sub-category", the category alone, or null. */
export function caseCategoryValue(categories: readonly RenoCaseCategory[], group: string, sub: string): string | null {
  const g = categories.find((x) => x.code === group);
  if (!g) return null;
  const s = g.subs.find((x) => x.code === sub);
  return s ? `${g.label} / ${s.label}` : g.label;
}

/** The project a case row is linked to, when it has one (list and detail rows carry project_id, code, name). */
export function caseProjectOf(row: Record<string, unknown> | null | undefined): { id: number; label: string } | null {
  const id = Number(row?.project_id ?? row?.projectId ?? 0);
  if (!Number.isInteger(id) || id <= 0) return null;
  const code = String(row?.project_code ?? row?.projectCode ?? "").trim();
  const name = String(row?.project_name ?? row?.projectName ?? "").trim();
  return { id, label: [code, name].filter(Boolean).join(" · ") || `Project ${id}` };
}

/** The category / sub-category codes of a stored "Category / Sub-category" value ('' when it is not one of the list). */
export function parseCaseCategory(categories: readonly RenoCaseCategory[], value: string | null | undefined): { group: string; sub: string } {
  const v = (value ?? "").trim();
  for (const g of categories) {
    if (v === g.label) return { group: g.code, sub: "" };
    const s = g.subs.find((x) => v === `${g.label} / ${x.label}`);
    if (s) return { group: g.code, sub: s.code };
  }
  return { group: "", sub: "" };
}
