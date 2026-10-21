// The Conts instance of this engine is the supply chain, with service cases and projects (owner, 7 Oct).
// The rental side of the business runs in Property OS, and the other Houzs areas (HR, mail,
// announcements) are not used.
// Everything that builds a menu reads the one registry in components/Sidebar.tsx, so trimming that
// registry here keeps the desktop rail, the mobile menu and the hub pages in agreement.

/** Top-level menu entries kept, by their label in the registry. Team and Settings stay so an
 *  administrator can add people and set the company details; each is still gated by its own permission. */
const KEEP = new Set(["Sales Orders", "Service Cases", "Projects", "Supply Chain", "Finance", "Team", "Settings"]);

/** Houzs modules Conts does not use (owner decision C7, 11 Oct 2026): forecasting, the finance
 *  dashboard, consignment, HR commission and the AutoCount sync page. Switched off, not deleted: their
 *  menu entries are dropped and their addresses send you to CONTS_HOME (App.tsx). POS has no screen in
 *  this app; its endpoints are switched off in the backend. Each entry is a path prefix, matched on
 *  whole segments. The accounting ledger (journal, ledger, statements, chart of accounts) was switched
 *  back on for finance phase 1 (owner, 21 Oct 2026); it opens only with the Ledger area (ContsLedgerGate). */
export const CONTS_HIDDEN_PATHS: readonly string[] = [
  "/scm/forecast", "/scm/finance-dashboard",
  "/scm/consignment", "/scm/consignment-orders", "/scm/consignment-notes", "/scm/consignment-returns",
  "/scm/purchase-consignment-orders", "/scm/purchase-consignment-receives", "/scm/purchase-consignment-returns",
  "/scm/hr",
  "/autocount-sync",
];

/** True when this address (a path, or a menu `to` with a query) belongs to a switched-off module. */
export function isContsHiddenPath(to: string | undefined | null): boolean {
  if (!to) return false;
  const path = to.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  return CONTS_HIDDEN_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

type NavNode = { label: string; to?: string; children?: NavNode[] };

/** Drop switched-off entries at every depth; a group left with no entries goes too. */
function pruneHidden<T extends NavNode>(tabs: T[]): T[] {
  const out: T[] = [];
  for (const t of tabs) {
    if (isContsHiddenPath(t.to)) continue;
    if (t.children) {
      const children = pruneHidden(t.children);
      if (children.length === 0) continue;
      out.push({ ...t, children });
    } else {
      out.push(t);
    }
  }
  return out;
}

export function contsNavOnly<T extends NavNode>(tabs: T[]): T[] {
  return pruneHidden(tabs.filter((t) => KEEP.has(t.label)));
}

/** AutoCount is not used by Conts (CLAUDE.md: no AutoCount in the engine), and the engine has no
 *  /api/sync/status route. Off: Settings drops its AutoCount Sync tab and never asks for that status. */
export const CONTS_AUTOCOUNT: boolean = false;

/** Where the app opens: the old landing page is a Houzs-wide overview of areas hidden here. */
export const CONTS_HOME = "/scm/sales-orders";

/** The floating quick-add button and the AI assistant: off. Quick-add offers service cases and projects,
 *  and the assistant needs a key this instance does not have. */
export const CONTS_EXTRAS: boolean = false;
