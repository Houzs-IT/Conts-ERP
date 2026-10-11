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
  /** Kept for the Permissions chart's wording. Reads are refused at "No access" in every area now; the few
   *  reads other screens share across areas are listed in SHARED_READS instead. */
  strictRead?: boolean;
  /** Built-in level where it differs from the role's usual one. */
  defaults?: Partial<Record<string, Level>>;
}

const OPS_NONE = { operations_staff: 'none' as Level };

export const AREAS: Area[] = [
  { key: 'dashboard', label: 'Dashboard', group: 'Workspace', api: ['dashboard'] },
  { key: 'portfolio', label: 'Portfolio', group: 'Workspace', api: ['portfolio'], managed: true, strictRead: true, defaults: OPS_NONE },
  // Reservations arrive from the channels through the API; finance reads them but does not create or change them (owner, 11 Oct 2026).
  { key: 'reservations', label: 'Reservations', group: 'Operations', api: ['reservations', 'guests', 'blocks', 'guest-documents'], defaults: { finance_admin: 'view' } },
  { key: 'operations', label: 'Operations', group: 'Operations', api: ['operations', 'housekeeping', 'maintenance', 'tasks'], defaults: { finance_admin: 'none' } },
  { key: 'properties', label: 'Units', group: 'Operations', api: ['properties', 'units', 'inventory', 'access-credentials', 'residence-rules'] },
  { key: 'serviceCases', label: 'Service cases', group: 'Operations', api: [] },
  { key: 'projects', label: 'Projects', group: 'Operations', api: [], defaults: { operations_staff: 'view' } },
  { key: 'scSales', label: 'Sales order', group: 'Supply chain', api: ['sales-orders', 'so-amendments', 'delivery-orders', 'sales-returns', 'customers'] },
  { key: 'scInvoices', label: 'Invoices and payments', group: 'Supply chain', api: ['payment-vouchers', 'purchase-invoices', 'sales-invoices', 'unbilled-deliveries', 'credit-notes', 'accounting'], managed: true, strictRead: true, defaults: OPS_NONE },
  { key: 'scConsignment', label: 'Consignment', group: 'Supply chain', api: ['consignment-notes', 'purchase-consignment'] },
  { key: 'scProcurement', label: 'Procurement', group: 'Supply chain', api: ['products', 'product-models', 'categories', 'fabrics', 'suppliers', 'mrp', 'purchase-orders', 'goods-receipts', 'purchase-returns'] },
  { key: 'scTransportPlan', label: 'Transportation', group: 'Supply chain', api: ['delivery-schedule', 'delivery-zones', 'driver-leave', 'drivers', 'fleet-health', 'coverage-fleet', 'vehicles', 'threepl-companies', 'rate-cards'] },
  { key: 'scWarehouse', label: 'Warehouse', group: 'Supply chain', api: ['loading-list', 'warehouses', 'racks', 'stock', 'stock-takes', 'stock-transfers'] },
  // 'owner': the owner portal's endpoints, which finance and management also open as an owner (?ownerId=).
  { key: 'finance', label: 'Finance', group: 'Finance', api: ['finance', 'expenses', 'statements', 'payouts', 'approvals', 'owner'], managed: true, strictRead: true, defaults: OPS_NONE },
  { key: 'owners', label: 'Owners', group: 'Finance', api: ['owners', 'contracts'], defaults: OPS_NONE },
  { key: 'performance', label: 'Performance', group: 'Growth', api: ['analytics', 'pricing', 'rates', 'reviews'] },
  { key: 'comms', label: 'Communication', group: 'Growth', api: ['messages', 'automations'], defaults: { finance_admin: 'none' } },
  // The user list is read by management and operations managers only (functions/api/users), so finance admins start at none.
  { key: 'users', label: 'Users and roles', group: 'System', api: ['users'], managed: true, defaults: { ...OPS_NONE, finance_admin: 'none' } },
  { key: 'integrations', label: 'Integrations', group: 'System', api: ['integrations'], managed: true, defaults: OPS_NONE },
  { key: 'settings', label: 'Settings', group: 'System', api: ['settings'], managed: true, defaults: OPS_NONE },
  { key: 'health', label: 'System health', group: 'System', api: ['system', 'audit'], managed: true, defaults: OPS_NONE },
];

const BY_KEY = new Map(AREAS.map(a => [a.key, a]));
const BY_API = new Map(AREAS.flatMap(a => a.api.map(s => [s, a] as const)));

/** What the role gets in an area when management has not chosen: full for the three management-side
 *  roles, day-to-day editing for operations staff, less where `defaults` says so. */
export function builtIn(role: string, area: Area): Level {
  if (role === 'management') return 'full';
  // Housekeepers, technicians and owners have their own apps and no desk areas: the session middleware lets
  // them reach only the routes their apps call (FIELD_ALLOWED, OWNER_ALLOWED in functions/api/_middleware.ts).
  if (!EDITABLE_ROLES.includes(role)) return 'none';
  return area.defaults?.[role] ?? (MASTER.includes(role) ? 'full' : 'edit');
}

/**
 * Endpoints that belong to a different area than their first path segment says, because a screen of that other
 * area is the one that calls them. Matched before the segment. area null: a read every desk role needs whatever
 * its levels (a picker's reference list); the handler's own checks still apply.
 */
export const ROUTE_AREAS: { method: string; path: RegExp; area: string | null; why: string }[] = [
  { method: 'GET', path: /^\/api\/units$/, area: null, why: 'The unit list feeds every unit picker (calendar, cleaning, maintenance, reservations, expenses).' },
  { method: 'GET', path: /^\/api\/housekeeping\/(cleaners|crew)$/, area: null, why: 'Names of the cleaners for the assign pickers on the dashboard and in reservations.' },
  { method: 'GET', path: /^\/api\/integrations$/, area: 'reservations', why: 'The calendar shows which channels each unit is connected to.' },
  { method: 'POST', path: /^\/api\/integrations\/sync$/, area: 'reservations', why: 'The calendar\'s button that gets new reservations from the channels.' },
  { method: 'POST', path: /^\/api\/owners\/[^/]+\/notify$/, area: 'dashboard', why: 'The dashboard\'s exception action that tells an owner about a problem with their unit.' },
  { method: 'POST', path: /^\/api\/messages$/, area: 'reservations', why: 'Messaging a guest from a reservation or a guest record; Messages itself stays under Communication.' },
  { method: 'POST', path: /^\/api\/maintenance\/issues\/[^/]+\/approve$/, area: 'finance', why: 'Recording an owner\'s approval of a repair quote is a money decision.' },
  { method: 'GET', path: /^\/api\/audit$/, area: null, why: 'The History panel on every record: the handler applies the area of the record asked for; the whole trail stays management and finance only.' },
  { method: 'GET', path: /^\/api\/(warehouses|suppliers|drivers|vehicles|threepl-companies)$/, area: null, why: 'Supply chain reference lists that every supply chain screen picks from.' },
];

function routeArea(method: string, path: string): Area | null {
  const o = ROUTE_AREAS.find(r => (r.method === method || (method === 'HEAD' && r.method === 'GET')) && r.path.test(path));
  if (o) return o.area ? BY_KEY.get(o.area) ?? null : null;
  return areaForPath(path);
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


export interface Access { area: Area | null; level: Level; chosen: boolean; role: string }

/** The role's level for the area a request belongs to: the level management chose, or the built-in one.
 *  `chosen` is true only where management set it; handlers with their own role lists follow a chosen level
 *  (mayWork / maySee / mayRun) and otherwise keep their lists. */
export async function accessFor(env: Env, role: string, path: string, method = 'GET'): Promise<Access> {
  const area = routeArea(method, path);
  if (!area) return { area: null, level: 'full', chosen: false, role };
  const picked = EDITABLE_ROLES.includes(role) ? (await chosen(env)).get(`${role}:${area.key}`) : undefined;
  return { area, level: picked ?? builtIn(role, area), chosen: picked !== undefined, role };
}

/** Whether the management-only actions in the request's area are open to this role. */
export function canManage(role: string, a: Access): boolean {
  if (!a.chosen || !a.area) return MASTER.includes(role);
  return a.level === 'full' || (!!a.area.managed && a.level !== 'none');
}

/** A refusal for the request, or null. For the three roles on the Permissions chart the level it shows is the
 *  level enforced, chosen or built in: No access refuses reads and writes, View refuses writes. Management is
 *  always full; field and owner accounts are limited to their apps' routes by the session middleware. */
export function refusalFor(a: Access, method: string): string | null {
  if (!a.area || !EDITABLE_ROLES.includes(a.role)) return null;
  const read = method === 'GET' || method === 'HEAD';
  if (read) return a.level === 'none' ? `Your role does not have access to ${a.area.label}.` : null;
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

/** The three questions the handlers ask, for rules that name roles themselves. Where management chose a
 *  level for the request's area (`picked`), the level answers; otherwise the handler's own list does. */
interface Asker { role: string; picked?: Level | null }
/** Day-to-day work: create and update. */
export const mayWork = (s: Asker, roles: string[]) => s.picked ? RANK[s.picked] >= RANK.edit : roles.includes(s.role);
/** Open and read. */
export const maySee = (s: Asker, roles: string[]) => s.picked ? s.picked !== 'none' : roles.includes(s.role);
/** A management-only action: Full only. */
export const mayRun = (s: Asker, roles: string[]) => s.picked ? s.picked === 'full' : roles.includes(s.role);
