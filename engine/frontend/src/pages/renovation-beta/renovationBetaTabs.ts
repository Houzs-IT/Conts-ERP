/* The tabs of the Beta project workspace, in the mockup's order (owner, 23 Oct 2026). `bundle` says which
   part of the plan (docs/superpowers/plans/2026-10-23-beta-project-workspace.md) fills the tab. */

export const BETA_TABS = [
  { key: "overview", label: "Overview", bundle: "A" },
  { key: "drawings", label: "Drawings", bundle: "A" },
  { key: "vo", label: "VO", bundle: "B" },
  { key: "po", label: "PO", bundle: "B" },
  { key: "client-po", label: "Client PO", bundle: "B" },
  { key: "site", label: "Site & photos", bundle: "A" },
  { key: "defects", label: "Defects", bundle: "A" },
  { key: "timeline", label: "Timeline", bundle: "A" },
] as const;

export type BetaTabKey = (typeof BETA_TABS)[number]["key"];

function isBetaTabKey(v: string): v is BetaTabKey {
  return BETA_TABS.some((t) => t.key === v);
}

/** The tab named in the address (?tab=), or Overview when it is missing or unknown. */
export function tabFromParam(v: string | null): BetaTabKey {
  return v && isBetaTabKey(v) ? v : "overview";
}
