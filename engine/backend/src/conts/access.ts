// Conts only (not part of Houzs's code): what a Property OS role may do in these screens.
//
// Management sets each role's level per area on Property OS's Permissions chart. The sign-on carries
// those levels here (signed, see sso.ts); this file turns them into the engine's own page access and
// permission keys, and keeps them per role in app_settings so every request by that role follows them.
import type { Env } from "../types";
import { PAGES, type AccessLevel } from "../services/pageAccess";

export type ContsLevel = "none" | "view" | "edit" | "full";
const LEVELS: ContsLevel[] = ["none", "view", "edit", "full"];
const rank = (l: ContsLevel) => LEVELS.indexOf(l);

/** Property OS area -> the engine page it covers (the page and everything under it). */
const AREA_PAGE: Record<string, string> = {
  scSales: "scm.sales",
  scConsignment: "scm.consignment",
  scProcurement: "scm.procurement",
  scTransportPlan: "scm.transportation",
  scWarehouse: "scm.warehouse",
  scInvoices: "scm.finance",
  serviceCases: "service_cases",
  projects: "projects",
};
export const CONTS_AREAS = Object.keys(AREA_PAGE);
/** Invoices sit inside Sales and Procurement here but are their own area in Property OS. */
const INVOICE_PAGES = ["scm.sales.invoices", "scm.procurement.pi"];
/** Profit and cost views inside an area: open only at Full. */
const MONEY_PAGES: Record<string, string> = { "projects.finances": "projects", "service_cases.pnl": "serviceCases" };

export type ContsAccess = Record<string, ContsLevel>;

/** Reads the levels out of a sign-on, refusing anything that is not a known area and level. */
export function parseContsAccess(raw: unknown): ContsAccess | null {
  if (!raw || typeof raw !== "object") return null;
  const out: ContsAccess = {};
  for (const area of CONTS_AREAS) {
    const level = (raw as Record<string, unknown>)[area];
    if (typeof level !== "string" || !LEVELS.includes(level as ContsLevel)) return null;
    out[area] = level as ContsLevel;
  }
  return out;
}

export const isFullEverywhere = (a: ContsAccess) => CONTS_AREAS.every((k) => a[k] === "full");
export const hasAnyAccess = (a: ContsAccess) => CONTS_AREAS.some((k) => a[k] !== "none");

/** The engine's page access for those levels. Every page is stated, so nothing is left to inherit. */
export function contsPageAccess(a: ContsAccess): Record<string, AccessLevel> {
  const out: Record<string, AccessLevel> = {};
  for (const p of PAGES) out[p.key] = "none";
  for (const [area, page] of Object.entries(AREA_PAGE)) {
    for (const p of PAGES) if (p.key === page || p.key.startsWith(page + ".")) out[p.key] = a[area];
  }
  for (const key of INVOICE_PAGES) if (key in out) out[key] = a.scInvoices;
  for (const [key, area] of Object.entries(MONEY_PAGES)) if (key in out) out[key] = a[area] === "full" ? "full" : "none";
  // The supply chain umbrella only opens the menu group; each page under it keeps its own level.
  if ("scm" in out) out.scm = PAGES.some((p) => p.key.startsWith("scm.") && out[p.key] !== "none") ? "view" : "none";
  return out;
}

/** The permission keys that go with those levels (the engine checks both keys and pages). */
export function contsPermissions(a: ContsAccess): string[] {
  const keys: string[] = [];
  if (["scSales", "scConsignment", "scProcurement", "scTransportPlan", "scWarehouse", "scInvoices"].some((k) => a[k] !== "none")) keys.push("scm.access");
  const ladder = (level: ContsLevel, view: string[], edit: string[], full: string[]) =>
    [...(rank(level) >= 1 ? view : []), ...(rank(level) >= 2 ? edit : []), ...(rank(level) >= 3 ? full : [])];
  keys.push(...ladder(a.serviceCases, ["service_cases.read"], ["service_cases.create", "service_cases.write"], ["service_cases.manage", "service_cases.approve"]));
  keys.push(...ladder(a.projects, ["projects.read"], ["projects.write", "projects.chat"], ["projects.manage", "projects.approve"]));
  // Renovation sales documents: quoting with Sales at edit, approving VOs and terms at full; POs with
  // Procurement at edit; billing with Invoices at edit.
  keys.push(...ladder(a.scSales, [], ["scm.renovation.quote"], ["scm.renovation.vo.apply", "scm.renovation.terms"]));
  keys.push(...ladder(a.scProcurement, [], ["scm.renovation.po_split"], []));
  keys.push(...ladder(a.scInvoices, [], ["scm.renovation.bill"], []));
  return keys;
}

const ROLE_PREFIX = "Conts: ";
export const contsRoleName = (contsRole: string) => ROLE_PREFIX + contsRole;
const settingKey = (roleName: string) => `conts_access:${roleName}`;

export async function saveContsRoleAccess(env: Env, roleName: string, a: ContsAccess): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).bind(settingKey(roleName), JSON.stringify(a)).run();
}

/** The page access for a role that signs in from Property OS, or null for any other role. */
export async function contsRoleAccess(env: Env, roleName: string | null | undefined): Promise<Record<string, AccessLevel> | null> {
  if (!roleName || !roleName.startsWith(ROLE_PREFIX)) return null;
  const row = await env.DB.prepare(`SELECT value FROM app_settings WHERE key = ?`).bind(settingKey(roleName)).first<{ value: string | null }>();
  let saved: ContsAccess | null = null;
  try { saved = parseContsAccess(JSON.parse(row?.value ?? "null")); } catch { saved = null; }
  // A Conts role with nothing saved is closed, not open: the levels arrive with every sign-on.
  return contsPageAccess(saved ?? Object.fromEntries(CONTS_AREAS.map((k) => [k, "none" as ContsLevel])));
}
