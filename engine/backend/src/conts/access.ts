// Conts only (not part of Houzs's code): what a Property OS role may do in these screens.
//
// Management sets each role's level per area on Property OS's Permissions chart. The sign-on carries
// those levels here (signed, see sso.ts); this file turns them into the engine's own page access and
// permission keys, and keeps them per role in app_settings so every request by that role follows them.
import type { Env } from "../types";
import { PAGES, type AccessLevel } from "../services/pageAccess";
import { ledgerPermissions } from "./ledger-access";

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
/** Areas split off one of the eight above after sign-ons carried them (split permission areas, part 2): each covers
 *  one page under its parent's. A sign-on without one (Property OS before the split) gives it the parent's level.
 *  `shell` is the page whose screen it opens inside (the route guard of /projects and /assr): it opens at view when
 *  the sub-area is open, so the screen loads; the parent's other pages keep the parent's level. */
const SUB_AREAS: Record<string, { parent: string; page: string; shell?: string }> = {
  scProduction: { parent: "scProcurement", page: "scm.procurement.production" },
  serviceMetrics: { parent: "serviceCases", page: "service_cases.metrics", shell: "service_cases" },
  projectDefects: { parent: "projects", page: "projects.defects", shell: "projects" },
  projectHandover: { parent: "projects", page: "projects.handover", shell: "projects" },
  projectFinances: { parent: "projects", page: "projects.finances", shell: "projects" },
};
const SPLIT_AREAS = [...CONTS_AREAS, ...Object.keys(SUB_AREAS)];
/** Invoices sit inside Sales and Procurement here but are their own area in Property OS. */
const INVOICE_PAGES = ["scm.sales.invoices", "scm.procurement.pi"];
/** Profit and cost views inside an area: open only at Full. */
const MONEY_PAGES: Record<string, string> = { "projects.finances": "projectFinances", "service_cases.pnl": "serviceCases" };

export type ContsAccess = Record<string, ContsLevel>;

/** The Ledger area (finance phase 1): not one of the eight above. It never counts towards Full
 *  everywhere, and a sign-on without it (Property OS before the area existed) reads as none. */
export const LEDGER_AREA = "ledger";

/** Mail Center (CONTS-0004): like the Ledger, outside the eight above and none when a sign-on leaves it out.
 *  View or Edit opens the inbox (what each person reads is still set per mailbox); Full also manages mailboxes. */
export const MAIL_AREA = "mail";
const OPTIONAL_AREAS = [LEDGER_AREA, MAIL_AREA];

/** Reads the levels out of a sign-on, refusing anything that is not a known area and level. */
export function parseContsAccess(raw: unknown): ContsAccess | null {
  if (!raw || typeof raw !== "object") return null;
  const out: ContsAccess = {};
  for (const area of CONTS_AREAS) {
    const level = (raw as Record<string, unknown>)[area];
    if (typeof level !== "string" || !LEVELS.includes(level as ContsLevel)) return null;
    out[area] = level as ContsLevel;
  }
  for (const [area, { parent }] of Object.entries(SUB_AREAS)) {
    const level = (raw as Record<string, unknown>)[area] ?? out[parent];
    if (typeof level !== "string" || !LEVELS.includes(level as ContsLevel)) return null;
    out[area] = level as ContsLevel;
  }
  for (const area of OPTIONAL_AREAS) {
    const level = (raw as Record<string, unknown>)[area];
    if (level !== undefined && (typeof level !== "string" || !LEVELS.includes(level as ContsLevel))) return null;
    out[area] = (level as ContsLevel | undefined) ?? "none";
  }
  return out;
}

const ledgerOf = (a: ContsAccess): ContsLevel => a[LEDGER_AREA] ?? "none";
const mailOf = (a: ContsAccess): ContsLevel => a[MAIL_AREA] ?? "none";
export const isFullEverywhere = (a: ContsAccess) => SPLIT_AREAS.every((k) => a[k] === "full");
export const hasAnyAccess = (a: ContsAccess) =>
  SPLIT_AREAS.some((k) => a[k] !== "none") || OPTIONAL_AREAS.some((k) => (a[k] ?? "none") !== "none");

/** The engine's page access for those levels. Every page is stated, so nothing is left to inherit. */
export function contsPageAccess(a: ContsAccess): Record<string, AccessLevel> {
  const out: Record<string, AccessLevel> = {};
  for (const p of PAGES) out[p.key] = "none";
  for (const [area, page] of Object.entries(AREA_PAGE)) {
    for (const p of PAGES) if (p.key === page || p.key.startsWith(page + ".")) out[p.key] = a[area];
  }
  for (const [area, { parent, page, shell }] of Object.entries(SUB_AREAS)) {
    const level = a[area] ?? a[parent];
    for (const p of PAGES) if (p.key === page || p.key.startsWith(page + ".")) out[p.key] = level;
    if (shell && shell in out && out[shell] === "none" && level !== "none") out[shell] = "view";
  }
  for (const key of INVOICE_PAGES) if (key in out) out[key] = a.scInvoices;
  // The ledger screens sit on the accounting page: it opens at the higher of Invoices and Ledger.
  if ("scm.finance.accounting" in out && rank(ledgerOf(a)) > rank(out["scm.finance.accounting"] as ContsLevel)) {
    out["scm.finance.accounting"] = ledgerOf(a);
  }
  for (const [key, area] of Object.entries(MONEY_PAGES)) if (key in out) out[key] = a[area] === "full" ? "full" : "none";
  // The supply chain umbrella only opens the menu group; each page under it keeps its own level.
  if ("scm" in out) out.scm = PAGES.some((p) => p.key.startsWith("scm.") && out[p.key] !== "none") ? "view" : "none";
  // Mailboxes is a tab of the Team page and lists the people to give a mailbox to: Full on Mail opens both.
  if ("team" in out && mailOf(a) === "full") out.team = "view";
  return out;
}

/** The permission keys that go with those levels (the engine checks both keys and pages). */
export function contsPermissions(a: ContsAccess): string[] {
  const keys: string[] = [];
  if (["scSales", "scConsignment", "scProcurement", "scProduction", "scTransportPlan", "scWarehouse", "scInvoices"].some((k) => (a[k] ?? "none") !== "none")) keys.push("scm.access");
  const ladder = (level: ContsLevel, view: string[], edit: string[], full: string[]) =>
    [...(rank(level) >= 1 ? view : []), ...(rank(level) >= 2 ? edit : []), ...(rank(level) >= 3 ? full : [])];
  keys.push(...ladder(a.serviceCases, ["service_cases.read"], ["service_cases.create", "service_cases.write"], ["service_cases.manage", "service_cases.approve"]));
  // Full on Finances opens the Finances view, which Property OS's menu offers at Full (owner, 16 Oct 2026).
  keys.push(...ladder(a.projects, ["projects.read"], ["projects.write", "projects.chat"], ["projects.manage", "projects.approve"]));
  if ((a.projectFinances ?? a.projects) === "full") keys.push("projects.finance.view");
  // Renovation sales documents: quoting with Sales at edit, approving VOs and terms at full; POs with
  // Procurement at edit; billing with Invoices at edit.
  keys.push(...ladder(a.scSales, [], ["scm.renovation.quote"], ["scm.renovation.vo.apply", "scm.renovation.terms"]));
  // VOs on a confirmed sales order (owner, 24 Oct 2026): whoever may edit a sales order records the VO, and it
  // applies at once, so the same person holds the engine's amendment keys (scm/lib/renovation-vo-rule.ts).
  keys.push(...ladder(a.scSales, [], ["scm.amendment.create", "scm.amendment.approve_lines", "scm.amendment.approve_delivery", "scm.amendment.approve_price"], []));
  keys.push(...ladder(a.scProcurement, [], ["scm.renovation.po_split"], []));
  keys.push(...ladder(a.scInvoices, [], ["scm.renovation.bill"], []));
  keys.push(...ledgerPermissions(ledgerOf(a)));
  keys.push(...ladder(mailOf(a), ["mail_center.read"], [], ["mail_center.manage", "users.read"]));
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
  return contsPageAccess(saved ?? Object.fromEntries(SPLIT_AREAS.map((k) => [k, "none" as ContsLevel])));
}
