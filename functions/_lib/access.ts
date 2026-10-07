import { type Env, all } from './db';

export type Level = 'none' | 'view' | 'edit' | 'full';
export const LEVELS: Level[] = ['none', 'view', 'edit', 'full'];
const RANK: Record<Level, number> = { none: 0, view: 1, edit: 2, full: 3 };

/** Roles whose access management can change. Management is always full (nobody can lock the system);
 *  housekeepers, technicians and owners use their own apps and are fixed. */
export const EDITABLE_ROLES = ['operations_manager', 'operations_staff', 'finance_admin'];
const MASTER = ['management', 'operations_manager', 'finance_admin'];

export interface Area {
  key: string; label: string; group: string;
  /** First segment under /api that belongs to this area. */
  api: string[];
  /** Management-only today: any access to it carries the management-only actions inside it. */
  managed?: boolean;
  /** Reads are refused too when the level is none. Elsewhere only writes are, because other screens
   *  read across areas (the calendar reads units, a task reads its property). */
  strictRead?: boolean;
  /** Built-in level where it differs from the role's usual one. */
  defaults?: Partial<Record<string, Level>>;
}

const OPS_NONE = { operations_staff: 'none' as Level };

export const AREAS: Area[] = [
  { key: 'dashboard', label: 'Dashboard', group: 'Workspace', api: ['dashboard'] },
  { key: 'portfolio', label: 'Portfolio', group: 'Workspace', api: ['portfolio'], managed: true, strictRead: true, defaults: OPS_NONE },
  { key: 'reservations', label: 'Reservations', group: 'Operations', api: ['reservations', 'guests', 'blocks'] },
  { key: 'operations', label: 'Operations', group: 'Operations', api: ['operations', 'housekeeping', 'maintenance', 'tasks', 'inspections'], defaults: { finance_admin: 'none' } },
  { key: 'properties', label: 'Properties', group: 'Operations', api: ['properties', 'units', 'inventory', 'access-credentials', 'residence-rules'] },
  { key: 'serviceCases', label: 'Service cases', group: 'Operations', api: [] },
  { key: 'projects', label: 'Projects', group: 'Operations', api: [] },
  { key: 'scSales', label: 'Sales order', group: 'Supply chain', api: ['sales-orders', 'so-amendments', 'delivery-orders', 'sales-returns', 'customers'] },
  { key: 'scInvoices', label: 'Invoices and payments', group: 'Supply chain', api: ['payment-vouchers', 'purchase-invoices', 'sales-invoices', 'unbilled-deliveries', 'credit-notes', 'accounting'], managed: true, strictRead: true, defaults: OPS_NONE },
  { key: 'scConsignment', label: 'Consignment', group: 'Supply chain', api: ['consignment-notes', 'purchase-consignment'] },
  { key: 'scProcurement', label: 'Procurement', group: 'Supply chain', api: ['products', 'product-models', 'categories', 'fabrics', 'suppliers', 'mrp', 'purchase-orders', 'goods-receipts', 'purchase-returns'] },
  { key: 'scTransportPlan', label: 'Transportation', group: 'Supply chain', api: ['delivery-schedule', 'delivery-zones', 'driver-leave', 'drivers', 'fleet-health', 'coverage-fleet', 'vehicles', 'threepl-companies', 'rate-cards'] },
  { key: 'scWarehouse', label: 'Warehouse', group: 'Supply chain', api: ['loading-list', 'warehouses', 'racks', 'stock', 'stock-takes', 'stock-transfers'] },
  { key: 'finance', label: 'Finance', group: 'Finance', api: ['finance', 'expenses', 'statements', 'payouts'], managed: true, strictRead: true, defaults: OPS_NONE },
  { key: 'owners', label: 'Owners', group: 'Finance', api: ['owners', 'contracts'], defaults: OPS_NONE },
  { key: 'performance', label: 'Performance', group: 'Growth', api: ['analytics', 'pricing', 'rates', 'reviews'] },
  { key: 'comms', label: 'Communication', group: 'Growth', api: ['messages', 'automations'], defaults: { finance_admin: 'none' } },
  { key: 'users', label: 'Users and roles', group: 'System', api: ['users'], managed: true, defaults: OPS_NONE },
  { key: 'integrations', label: 'Integrations', group: 'System', api: ['integrations'], managed: true, defaults: OPS_NONE },
  { key: 'settings', label: 'Settings', group: 'System', api: ['settings'], managed: true, defaults: OPS_NONE },
  { key: 'health', label: 'System health', group: 'System', api: ['system', 'audit'], managed: true, defaults: OPS_NONE },
];

const BY_KEY = new Map(AREAS.map(a => [a.key, a]));
const BY_API = new Map(AREAS.flatMap(a => a.api.map(s => [s, a] as const)));

/** What the role gets in an area when management has not chosen: full for the three management-side
 *  roles, day-to-day editing for operations staff, less where `defaults` says so. */
export function builtIn(role: string, area: Area): Level {
  return area.defaults?.[role] ?? (MASTER.includes(role) ? 'full' : 'edit');
}

type Chosen = Map<string, Level>; // `${role}:${area}`
let cache: { at: number; rows: Chosen } | null = null;
const CACHE_MS = 10_000;

export function forgetAccess() { cache = null; }

async function chosen(env: Env): Promise<Chosen> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.rows;
  let rows: Chosen = new Map();
  try {
    const r = await all<{ role: string; area: string; level: Level }>(env, 'SELECT role, area, level FROM role_access');
    rows = new Map(r.filter(x => BY_KEY.has(x.area) && LEVELS.includes(x.level)).map(x => [`${x.role}:${x.area}`, x.level]));
  } catch {
    // The table arrives with migration 0049; until then nothing is chosen and the built-in rules stand.
  }
  cache = { at: Date.now(), rows };
  return rows;
}

export function areaForPath(path: string): Area | null {
  const seg = /^\/api\/([^/]+)/.exec(path)?.[1];
  return seg ? BY_API.get(seg) ?? null : null;
}

export interface Access { area: Area | null; level: Level; chosen: boolean }

/** The role's level for the area a request belongs to. `chosen` is true only where management set it:
 *  the built-in level is for display, and the checks that existed before this table still decide. */
export async function accessFor(env: Env, role: string, path: string): Promise<Access> {
  const area = areaForPath(path);
  if (!area) return { area: null, level: 'full', chosen: false };
  const picked = EDITABLE_ROLES.includes(role) ? (await chosen(env)).get(`${role}:${area.key}`) : undefined;
  return { area, level: picked ?? builtIn(role, area), chosen: picked !== undefined };
}

/** Whether the management-only actions in the request's area are open to this role. */
export function canManage(role: string, a: Access): boolean {
  if (!a.chosen || !a.area) return MASTER.includes(role);
  return a.level === 'full' || (!!a.area.managed && a.level !== 'none');
}

/** A refusal for the request, or null. Only levels management chose are enforced here. */
export function refusalFor(a: Access, method: string): string | null {
  if (!a.chosen || !a.area) return null;
  const read = method === 'GET' || method === 'HEAD';
  if (read) return a.level === 'none' && a.area.strictRead ? `Your role does not have access to ${a.area.label}.` : null;
  return RANK[a.level] < RANK.edit ? `Your role can ${a.level === 'view' ? 'view but not change' : 'not use'} ${a.area.label}.` : null;
}

/** Every area's level for one role: what its menu and screens follow. */
export async function levelsFor(env: Env, role: string): Promise<Record<string, Level>> {
  const rows = EDITABLE_ROLES.includes(role) ? await chosen(env) : new Map<string, Level>();
  return Object.fromEntries(AREAS.map(a => [a.key, rows.get(`${role}:${a.key}`) ?? builtIn(role, a)]));
}

/** The whole chart for the Permissions tab. */
export async function chart(env: Env) {
  const rows = await chosen(env);
  return AREAS.map(a => ({
    key: a.key, label: a.label, group: a.group, managed: !!a.managed,
    roles: Object.fromEntries(EDITABLE_ROLES.map(r => {
      const picked = rows.get(`${r}:${a.key}`);
      return [r, { level: picked ?? builtIn(r, a), builtIn: builtIn(r, a), chosen: picked !== undefined }];
    })),
  }));
}
