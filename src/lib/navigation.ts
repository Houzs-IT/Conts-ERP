import type { UserRole, AccessLevel } from './types';
import { LEDGER_SCREENS } from './scmEngine';

/** `badge` names a live count from /api/nav/badges; shown only when above zero. */
export type BadgeKey = 'today' | 'maintenance' | 'inbox' | 'statements' | 'approvals' | 'itSupport';
/** The sidebar shows one workspace at a time. Rental is the daily work; supply chain sits behind the switch. */
export type Workspace = 'rental' | 'supply';
/** `area` is the permission area (functions/_lib/access.ts AREAS) the screen belongs to. */
/** `icon`: drawn only in the phone menu, where each screen is its own row; the desktop shows its category's icon. */
export interface NavChild { key: string; label: string; path: string; area?: string; badge?: BadgeKey; icon?: string }
/** `full`: the screen's data is for roles with Full on its area (the server refuses Edit), so it is shown only then. */
export interface NavItem {
  key: string; label: string; icon: string; path?: string; area?: string;
  badge?: BadgeKey; children?: NavChild[]; full?: boolean;
}
/** `phone: false`: left off the menu at phone width; its screens still open by address. */
export interface NavGroup { label: string; workspace: Workspace; items: NavItem[]; phone?: boolean }

/**
 * Information architecture (UI audit section 3, 8 Oct): seven short rental groups, about 26 entries, each
 * one screen. The supply chain moved behind the workspace switch at the top of the sidebar.
 * Merged duplicates keep their old addresses as redirects (App.tsx):
 *  - Finance > Revenue was the same page as Growth > Analytics: one "Performance" entry.
 *  - Owners moved from Finance to Properties; Inbox from Growth to Reservations.
 *  - The Fit-out register and Guest documents screens were retired (owner, 14 Oct 2026); guest invoices and receipts are issued from a reservation.
 *  - Projects > Calendar is "Schedule"; Service / Project maintenance are "Case settings" / "Project settings",
 *    so no two menu entries share a name.
 */
const SUPPLY_SUPPORT = 'SUPPORT';
const SUPPLY_FINANCE = 'FINANCE';

export type SettingsSectionKey = 'company' | 'operations' | 'locale' | 'report' | 'agreement' | 'approvals' | 'services' | 'security';

/** The Settings page's categories, one screen each (/system/settings/<key>). The desktop menu nests them under
 *  Settings and the phone Settings tab lists them under these headers, so both name and order them the same. */
export const SETTINGS_SECTIONS: { key: SettingsSectionKey; group: string; label: string; icon: string; description: string }[] = [
  { key: 'company', group: 'ORGANISATION', label: 'Company details', icon: 'Building2', description: 'Printed on the letterhead of every owner statement, guest invoice and receipt.' },
  { key: 'operations', group: 'ORGANISATION', label: 'Check-in and checkout', icon: 'Clock', description: 'Standard times the cleaning board uses when a reservation has none of its own.' },
  { key: 'locale', group: 'OWNERS AND MONEY', label: 'Operator share', icon: 'Percent', description: 'The share owner statements take when a unit\'s contract does not set one.' },
  { key: 'report', group: 'OWNERS AND MONEY', label: 'Owner statements', icon: 'FileText', description: 'Wording on the Owner Income Report, and its monthly miscellaneous charge.' },
  { key: 'agreement', group: 'OWNERS AND MONEY', label: 'Agreement template', icon: 'FileSignature', description: 'The management agreement that Generate agreement fills in from the unit, owner and contract.' },
  // Not "Approvals": the Finance menu already has an Approvals entry (the queue itself).
  { key: 'approvals', group: 'OWNERS AND MONEY', label: 'Approval rules', icon: 'Stamp', description: 'Whether money going out waits for a second person to approve it.' },
  { key: 'services', group: 'OWNERS AND MONEY', label: 'Service prices', icon: 'Tag', description: 'Cleaning and maintenance items: what the owner is charged, what each costs us, and from when.' },
  { key: 'security', group: 'SECURITY', label: 'Sign-in and sessions', icon: 'Lock', description: 'How long people stay signed in, when accounts lock, and who needs two-step sign-in.' },
];

/** Icons for the company ledger's screens (scmEngine.ts LEDGER_SCREENS), by slug. */
const LEDGER_ICON: Record<string, string> = {
  'payment-vouchers': 'banknote', 'money-received': 'hand-coins', 'bank-reconciliation': 'landmark',
  'journal-entries': 'notebook-pen', 'general-ledger': 'book-open-text', 'trial-balance': 'scale',
  'profit-and-loss': 'chart-line', 'balance-sheet': 'columns-2', 'debtor-ageing': 'user-round-check',
  'creditor-ageing': 'truck', 'chart-of-accounts': 'list-tree', 'item-group-accounts': 'boxes', 'ledger-setup': 'settings',
};

/** The Finance group, in both sidebars: finance's own desk screens (area Finance) and the company ledger's screens
 *  in the engine (area Ledger, finance phase 1). `prefix` is where the side keeps them; `keySuffix` keeps the menu
 *  keys unique across the two sides. */
export function financeItems(prefix: '/finance' | '/supply/finance', keySuffix: '' | 'Supply'): NavItem[] {
  return [
    { key: `payables${keySuffix}`, label: 'Accounts payable', icon: 'wallet', path: `${prefix}/payables`, area: 'finance' },
    // Staff could not find where utilities go (comment sheet, Oct 2026): the month's bills of every unit, on Accounts payable.
    { key: `utilityBills${keySuffix}`, label: 'Utility bills', icon: 'zap', path: `${prefix}/utility-bills`, area: 'finance' },
    { key: `approvals${keySuffix}`, label: 'Approvals', icon: 'stamp', path: `${prefix}/approvals`, area: 'finance', badge: 'approvals' },
    ...LEDGER_SCREENS.map(s => ({
      key: `ledger_${s.slug}${keySuffix}`, label: s.label, icon: LEDGER_ICON[s.slug] ?? 'book-open', path: `${prefix}/${s.slug}`, area: 'ledger',
    })),
  ];
}

export const NAV: NavGroup[] = [
  { label: 'HOME', workspace: 'rental', items: [
    { key: 'dashboard', label: 'Dashboard', icon: 'layout-dashboard', path: '/', area: 'dashboard' },
    { key: 'portfolio', label: 'Portfolio', icon: 'layers', path: '/portfolio', area: 'portfolio' },
    { key: 'unitReport', label: 'Overall unit report', icon: 'file-spreadsheet', path: '/portfolio/owner-report', area: 'portfolio', full: true },
    { key: 'analytics', label: 'Performance', icon: 'trending-up', path: '/performance/analytics', area: 'performance', full: true },
  ] },
  { label: 'RESERVATIONS', workspace: 'rental', items: [
    { key: 'calendar', label: 'Calendar', icon: 'calendar-days', path: '/reservations/calendar', area: 'reservations' },
    { key: 'bookings', label: 'Reservations', icon: 'book-open', path: '/reservations/bookings', area: 'reservations' },
    { key: 'guests', label: 'Guests', icon: 'users', path: '/reservations/guests', area: 'reservations' },
    { key: 'inbox', label: 'Messages', icon: 'inbox', path: '/communication/inbox', area: 'comms', badge: 'inbox' },
    // Invoices and receipts issued to guests: guest invoicing, so it sits with reservations. Still money work, so
    // its permission area stays Finance (who can open it does not change).
  ] },
  // Three screens (owner, 10 Oct): Inspections is gone and "All tasks" is the History tab of Cleaning and
  // Maintenance; the old addresses redirect (App.tsx). Housekeeping is called Cleaning everywhere.
  { label: 'OPERATIONS', workspace: 'rental', items: [
    { key: 'today', label: 'Today', icon: 'clipboard-check', path: '/operations/today', area: 'operations', badge: 'today' },
    { key: 'cleaning', label: 'Cleaning', icon: 'sparkles', path: '/operations/cleaning', area: 'operations' },
    { key: 'maintenance', label: 'Maintenance', icon: 'wrench', path: '/operations/maintenance', area: 'operations', badge: 'maintenance' },
  ] },
  { label: 'UNITS', workspace: 'rental', items: [
    // Buildings, the unit record and access codes are one Units screen (owner, 8 Oct).
    { key: 'units', label: 'Units', icon: 'building-2', path: '/properties/units', area: 'properties' },
    // Units we find a long-term tenant for, for the owner (staff sheet UNIT, 17 Oct 2026).
    { key: 'agentToLet', label: 'Agent to let', icon: 'key-round', path: '/properties/agent-to-let', area: 'properties' },
    // Owner statements and owner payouts live on the owner (owner, 11 Oct 2026): each owner's page, and the Owners
    // list's Statements and Payouts tabs for a whole month. Their old addresses redirect (App.tsx).
    { key: 'ownerList', label: 'Owners', icon: 'user-round', path: '/owners', area: 'owners', badge: 'statements' },
    { key: 'contracts', label: 'Contracts', icon: 'file-signature', path: '/owners/contracts', area: 'owners' },
  ] },
  // Finance's desk work. Not on the phone (owner, 11 Oct 2026: money is not needed on the phone).
  { label: 'FINANCE', workspace: 'rental', phone: false, items: financeItems('/finance', '') },
  { label: 'GROWTH', workspace: 'rental', items: [
    { key: 'pricing', label: 'Pricing', icon: 'tag', path: '/performance/pricing', area: 'performance', full: true },
    { key: 'reviews', label: 'Reviews', icon: 'star', path: '/performance/reviews', area: 'performance' },
    { key: 'automations', label: 'Automations', icon: 'workflow', path: '/communication/automations', area: 'comms' },
  ] },
  { label: 'SYSTEM', workspace: 'rental', items: [
    { key: 'users', label: 'Users and roles', icon: 'shield-check', path: '/system/users', area: 'users' },
    { key: 'integrations', label: 'Integrations', icon: 'plug', path: '/system/integrations', area: 'integrations' },
    // My account and Notifications are every person's own, so they carry an area no role is ever denied.
    { key: 'settings', label: 'Settings', icon: 'settings', area: 'settings', children: [
      ...SETTINGS_SECTIONS.map(s => ({ key: `settings_${s.key}`, label: s.label, path: `/system/settings/${s.key}` })),
      { key: 'myAccount', label: 'My account', path: '/account', area: 'account' },
      { key: 'notifications', label: 'Notifications', path: '/notifications', area: 'account' },
    ] },
    { key: 'health', label: 'System health', icon: 'activity', path: '/system/health', area: 'health' },
    // Every desk role: report a problem with the system to IT and follow it. No permission area, since a person
    // only ever reads their own requests (functions/_lib/itHub.ts). Its count comes from lib/itSupport.ts.
    { key: 'itSupport', label: 'IT Support', icon: 'life-buoy', path: '/system/it-support', badge: 'itSupport' },
  ] },

  // Supply chain workspace. Mirrors Houzs's hierarchy: section -> collapsible area -> page.
  // Service cases and Projects come from the supply chain engine only (ENGINE_ONLY below).
  { label: 'SERVICE CASES', workspace: 'supply', items: [
    { key: 'serviceCaseList', label: 'Service cases', icon: 'zap', path: '/service/cases', area: 'serviceCases' },
    { key: 'serviceMetrics', label: 'Quality metrics', icon: 'trending-up', path: '/service/metrics', area: 'serviceCases' },
    { key: 'serviceMaintenance', label: 'Case settings', icon: 'settings', path: '/service/maintenance', area: 'serviceCases', full: true },
    { key: 'myCases', label: 'My cases', icon: 'inbox', path: '/service/my-cases', area: 'serviceCases' },
  ] },
  { label: 'PROJECTS', workspace: 'supply', items: [
    { key: 'projectList', label: 'Project list', icon: 'folder-kanban', path: '/projects/list', area: 'projects' },
    { key: 'projectCalendar', label: 'Schedule', icon: 'calendar-days', path: '/projects/calendar', area: 'projects' },
    { key: 'projectFinances', label: 'Finances', icon: 'wallet', path: '/projects/finances', area: 'projects', full: true },
    { key: 'projectMaintenance', label: 'Project settings', icon: 'settings', path: '/projects/maintenance', area: 'projects', full: true },
  ] },
  { label: 'SUPPLY CHAIN', workspace: 'supply', items: [
    { key: 'scSales', label: 'Sales order', icon: 'shopping-cart', area: 'scSales', children: [
      // Renovation quotations (revisions, package templates, convert to the contract SO): engine only.
      { key: 'renoQuotations', label: 'Quotations', icon: 'file-text', path: '/sales/quotations' },
      { key: 'salesOrders', label: 'Sales orders', icon: 'shopping-cart', path: '/sales/orders' },
      { key: 'salesOrderAmendment', label: 'Sales order amendment', icon: 'file-pen-line', path: '/sales/amendments' },
      { key: 'deliveryOrders', label: 'Delivery orders', icon: 'truck', path: '/sales/delivery-orders' },
      { key: 'salesInvoices', label: 'Sales invoices', icon: 'receipt', path: '/sales/invoices', area: 'scInvoices' },
      { key: 'salesReturns', label: 'Delivery returns', icon: 'undo-2', path: '/sales/returns' },
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
      { key: 'procurement', label: 'Products', icon: 'package', path: '/procurement/products' },
      { key: 'suppliers', label: 'Suppliers', icon: 'factory', path: '/procurement/suppliers' },
      { key: 'mrp', label: 'MRP · Stock Status', icon: 'chart-column', path: '/procurement/mrp' },
      { key: 'purchaseOrders', label: 'Purchase orders', icon: 'clipboard-list', path: '/procurement/purchase-orders' },
      { key: 'poAmendments', label: 'PO amendments', icon: 'file-diff', path: '/procurement/po-amendments' },
      { key: 'cancellationRequests', label: 'Cancellation requests', icon: 'ban', path: '/procurement/cancellations' },
      { key: 'goodsReceived', label: 'Goods receipt', icon: 'package-check', path: '/procurement/goods-received' },
      { key: 'purchaseInvoices', label: 'Purchase invoices', icon: 'receipt-text', path: '/procurement/purchase-invoices', area: 'scInvoices' },
      { key: 'purchaseReturns', label: 'Purchase returns', icon: 'package-x', path: '/procurement/purchase-returns' },
    ] },
    { key: 'scTransportPlan', label: 'Transportation', icon: 'truck', area: 'scTransportPlan', children: [
      { key: 'deliveryPlanning', label: 'Delivery planning', icon: 'route', path: '/transport/planning' },
      { key: 'dpOrders', label: 'DP orders', icon: 'list-checks', path: '/transport/dp-orders' },
      { key: 'deliveryDates', label: 'Delivery date arrangement', icon: 'calendar-range', path: '/transport/delivery-dates' },
      { key: 'deliveryTimes', label: 'Delivery time arrangement', icon: 'clock', path: '/transport/delivery-times' },
      { key: 'lastMile', label: 'Last mile delivery', icon: 'map-pin', path: '/transport/last-mile' },
    ] },
    { key: 'scWarehouse', label: 'Warehouse', icon: 'warehouse', area: 'scWarehouse', children: [
      { key: 'loadingList', label: 'Loading list', icon: 'container', path: '/procurement/loading-list' },
      { key: 'warehouses', label: 'Warehouses', icon: 'warehouse', path: '/procurement/warehouses' },
      { key: 'racksBins', label: 'Racks & bins', icon: 'archive', path: '/procurement/racks' },
      { key: 'stock', label: 'Stock', icon: 'boxes', path: '/procurement/stock' },
      { key: 'adjustments', label: 'Stock adjustments', icon: 'sliders-horizontal', path: '/procurement/adjustments' },
      { key: 'stockTransfers', label: 'Transfers', icon: 'arrow-left-right', path: '/procurement/stock-transfers' },
      { key: 'stockTakes', label: 'Stock take', icon: 'clipboard-check', path: '/procurement/stock-takes' },
    ] },
    // Houzs keeps credit / debit notes under Finance > Money in; finance roles only.
  ] },
  // The same Finance as in Rental (finance phase 1): one set of company books for both sides, so the supply chain
  // sidebar stays put while finance works.
  { label: SUPPLY_FINANCE, workspace: 'supply', phone: false, items: financeItems('/supply/finance', 'Supply') },
  // The same IT Support screen as under System, at its own address so the supply chain sidebar stays put.
  // A Property OS screen, not an engine one: the engine must not call a Houzs address (CLAUDE.md).
  { label: SUPPLY_SUPPORT, workspace: 'supply', items: [
    { key: 'itSupportSupply', label: 'IT Support', icon: 'life-buoy', path: '/supply/it-support', area: 'itSupport', badge: 'itSupport' },
  ] },
];

/** Approvals are off unless Settings turns them on (owner, 11 Oct 2026); the page stays reachable by its address.
 *  Both Finance groups carry it (keys approvals and approvalsSupply), so it is matched by its badge. */
export const withoutOffItems = (groups: NavGroup[], approvalsOn: boolean) =>
  groups.map(g => ({ ...g, items: g.items.filter(it => it.badge !== 'approvals' || approvalsOn) }));

export const WORKSPACE_LABEL: Record<Workspace, string> ={ rental: 'Rental', supply: 'Supply chain' };

/** Destinations a role cannot reach are removed, never disabled — routes.json permissionRules.
 *  Entries are permission areas (or single menu keys). System health matches MASTER_ROLES in
 *  functions/api/system/health (management, finance, operations managers): keep the two in sync. */
const DENY: Partial<Record<UserRole, string[]>> = {
  // scInvoices matches MONEY_ONLY in functions/api/_middleware.ts.
  operations_staff: ['finance', 'owners', 'users', 'integrations', 'settings', 'portfolio', 'health', 'scInvoices', 'ledger'],
  operations_manager: ['ledger'],
  finance_admin: ['operations', 'comms'],
  housekeeper: ['*'],
  technician: ['*'],
  owner: ['*'],
};

/** Supply chain modules Conts does not use (owner, 11 Oct 2026): consignment, here and in the engine. Switched off,
 *  not deleted: off the menu for everyone, and their addresses open Home (App.tsx). */
const SWITCHED_OFF_AREAS = ['scConsignment'];
export function switchedOff(path: string): boolean {
  return NAV.some(g => g.items.some(it => SWITCHED_OFF_AREAS.includes(areaOfItem(it)) && (it.path === path || !!it.children?.some(c => c.path === path))));
}

/** Menu areas (and single menu keys) whose screens exist only in the supply chain engine: hidden where it is not set up. */
const ENGINE_ONLY_AREAS = ['serviceCases', 'projects', 'renoQuotations', 'ledger'];
const FIXED_ROLES: UserRole[] = ['housekeeper', 'technician', 'owner'];

/** Areas (and menu keys) closed to a role: from its permission levels where the session carries them, else the built-in list. */
function denied(role: UserRole, access?: Record<string, AccessLevel>): string[] {
  if (!access || FIXED_ROLES.includes(role)) return DENY[role] ?? [];
  return Object.entries(access).filter(([, level]) => level === 'none').map(([area]) => area);
}

const areaOfItem = (it: NavItem) => it.area ?? it.key;
const areaOfChild = (it: NavItem, c: NavChild) => c.area ?? areaOfItem(it);

/** Whether a permission area is open to this person, by the same rule the menu uses. */
export function areaOpen(role: UserRole, area: string, access?: Record<string, AccessLevel>): boolean {
  const deny = denied(role, access);
  return !deny.includes('*') && !deny.includes(area);
}

/** The permission area a screen belongs to, or null for screens outside the chart. */
export function areaOfPath(path: string): string | null {
  for (const g of NAV) for (const it of g.items) {
    if (it.path === path) return areaOfItem(it);
    const child = it.children?.find(c => c.path === path);
    if (child) return areaOfChild(it, child);
  }
  return SUPPLY_OFF_MENU[path]?.[2] ?? null;
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
  const groups = navGroups(role, engine, access);
  // IT Support and Finance are in the supply chain sidebar only so it stays put; alone they must not open the
  // supply chain workspace to someone with no supply chain screens (Finance is then in Rental only).
  const shared = (g: NavGroup) => g.workspace === 'supply' && (g.label === SUPPLY_SUPPORT || g.label === SUPPLY_FINANCE);
  const supplyWork = groups.some(g => g.workspace === 'supply' && !shared(g));
  return supplyWork ? groups : groups.filter(g => !shared(g));
}

function navGroups(role: UserRole, engine: boolean, access?: Record<string, AccessLevel>): NavGroup[] {
  const deny = [...denied(role, access), ...SWITCHED_OFF_AREAS, ...(engine ? [] : ENGINE_ONLY_AREAS)];
  if (deny.includes('*')) return [];
  const open = (key: string, area: string) => !deny.includes(key) && !deny.includes(area);
  const enough = (i: NavItem) => !i.full || !access || FIXED_ROLES.includes(role) || access[areaOfItem(i)] === 'full';
  // A parent closed to this role still shows the children with an open area of their own (Sales invoices under
  // Sales order); a child without its own area follows its parent.
  return NAV
    .map(g => ({ ...g, items: g.items
      .filter(i => (i.children || open(i.key, areaOfItem(i))) && enough(i))
      .map(i => i.children ? { ...i, children: i.children.filter(c => open(c.key, areaOfChild(i, c)) && (!!c.area || open(i.key, areaOfItem(i)))) } : i)
      .filter(i => !i.children || i.children.length > 0) }))
    .filter(g => g.items.length > 0);
}

/** Supply chain screens the owner took out of the sidebar (25 Sep 2026) that are still reachable by address.
 *  They keep the supply chain sidebar and a proper breadcrumb instead of flipping to Rental under "Home". */
const SUPPLY_OFF_MENU: Record<string, [group: string, label: string, area: string]> = {
  '/sales/customers': ['Sales order', 'Customers', 'scSales'],
  '/sales/unbilled': ['Sales order', 'Unbilled deliveries', 'scInvoices'],
  '/procurement/categories': ['Procurement', 'Categories', 'scProcurement'],
  '/procurement/product-models': ['Procurement', 'Product models', 'scProcurement'],
  '/furniture/fabrics': ['Procurement', 'Fabric library', 'scProcurement'],
  '/transport/drivers': ['Transportation', 'Drivers', 'scTransportPlan'],
  '/transport/driver-leave': ['Transportation', 'Driver leave', 'scTransportPlan'],
  '/transport/vehicles': ['Transportation', 'Vehicles', 'scTransportPlan'],
  '/transport/fleet-health': ['Transportation', 'Fleet health', 'scTransportPlan'],
  '/transport/coverage': ['Transportation', 'Coverage & fleet', 'scTransportPlan'],
  '/transport/3pl': ['Transportation', '3PL companies', 'scTransportPlan'],
  '/transport/zones': ['Transportation', 'Delivery zones', 'scTransportPlan'],
  '/transport/residence-rules': ['Transportation', 'Residence rules', 'scTransportPlan'],
  '/transport/rate-cards': ['Transportation', 'Carriers & rates', 'scTransportPlan'],
  // The server keeps this money screen to finance roles (MONEY_ONLY in functions/api/_middleware.ts). The old
  // Payment vouchers and Payables & receivables pages moved to Finance (finance phase 1; App.tsx).
  '/accounting/credit-notes': ['Accounting', 'Credit / debit notes', 'scInvoices'],
};

/** Which workspace an address belongs to; addresses outside the menu (records, profile) stay where they are. */
export function workspaceOf(path: string): Workspace | null {
  if (SUPPLY_OFF_MENU[path]) return 'supply';
  for (const g of NAV) for (const it of g.items) {
    if (it.path && (path === it.path || (it.path !== '/' && path.startsWith(it.path + '/')))) return g.workspace;
    if (it.children?.some(c => c.path === path)) return g.workspace;
  }
  return null;
}

/** role → landing path. The server returns this as `home`; kept here for the client guard. */
export const HOME: Record<UserRole, string> = {
  management: '/', operations_manager: '/', operations_staff: '/operations/today',
  finance_admin: '/owners?view=statements', housekeeper: '/worker/today',
  technician: '/worker/today', owner: '/owner',
};

/** Pages below a menu entry, for the third breadcrumb ("Units / Owners / Owner statement"). */
const SUB_PAGES: [RegExp, string][] = [
  [/^\/owners\/statements\/[^/]+$/, 'Owner statement'],
  [/^\/owners\/(?!contracts$|statements$)[^/]+$/, 'Owner profile'],
  [/^\/properties\/units\/[^/]+$/, 'Unit'],
  [/^\/system\/integrations\/hostplatform$/, 'HostPlatform import'],
];

const groupName = (label: string) => label.charAt(0) + label.slice(1).toLowerCase();

/** Rental screens reached from another screen rather than the menu: their breadcrumb, instead of "Home". */
const RENTAL_OFF_MENU: Record<string, { group: string; item: string; page?: string }> = {
  '/operations/cleaners': { group: 'Operations', item: 'Cleaning', page: 'Cleaners' },
};

/** Breadcrumbs: group, menu entry and, on a record or sub-page, the page itself. */
export function findNav(path: string): { group: string; item: string; label: string; page?: string } | null {
  for (const g of NAV) for (const it of g.items) {
    if (it.path === path) return { group: groupName(g.label), item: it.label, label: it.label };
    for (const c of it.children ?? []) if (c.path === path) return { group: it.label, item: it.label, label: c.label };
  }
  const off = SUPPLY_OFF_MENU[path];
  if (off) return { group: off[0], item: off[1], label: off[1] };
  const rental = RENTAL_OFF_MENU[path];
  if (rental) return { ...rental, label: rental.item };
  const sub = SUB_PAGES.find(([re]) => re.test(path));
  const parent = path.replace(/\/[^/]+$/, '');
  if (parent && parent !== path) {
    const up = findNav(parent);
    if (up) return { ...up, page: sub?.[1] };
  }
  return null;
}
