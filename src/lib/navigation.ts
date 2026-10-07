import type { UserRole } from './types';

/** `badge` names a live count from /api/nav/badges; shown only when above zero. */
export type BadgeKey = 'today' | 'maintenance' | 'inbox' | 'statements';
export interface NavChild { key: string; label: string; path: string; badge?: BadgeKey; designed?: boolean }
export interface NavItem {
  key: string; label: string; icon: string; path?: string;
  badge?: BadgeKey; designed?: boolean; children?: NavChild[];
}
export interface NavGroup { label: string; items: NavItem[] }

/** Mirrors routes.json. Icon names are lucide-react component names in kebab form. */
export const NAV: NavGroup[] = [
  { label: 'WORKSPACE', items: [
    { key: 'dashboard', label: 'Dashboard', icon: 'layout-dashboard', path: '/', designed: true },
    { key: 'portfolio', label: 'Portfolio', icon: 'layers', path: '/portfolio', designed: true },
  ] },
  { label: 'OPERATIONS', items: [
    { key: 'reservations', label: 'Reservations', icon: 'calendar-days', children: [
      { key: 'calendar', label: 'Calendar', path: '/reservations/calendar', designed: true },
      { key: 'bookings', label: 'Bookings', path: '/reservations/bookings', designed: true },
      { key: 'guests', label: 'Guests', path: '/reservations/guests', designed: true },
    ] },
    { key: 'operations', label: 'Operations', icon: 'clipboard-check', badge: 'today', children: [
      { key: 'today', label: 'Today', path: '/operations/today', badge: 'today', designed: true },
      { key: 'housekeeping', label: 'Housekeeping', path: '/operations/housekeeping', designed: true },
      { key: 'maintenance', label: 'Maintenance', path: '/operations/maintenance', badge: 'maintenance', designed: true },
      { key: 'tasks', label: 'Tasks', path: '/operations/tasks', designed: true },
      { key: 'inspections', label: 'Inspections', path: '/operations/inspections', designed: true },
    ] },
    { key: 'properties', label: 'Properties', icon: 'building-2', children: [
      { key: 'propertyList', label: 'Properties', path: '/properties', designed: true },
      { key: 'units', label: 'Units', path: '/properties/units', designed: true },
      { key: 'inventory', label: 'Inventory', path: '/properties/inventory', designed: true },
      { key: 'access', label: 'Access and keys', path: '/properties/access', designed: true },
    ] },
    // Service cases and Projects sit here as they do in Houzs. They come from the supply chain engine and
    // have no built-in screens, so they open only where the engine is set up (src/lib/scmEngine.ts).
    { key: 'serviceCases', label: 'Service cases', icon: 'zap', children: [
      { key: 'serviceCaseList', label: 'Service cases', path: '/service/cases', designed: true },
      { key: 'serviceMetrics', label: 'Quality metrics', path: '/service/metrics', designed: true },
      { key: 'serviceMaintenance', label: 'Service maintenance', path: '/service/maintenance', designed: true },
      { key: 'myCases', label: 'My cases', path: '/service/my-cases', designed: true },
    ] },
    { key: 'projects', label: 'Projects', icon: 'folder-kanban', children: [
      { key: 'projectList', label: 'Project list', path: '/projects/list', designed: true },
      { key: 'projectCalendar', label: 'Calendar', path: '/projects/calendar', designed: true },
      { key: 'projectFinances', label: 'Finances', path: '/projects/finances', designed: true },
      { key: 'projectMaintenance', label: 'Project maintenance', path: '/projects/maintenance', designed: true },
    ] },
  ] },
  // Supply Chain — mirrors Houzs's nav hierarchy: L1 group (Supply Chain) → L2 collapsible
  // sections (Procurement / Warehouse / Sales / Transportation / Furniture) → L3 pages.
  { label: 'SUPPLY CHAIN', items: [
    { key: 'scSales', label: 'Sales order', icon: 'shopping-cart', children: [
      { key: 'salesOrders', label: 'Sales orders', path: '/sales/orders', designed: true },
      { key: 'salesOrderAmendment', label: 'Sales order amendment', path: '/sales/amendments', designed: true },
      { key: 'deliveryOrders', label: 'Delivery orders', path: '/sales/delivery-orders', designed: true },
      { key: 'salesInvoices', label: 'Sales invoices', path: '/sales/invoices', designed: true },
      { key: 'salesReturns', label: 'Delivery returns', path: '/sales/returns', designed: true },
    ] },
    { key: 'scConsignment', label: 'Consignment', icon: 'handshake', children: [
      { key: 'consignmentOrder', label: 'Consignment order', path: '/consignment/order', designed: true },
      { key: 'consignmentNotes', label: 'Consignment note', path: '/sales/consignment-notes', designed: true },
      { key: 'consignmentReturn', label: 'Consignment return', path: '/consignment/return', designed: true },
      { key: 'purchaseConsignment', label: 'Purchase consignment order', path: '/procurement/consignment', designed: true },
      { key: 'purchaseConsignmentReceive', label: 'Purchase consignment receive', path: '/consignment/purchase-receive', designed: true },
      { key: 'purchaseConsignmentReturn', label: 'Purchase consignment return', path: '/consignment/purchase-return', designed: true },
    ] },
    { key: 'scProcurement', label: 'Procurement', icon: 'package', children: [
      { key: 'procurement', label: 'Products & Maintenance', path: '/procurement/products', designed: true },
      { key: 'suppliers', label: 'Suppliers', path: '/procurement/suppliers', designed: true },
      { key: 'mrp', label: 'MRP · Stock Status', path: '/procurement/mrp', designed: true },
      { key: 'purchaseOrders', label: 'Purchase orders', path: '/procurement/purchase-orders', designed: true },
      { key: 'poAmendments', label: 'PO amendments', path: '/procurement/po-amendments', designed: true },
      { key: 'cancellationRequests', label: 'Cancellation requests', path: '/procurement/cancellations', designed: true },
      { key: 'goodsReceived', label: 'Goods receipt', path: '/procurement/goods-received', designed: true },
      { key: 'purchaseInvoices', label: 'Purchase invoices', path: '/procurement/purchase-invoices', designed: true },
      { key: 'purchaseReturns', label: 'Purchase returns', path: '/procurement/purchase-returns', designed: true },
    ] },
    { key: 'scTransportPlan', label: 'Transportation', icon: 'truck', children: [
      { key: 'deliveryPlanning', label: 'Delivery planning', path: '/transport/planning', designed: true },
      { key: 'dpOrders', label: 'DP orders', path: '/transport/dp-orders', designed: true },
      { key: 'deliveryDates', label: 'Delivery date arrangement', path: '/transport/delivery-dates', designed: true },
      { key: 'deliveryTimes', label: 'Delivery time arrangement', path: '/transport/delivery-times', designed: true },
      { key: 'lastMile', label: 'Last mile delivery', path: '/transport/last-mile', designed: true },
    ] },
    { key: 'scWarehouse', label: 'Warehouse', icon: 'warehouse', children: [
      { key: 'loadingList', label: 'Loading list', path: '/procurement/loading-list', designed: true },
      { key: 'warehouses', label: 'Warehouses', path: '/procurement/warehouses', designed: true },
      { key: 'racksBins', label: 'Racks & bins', path: '/procurement/racks', designed: true },
      { key: 'stock', label: 'Inventory', path: '/procurement/stock', designed: true },
      { key: 'adjustments', label: 'Adjustments', path: '/procurement/adjustments', designed: true },
      { key: 'stockTransfers', label: 'Transfers', path: '/procurement/stock-transfers', designed: true },
      { key: 'stockTakes', label: 'Stock take', path: '/procurement/stock-takes', designed: true },
    ] },
    // Houzs keeps credit / debit notes under Finance › Money in; finance roles only.
  ] },
  { label: 'FINANCE', items: [
    { key: 'finance', label: 'Finance', icon: 'wallet', badge: 'statements', children: [
      { key: 'revenue', label: 'Revenue', path: '/finance/revenue', designed: true },
      { key: 'expenses', label: 'Expenses', path: '/finance/expenses', designed: true },
      { key: 'statements', label: 'Owner statements', path: '/finance/statements', badge: 'statements', designed: true },
      { key: 'payouts', label: 'Payouts', path: '/finance/payouts', designed: true },
    ] },
    { key: 'owners', label: 'Owners', icon: 'users', children: [
      { key: 'ownerList', label: 'Owners', path: '/owners', designed: true },
      { key: 'contracts', label: 'Contracts', path: '/owners/contracts', designed: true },
    ] },
  ] },
  { label: 'GROWTH', items: [
    { key: 'performance', label: 'Performance', icon: 'trending-up', children: [
      { key: 'analytics', label: 'Analytics', path: '/performance/analytics', designed: true },
      { key: 'pricing', label: 'Pricing', path: '/performance/pricing', designed: true },
      { key: 'reviews', label: 'Reviews', path: '/performance/reviews', designed: true },
    ] },
    { key: 'comms', label: 'Communication', icon: 'inbox', badge: 'inbox', children: [
      { key: 'inbox', label: 'Inbox', path: '/communication/inbox', badge: 'inbox', designed: true },
      { key: 'automations', label: 'Automations', path: '/communication/automations', designed: true },
    ] },
  ] },
  { label: 'SYSTEM', items: [
    { key: 'users', label: 'Users and roles', icon: 'shield-check', path: '/system/users', designed: true },
    { key: 'integrations', label: 'Integrations', icon: 'plug', path: '/system/integrations', designed: true },
    { key: 'settings', label: 'Settings', icon: 'settings', path: '/system/settings', designed: true },
    { key: 'health', label: 'System health', icon: 'activity', path: '/system/health', designed: true },
  ] },
];

/** Destinations a role cannot reach are removed, never disabled — routes.json permissionRules.
 *  System health matches MASTER_ROLES in functions/api/system/health (management, finance,
 *  operations managers): keep the two in sync. */
const DENY: Partial<Record<UserRole, string[]>> = {
  // salesInvoices / purchaseInvoices match MONEY_ONLY in functions/api/_middleware.ts.
  operations_staff: ['finance', 'owners', 'users', 'integrations', 'settings', 'portfolio', 'health', 'salesInvoices', 'purchaseInvoices'],
  finance_admin: ['operations', 'comms'],
  housekeeper: ['*'],
  technician: ['*'],
  owner: ['*'],
};

export function navFor(role: UserRole): NavGroup[] {
  const deny = DENY[role] ?? [];
  if (deny.includes('*')) return [];
  return NAV
    .map(g => ({ ...g, items: g.items.filter(i => !deny.includes(i.key))
      .map(i => i.children ? { ...i, children: i.children.filter(c => !deny.includes(c.key)) } : i) }))
    .filter(g => g.items.length > 0);
}

/** role → landing path. The server returns this as `home`; kept here for the client guard. */
export const HOME: Record<UserRole, string> = {
  management: '/', operations_manager: '/', operations_staff: '/operations/today',
  finance_admin: '/finance/statements', housekeeper: '/field/today',
  technician: '/field/today', owner: '/owner',
};

export function findNav(path: string): { group: string; item: string; label: string } | null {
  for (const g of NAV) for (const it of g.items) {
    if (it.path === path) return { group: g.label, item: it.label, label: it.label };
    for (const c of it.children ?? []) if (c.path === path) return { group: g.label, item: it.label, label: c.label };
  }
  return null;
}
