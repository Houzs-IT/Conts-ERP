import type { UserRole } from './types';

export interface NavChild { key: string; label: string; path: string; badge?: string; designed?: boolean }
export interface NavItem {
  key: string; label: string; icon: string; path?: string;
  badge?: string; designed?: boolean; children?: NavChild[];
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
    { key: 'operations', label: 'Operations', icon: 'clipboard-check', badge: '7', children: [
      { key: 'today', label: 'Today', path: '/operations/today', badge: '7', designed: true },
      { key: 'housekeeping', label: 'Housekeeping', path: '/operations/housekeeping', designed: true },
      { key: 'maintenance', label: 'Maintenance', path: '/operations/maintenance', badge: '3', designed: true },
      { key: 'tasks', label: 'Tasks', path: '/operations/tasks', designed: true },
      { key: 'inspections', label: 'Inspections', path: '/operations/inspections', designed: true },
    ] },
    { key: 'properties', label: 'Properties', icon: 'building-2', children: [
      { key: 'propertyList', label: 'Properties', path: '/properties', designed: true },
      { key: 'units', label: 'Units', path: '/properties/units', designed: true },
      { key: 'inventory', label: 'Inventory', path: '/properties/inventory', designed: true },
      { key: 'access', label: 'Access and keys', path: '/properties/access', designed: true },
    ] },
  ] },
  { label: 'PROCUREMENT', items: [
    { key: 'procurement', label: 'Products and maintenance', icon: 'package', path: '/procurement/products', designed: true },
    { key: 'suppliers', label: 'Suppliers', icon: 'truck', path: '/procurement/suppliers', designed: true },
    { key: 'productModels', label: 'Product models', icon: 'boxes', path: '/procurement/product-models', designed: true },
    { key: 'categories', label: 'Categories', icon: 'tags', path: '/procurement/categories', designed: true },
    { key: 'warehouses', label: 'Warehouses', icon: 'warehouse', path: '/procurement/warehouses', designed: true },
  ] },
  { label: 'FINANCE', items: [
    { key: 'finance', label: 'Finance', icon: 'wallet', badge: '2', children: [
      { key: 'revenue', label: 'Revenue', path: '/finance/revenue', designed: true },
      { key: 'expenses', label: 'Expenses', path: '/finance/expenses', designed: true },
      { key: 'statements', label: 'Owner statements', path: '/finance/statements', badge: '2', designed: true },
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
    { key: 'comms', label: 'Communication', icon: 'inbox', badge: '5', children: [
      { key: 'inbox', label: 'Inbox', path: '/communication/inbox', badge: '5', designed: true },
      { key: 'automations', label: 'Automations', path: '/communication/automations', designed: true },
    ] },
  ] },
  { label: 'SYSTEM', items: [
    { key: 'users', label: 'Users and roles', icon: 'shield-check', path: '/system/users', designed: true },
    { key: 'integrations', label: 'Integrations', icon: 'plug', path: '/system/integrations', designed: true },
    { key: 'settings', label: 'Settings', icon: 'settings', path: '/system/settings', designed: true },
  ] },
];

/** Destinations a role cannot reach are removed, never disabled — routes.json permissionRules. */
const DENY: Partial<Record<UserRole, string[]>> = {
  operations_staff: ['finance', 'owners', 'users', 'integrations', 'settings', 'portfolio'],
  finance_admin: ['operations', 'comms'],
  housekeeper: ['*'],
  technician: ['*'],
  owner: ['*'],
};

export function navFor(role: UserRole): NavGroup[] {
  const deny = DENY[role] ?? [];
  if (deny.includes('*')) return [];
  return NAV
    .map(g => ({ ...g, items: g.items.filter(i => !deny.includes(i.key)) }))
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
