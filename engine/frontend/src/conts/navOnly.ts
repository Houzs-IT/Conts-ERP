// The Conts instance of this engine is the supply chain only. The rental side of the business runs in
// Property OS, and the other Houzs areas (service cases, projects, HR, mail, announcements) are not used.
// Everything that builds a menu reads the one registry in components/Sidebar.tsx, so trimming that
// registry here keeps the desktop rail, the mobile menu and the hub pages in agreement.

/** Top-level menu entries kept, by their label in the registry. Team and Settings stay so an
 *  administrator can add people and set the company details; each is still gated by its own permission. */
const KEEP = new Set(["Sales Orders", "Supply Chain", "Finance", "Team", "Settings"]);

export function contsNavOnly<T extends { label: string }>(tabs: T[]): T[] {
  return tabs.filter((t) => KEEP.has(t.label));
}

/** Where the app opens: the old landing page is a Houzs-wide overview of areas hidden here. */
export const CONTS_HOME = "/scm/sales-orders";
