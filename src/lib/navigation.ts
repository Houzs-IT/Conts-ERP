import type { UserRole, AccessLevel } from './types';

/** `badge` names a live count from /api/nav/badges; shown only when above zero. */
export type BadgeKey = 'today' | 'maintenance' | 'inbox' | 'statements' | 'approvals';
/** The sidebar shows one workspace at a time. Rental is the daily work; supply chain sits behind the switch. */
export type Workspace = 'rental' | 'supply';
/** `area` is the permission area (functions/_lib/access.ts AREAS) the screen belongs to. */
export interface NavChild { key: string; label: string; path: string; area?: string; badge?: BadgeKey }
/** `full`: the screen's data is for roles with Full on its area (the server refuses Edit), so it is shown only then. */
export interface NavItem {
  key: string; label: string; icon: string; path?: string; area?: string;
  badge?: BadgeKey; children?: NavChild[]; full?: boolean;
}
export interface NavGroup { label: string; workspace: Workspace; items: NavItem[] }

/**
 * Information architecture (UI audit section 3, 8 Oct): seven short rental groups, about 26 entries, each
 * one screen. The supply chain moved behind the workspace switch at the top of the sidebar.
 * Merged duplicates keep their old addresses as redirects (App.tsx):
 *  - Finance > Revenue was the same page as Growth > Analytics: one "Performance" entry.
 *  - Owners moved from Finance to Properties; Inbox from Growth to Reservations.
 *  - Properties > Inventory is the "Fit-out register" (not the warehouse's stock list).
 *  - Projects > Calendar is "Schedule"; Service / Project maintenance are "Case settings" / "Project settings",
 *    so no two menu entries share a name.
 */
export const NAV: NavGroup[] = [
  { label: 'HOME', workspace: 'rental', items: [
    { key: 'dashboard', label: 'Dashboard', icon: 'layout-dashboard', path: '/', area: 'dashboard' },
    { key: 'portfolio', label: 'Portfolio', icon: 'layers', path: '/portfolio', area: 'portfolio' },
    { key: 'analytics', label: 'Performance', icon: 'trending-up', path: '/performance/analytics', area: 'performance', full: true },
  ] },
  { label: 'RESERVATIONS', workspace: 'rental', items: [
    { key: 'calendar', label: 'Calendar', icon: 'calendar-days', path: '/reservations/calendar', area: 'reservations' },
    { key: 'bookings', label: 'Bookings', icon: 'book-open', path: '/reservations/bookings', area: 'reservations' },
    { key: 'guests', label: 'Guests', icon: 'users', path: '/reservations/guests', area: 'reservations' },
    { key: 'inbox', label: 'Inbox', icon: 'inbox', path: '/communication/inbox', area: 'comms', badge: 'inbox' },
  ] },
  // Three screens (owner, 10 Oct): Inspections is gone and "All tasks" is the History tab of Cleaning and
  // Maintenance; the old addresses redirect (App.tsx). Housekeeping is called Cleaning everywhere.
  { label: 'OPERATIONS', workspace: 'rental', items: [
    { key: 'today', label: 'Today', icon: 'clipboard-check', path: '/operations/today', area: 'operations', badge: 'today' },
    { key: 'cleaning', label: 'Cleaning', icon: 'sparkles', path: '/operations/cleaning', area: 'operations' },
    { key: 'maintenance', label: 'Maintenance', icon: 'wrench', path: '/operations/maintenance', area: 'operations', badge: 'maintenance' },
  ] },
  { label: 'PROPERTIES', workspace: 'rental', items: [
    // Buildings, the unit record and access codes are one Units screen (owner, 8 Oct).
    { key: 'units', label: 'Units', icon: 'building-2', path: '/properties/units', area: 'properties' },
    { key: 'ownerList', label: 'Owners', icon: 'user-round', path: '/owners', area: 'owners' },
    { key: 'contracts', label: 'Contracts', icon: 'file-signature', path: '/owners/contracts', area: 'owners' },
    { key: 'inventory', label: 'Fit-out register', icon: 'sofa', path: '/properties/inventory', area: 'properties' },
  ] },
  { label: 'MONEY', workspace: 'rental', items: [
    { key: 'statements', label: 'Owner statements', icon: 'receipt', path: '/finance/statements', area: 'finance', badge: 'statements' },
    { key: 'payouts', label: 'Payouts', icon: 'banknote', path: '/finance/payouts', area: 'finance' },
    { key: 'expenses', label: 'Expenses', icon: 'wallet', path: '/finance/expenses', area: 'finance' },
    { key: 'approvals', label: 'Approvals', icon: 'stamp', path: '/finance/approvals', area: 'finance', badge: 'approvals' },
    { key: 'guestDocuments', label: 'Guest documents', icon: 'file-text', path: '/finance/documents', area: 'finance' },
  ] },
  { label: 'GROWTH', workspace: 'rental', items: [
    { key: 'pricing', label: 'Pricing', icon: 'tag', path: '/performance/pricing', area: 'performance', full: true },
    { key: 'reviews', label: 'Reviews', icon: 'star', path: '/performance/reviews', area: 'performance' },
    { key: 'automations', label: 'Automations', icon: 'workflow', path: '/communication/automations', area: 'comms' },
  ] },
  { label: 'SYSTEM', workspace: 'rental', items: [
    { key: 'users', label: 'Users and roles', icon: 'shield-check', path: '/system/users', area: 'users' },
    { key: 'integrations', label: 'Integrations', icon: 'plug', path: '/system/integrations', area: 'integrations' },
    { key: 'settings', label: 'Settings', icon: 'settings', path: '/system/settings', area: 'settings' },
    { key: 'health', label: 'System health', icon: 'activity', path: '/system/health', area: 'health' },
  ] },

  // Supply chain workspace. Mirrors Houzs's hierarchy: section -> collapsible area -> page.
  // Service cases and Projects come from the supply chain engine only (ENGINE_ONLY below).
  { label: 'SERVICE CASES', workspace: 'supply', items: [
    { key: 'serviceCaseList', label: 'Service cases', icon: 'zap', path: '/service/cases', area: 'serviceCases' },
    { key: 'serviceMetrics', label: 'Quality metrics', icon: 'trending-up', path: '/service/metrics', area: 'serviceCases' },
    { key: 'serviceMaintenance', label: 'Case settings', icon: 'settings', path: '/service/maintenance', area: 'serviceCases' },
    { key: 'myCases', label: 'My cases', icon: 'inbox', path: '/service/my-cases', area: 'serviceCases' },
  ] },
  { label: 'PROJECTS', workspace: 'supply', items: [
    { key: 'projectList', label: 'Project list', icon: 'folder-kanban', path: '/projects/list', area: 'projects' },
    { key: 'projectCalendar', label: 'Schedule', icon: 'calendar-days', path: '/projects/calendar', area: 'projects' },
    { key: 'projectFinances', label: 'Finances', icon: 'wallet', path: '/projects/finances', area: 'projects' },
    { key: 'projectMaintenance', label: 'Project settings', icon: 'settings', path: '/projects/maintenance', area: 'projects' },
  ] },
  { label: 'SUPPLY CHAIN', workspace: 'supply', items: [
    { key: 'scSales', label: 'Sales order', icon: 'shopping-cart', area: 'scSales', children: [
      // Renovation quotations (revisions, package templates, convert to the contract SO): engine only.
      { key: 'renoQuotations', label: 'Quotations', path: '/sales/quotations' },
      { key: 'salesOrders', label: 'Sales orders', path: '/sales/orders' },
      { key: 'salesOrderAmendment', label: 'Sales order amendment', path: '/sales/amendments' },
      { key: 'deliveryOrders', label: 'Delivery orders', path: '/sales/delivery-orders' },
      { key: 'salesInvoices', label: 'Sales invoices', path: '/sales/invoices', area: 'scInvoices' },
      { key: 'salesReturns', label: 'Delivery returns', path: '/sales/returns' },
    ] },
    { key: 'scConsignment', label: 'Consignment', icon: 'handshake', area: 'scConsignment', children: [
      { key: 'consignmentOrder', label: 'Consignment order', path: '/consignment/order' },
      { key: 'consignmentNotes', label: 'Consignment note', path: '/sales/consignment-notes' },
      { key: 'consignmentReturn', label: 'Consignment return', path: '/consignment/return' },
      { key: 'purchaseConsignment', label: 'Purchase consignment order', path: '/procurement/consignment' },
      { key: 'purchaseConsignmentReceive', label: 'Purchase consignment receive', path: '/consignment/purchase-receive' },
      { key: 'purchaseConsignmentReturn', label: 'Purchase consignment return', path: '/consignment/purchase-return' },
    ] },
    { key: 'scProcurement', label: 'Procurement', icon: 'package', area: 'scProcurement', children: [
      { key: 'procurement', label: 'Products & Maintenance', path: '/procurement/products' },
      { key: 'suppliers', label: 'Suppliers', path: '/procurement/suppliers' },
      { key: 'mrp', label: 'MRP · Stock Status', path: '/procurement/mrp' },
      { key: 'purchaseOrders', label: 'Purchase orders', path: '/procurement/purchase-orders' },
      { key: 'poAmendments', label: 'PO amendments', path: '/procurement/po-amendments' },
      { key: 'cancellationRequests', label: 'Cancellation requests', path: '/procurement/cancellations' },
      { key: 'goodsReceived', label: 'Goods receipt', path: '/procurement/goods-received' },
      { key: 'purchaseInvoices', label: 'Purchase invoices', path: '/procurement/purchase-invoices', area: 'scInvoices' },
      { key: 'purchaseReturns', label: 'Purchase returns', path: '/procurement/purchase-returns' },
    ] },
    { key: 'scTransportPlan', label: 'Transportation', icon: 'truck', area: 'scTransportPlan', children: [
      { key: 'deliveryPlanning', label: 'Delivery planning', path: '/transport/planning' },
      { key: 'dpOrders', label: 'DP orders', path: '/transport/dp-orders' },
      { key: 'deliveryDates', label: 'Delivery date arrangement', path: '/transport/delivery-dates' },
      { key: 'deliveryTimes', label: 'Delivery time arrangement', path: '/transport/delivery-times' },
      { key: 'lastMile', label: 'Last mile delivery', path: '/transport/last-mile' },
    ] },
    { key: 'scWarehouse', label: 'Warehouse', icon: 'warehouse', area: 'scWarehouse', children: [
      { key: 'loadingList', label: 'Loading list', path: '/procurement/loading-list' },
      { key: 'warehouses', label: 'Warehouses', path: '/procurement/warehouses' },
      { key: 'racksBins', label: 'Racks & bins', path: '/procurement/racks' },
      { key: 'stock', label: 'Stock', path: '/procurement/stock' },
      { key: 'adjustments', label: 'Adjustments', path: '/procurement/adjustments' },
      { key: 'stockTransfers', label: 'Transfers', path: '/procurement/stock-transfers' },
      { key: 'stockTakes', label: 'Stock take', path: '/procurement/stock-takes' },
    ] },
    // Houzs keeps credit / debit notes under Finance > Money in; finance roles only.
  ] },
];

export const WORKSPACE_LABEL: Record<Workspace, string> = { rental: 'Rental', supply: 'Supply chain' };

/** Destinations a role cannot reach are removed, never disabled — routes.json permissionRules.
 *  Entries are permission areas (or single menu keys). System health matches MASTER_ROLES in
 *  functions/api/system/health (management, finance, operations managers): keep the two in sync. */
const DENY: Partial<Record<UserRole, string[]>> = {
  // scInvoices matches MONEY_ONLY in functions/api/_middleware.ts.
  operations_staff: ['finance', 'owners', 'users', 'integrations', 'settings', 'portfolio', 'health', 'scInvoices'],
  finance_admin: ['operations', 'comms'],
  housekeeper: ['*'],
  technician: ['*'],
  owner: ['*'],
};

/** Menu areas (and single menu keys) whose screens exist only in the supply chain engine: hidden where it is not set up. */
const ENGINE_ONLY_AREAS = ['serviceCases', 'projects', 'renoQuotations'];
const FIXED_ROLES: UserRole[] = ['housekeeper', 'technician', 'owner'];

/** Areas (and menu keys) closed to a role: from its permission levels where the session carries them, else the built-in list. */
function denied(role: UserRole, access?: Record<string, AccessLevel>): string[] {
  if (!access || FIXED_ROLES.includes(role)) return DENY[role] ?? [];
  return Object.entries(access).filter(([, level]) => level === 'none').map(([area]) => area);
}

const areaOfItem = (it: NavItem) => it.area ?? it.key;
const areaOfChild = (it: NavItem, c: NavChild) => c.area ?? areaOfItem(it);

/** The permission area a screen belongs to, or null for screens outside the chart. */
export function areaOfPath(path: string): string | null {
  for (const g of NAV) for (const it of g.items) {
    if (it.path === path) return areaOfItem(it);
    const child = it.children?.find(c => c.path === path);
    if (child) return areaOfChild(it, child);
  }
  return null;
}

/** Whether a screen is closed to this person: No access on its area, or a Full-only screen below Full. */
export function screenClosed(path: string, access?: Record<string, AccessLevel>): boolean {
  if (!access) return false;
  const area = areaOfPath(path);
  if (!area) return false;
  if (access[area] === 'none') return true;
  const item = NAV.flatMap(g => g.items).find(i => i.path === path);
  return !!item?.full && access[area] !== 'full';
}

export function navFor(role: UserRole, engine = false, access?: Record<string, AccessLevel>): NavGroup[] {
  const deny = [...denied(role, access), ...(engine ? [] : ENGINE_ONLY_AREAS)];
  if (deny.includes('*')) return [];
  const open = (key: string, area: string) => !deny.includes(key) && !deny.includes(area);
  const enough = (i: NavItem) => !i.full || !access || FIXED_ROLES.includes(role) || access[areaOfItem(i)] === 'full';
  return NAV
    .map(g => ({ ...g, items: g.items
      .filter(i => open(i.key, areaOfItem(i)) && enough(i))
      .map(i => i.children ? { ...i, children: i.children.filter(c => open(c.key, areaOfChild(i, c))) } : i)
      .filter(i => !i.children || i.children.length > 0) }))
    .filter(g => g.items.length > 0);
}

/** Which workspace an address belongs to; addresses outside the menu (records, profile) stay where they are. */
export function workspaceOf(path: string): Workspace | null {
  for (const g of NAV) for (const it of g.items) {
    if (it.path && (path === it.path || (it.path !== '/' && path.startsWith(it.path + '/')))) return g.workspace;
    if (it.children?.some(c => c.path === path)) return g.workspace;
  }
  return null;
}

/** role → landing path. The server returns this as `home`; kept here for the client guard. */
export const HOME: Record<UserRole, string> = {
  management: '/', operations_manager: '/', operations_staff: '/operations/today',
  finance_admin: '/finance/statements', housekeeper: '/field/today',
  technician: '/field/today', owner: '/owner',
};

/** Pages below a menu entry, for the third breadcrumb ("Money / Owner statements / Statement"). */
const SUB_PAGES: [RegExp, string][] = [
  [/^\/finance\/statements\/[^/]+$/, 'Statement'],
  [/^\/owners\/(?!contracts$)[^/]+$/, 'Owner profile'],
  [/^\/properties\/units\/[^/]+$/, 'Unit'],
  [/^\/system\/integrations\/hostplatform$/, 'HostPlatform import'],
];

const groupName = (label: string) => label.charAt(0) + label.slice(1).toLowerCase();

/** Breadcrumbs: group, menu entry and, on a record or sub-page, the page itself. */
export function findNav(path: string): { group: string; item: string; label: string; page?: string } | null {
  for (const g of NAV) for (const it of g.items) {
    if (it.path === path) return { group: groupName(g.label), item: it.label, label: it.label };
    for (const c of it.children ?? []) if (c.path === path) return { group: it.label, item: it.label, label: c.label };
  }
  const sub = SUB_PAGES.find(([re]) => re.test(path));
  const parent = path.replace(/\/[^/]+$/, '');
  if (parent && parent !== path) {
    const up = findNav(parent);
    if (up) return { ...up, page: sub?.[1] };
  }
  return null;
}
