import { type Env, all } from './db';

export type Level = 'none' | 'view' | 'edit' | 'full';
export const LEVELS: Level[] = ['none', 'view', 'edit', 'full'];
const RANK: Record<Level, number> = { none: 0, view: 1, edit: 2, full: 3 };
/** A module's own setting: 'inherit' follows its category's baseline, a level overrides it. */
export type Setting = Level | 'inherit';
export const isLevel = (v: unknown): v is Level => typeof v === 'string' && (LEVELS as string[]).includes(v);
export const isSetting = (v: unknown): v is Setting => v === 'inherit' || isLevel(v);

/** Roles whose access management can change. Management is always full (nobody can lock the system);
 *  housekeepers, technicians and owners use their own apps and are fixed. */
export const EDITABLE_ROLES = ['operations_manager', 'operations_staff', 'finance_admin'];
const MASTER = ['management', 'operations_manager', 'finance_admin'];
/** The highest level a role may be given anywhere. Operations staff are not an administrative role, so no
 *  category or module can be raised to Full for them, by the chart or by a stored row. */
export const ROLE_MAX: Record<string, Level> = { operations_staff: 'edit' };
const capped = (role: string, l: Level): Level => {
  const max = ROLE_MAX[role];
  return max && RANK[l] > RANK[max] ? max : l;
};

export interface Area {
  key: string; label: string; group: string;
  /** First segment under /api that belongs to this area. */
  api: string[];
  /** Management-only today: any access to it carries the management-only actions inside it. */
  managed?: boolean;
  /** Kept for the Permissions chart's wording. Reads are refused at "No access" in every area now; the few
   *  reads other screens share across areas are listed in SHARED_READS instead. */
  strictRead?: boolean;
  /** Built-in module override where it differs from its category's baseline (GROUP_DEFAULTS). */
  defaults?: Partial<Record<string, Level>>;
}

/** Which side of the business an account works on (migration 0143): The Conts is rental, Dream Crafter the supply
 *  chain. A side only closes the other side's areas; it never opens what the role does not allow. */
export type Side = 'conts' | 'dream_crafter' | 'both';
export const SIDES: Side[] = ['conts', 'dream_crafter', 'both'];
export const isSide = (v: unknown): v is Side => typeof v === 'string' && (SIDES as string[]).includes(v);

/** The area groups each side closes. Finance and System are on neither list, so they follow the role. */
const CLOSED_BY_SIDE: Record<Side, string[]> = {
  conts: ['Dream Crafter'],
  dream_crafter: ['Workspace', 'Operations', 'Growth'],
  both: [],
};
/** Management always sees both sides, so nobody can lock the system out of one. */
const offSide = (role: string, side: Side, area: Area) => role !== 'management' && CLOSED_BY_SIDE[side].includes(area.group);

/**
 * Built-in category baselines, level 1 of the chart (owner's RBAC table, 23 Oct 2026). Every module in a category
 * inherits its baseline unless the module has its own override (Area.defaults or a stored row). Growth and System
 * were not in that table and keep the levels they had before.
 */
export const GROUP_DEFAULTS: Record<string, Partial<Record<string, Level>>> = {
  Workspace: { operations_manager: 'full', operations_staff: 'none', finance_admin: 'view' },
  Operations: { operations_manager: 'full', operations_staff: 'edit', finance_admin: 'view' },
  'Dream Crafter': { operations_manager: 'full', operations_staff: 'edit', finance_admin: 'view' },
  Finance: { operations_manager: 'view', operations_staff: 'none', finance_admin: 'full' },
  Growth: { operations_manager: 'full', operations_staff: 'edit', finance_admin: 'full' },
  System: { operations_manager: 'full', operations_staff: 'none', finance_admin: 'full' },
};

export const AREAS: Area[] = [
  { key: 'dashboard', label: 'Dashboard', group: 'Workspace', api: ['dashboard'] },
  { key: 'portfolio', label: 'Portfolio', group: 'Workspace', api: ['portfolio'], managed: true, strictRead: true },
  // Reservations arrive from the channels through the API; finance reads them but does not create or change them (owner, 11 Oct 2026).
  { key: 'reservations', label: 'Reservations', group: 'Operations', api: ['reservations', 'guests', 'blocks', 'guest-documents'] },
  { key: 'operations', label: 'Operations', group: 'Operations', api: ['operations', 'housekeeping', 'maintenance', 'tasks'] },
  { key: 'properties', label: 'Units', group: 'Operations', api: ['properties', 'units', 'inventory', 'access-credentials', 'residence-rules', 'lettings'] },
  { key: 'serviceCases', label: 'Service cases', group: 'Dream Crafter', api: [] },
  { key: 'projects', label: 'Projects', group: 'Dream Crafter', api: [] },
  { key: 'scSales', label: 'Sales order', group: 'Dream Crafter', api: ['sales-orders', 'so-amendments', 'delivery-orders', 'sales-returns', 'customers'] },
  { key: 'scInvoices', label: 'Invoices and payments', group: 'Dream Crafter', api: ['payment-vouchers', 'purchase-invoices', 'sales-invoices', 'unbilled-deliveries', 'credit-notes', 'accounting'], managed: true, strictRead: true,
    defaults: { operations_manager: 'view', operations_staff: 'none', finance_admin: 'full' } },
  { key: 'scConsignment', label: 'Consignment', group: 'Dream Crafter', api: ['consignment-notes', 'purchase-consignment'] },
  { key: 'scProcurement', label: 'Procurement', group: 'Dream Crafter', api: ['products', 'product-models', 'categories', 'fabrics', 'suppliers', 'mrp', 'purchase-orders', 'goods-receipts', 'purchase-returns'] },
  { key: 'scTransportPlan', label: 'Transportation', group: 'Dream Crafter', api: ['delivery-schedule', 'delivery-zones', 'driver-leave', 'drivers', 'fleet-health', 'coverage-fleet', 'vehicles', 'threepl-companies', 'rate-cards'] },
  { key: 'scWarehouse', label: 'Warehouse', group: 'Dream Crafter', api: ['loading-list', 'warehouses', 'racks', 'stock', 'stock-takes', 'stock-transfers'] },
  // 'owner': the owner portal's endpoints, which finance and management also open as an owner (?ownerId=).
  { key: 'finance', label: 'Finance', group: 'Finance', api: ['finance', 'expenses', 'statements', 'payouts', 'approvals', 'owner'], managed: true, strictRead: true },
  { key: 'owners', label: 'Owners', group: 'Finance', api: ['owners', 'contracts'] },
  // The company ledger in the engine (finance phase 1): no Property OS routes, sent to the engine at sign-on.
  // Operations managers read the rest of Finance but never the company books.
  { key: 'ledger', label: 'Ledger', group: 'Finance', api: [], managed: true, strictRead: true, defaults: { operations_manager: 'none' } },
  { key: 'performance', label: 'Performance', group: 'Growth', api: ['analytics', 'pricing', 'rates', 'reviews'] },
  { key: 'comms', label: 'Communication', group: 'Growth', api: ['messages', 'automations'], defaults: { finance_admin: 'none' } },
  // The user list is read by management and operations managers only (functions/api/users), so finance admins start at none.
  { key: 'users', label: 'Users and roles', group: 'System', api: ['users'], managed: true, defaults: { finance_admin: 'none' } },
  { key: 'integrations', label: 'Integrations', group: 'System', api: ['integrations'], managed: true },
  { key: 'settings', label: 'Settings', group: 'System', api: ['settings'], managed: true },
  { key: 'health', label: 'System health', group: 'System', api: ['system', 'audit'], managed: true },
];

const BY_KEY = new Map(AREAS.map(a => [a.key, a]));
const BY_API = new Map(AREAS.flatMap(a => a.api.map(s => [s, a] as const)));
/** The categories in chart order. A category baseline is stored in role_access under the area key `group:<name>`. */
export const GROUPS: string[] = [...new Set(AREAS.map(a => a.group))];
export const groupKey = (group: string): string => `group:${group}`;
const GROUP_KEYS = new Set(GROUPS.map(groupKey));

/** A category's baseline for the role when management has not chosen one. Housekeepers, technicians and owners
 *  have their own apps and no desk areas: the session middleware lets them reach only the routes their apps call
 *  (FIELD_ALLOWED, OWNER_ALLOWED in functions/api/_middleware.ts). */
export function builtInGroup(role: string, group: string): Level {
  if (role === 'management') return 'full';
  if (!EDITABLE_ROLES.includes(role)) return 'none';
  return capped(role, GROUP_DEFAULTS[group]?.[role] ?? (MASTER.includes(role) ? 'full' : 'edit'));
}

/** A module's own setting for the role when management has not chosen one: inherit, unless Area.defaults overrides. */
export const builtInSetting = (role: string, area: Area): Setting =>
  (EDITABLE_ROLES.includes(role) ? area.defaults?.[role] : undefined) ?? 'inherit';

/** `${role}:${areaKey}` -> module setting, `${role}:group:${group}` -> category baseline. Only what management chose. */
export type Chosen = Map<string, Setting>;
export interface Resolved { level: Level; setting: Setting; groupLevel: Level; chosen: boolean }

/**
 * The two-tier rule. Level 1: the category baseline (chosen, else built in). Level 2: the module's setting (chosen,
 * else built in); 'inherit' takes the baseline, anything else overrides it. Because a module stores 'inherit' rather
 * than a copy of the baseline, changing a baseline moves every inheriting module at once and leaves overrides alone.
 * `chosen` is true when the winning value came from management, which is what tells the handlers to follow the
 * level instead of their own role lists (mayWork / maySee / mayRun).
 */
export function resolve(rows: Chosen, role: string, area: Area): Resolved {
  if (!EDITABLE_ROLES.includes(role)) {
    const level = builtInGroup(role, area.group);
    return { level, setting: 'inherit', groupLevel: level, chosen: false };
  }
  const g = rows.get(`${role}:${groupKey(area.group)}`);
  const groupLevel = isLevel(g) ? capped(role, g) : builtInGroup(role, area.group);
  const m = rows.get(`${role}:${area.key}`);
  const setting = m ?? builtInSetting(role, area);
  const level = setting === 'inherit' ? groupLevel : capped(role, setting);
  return { level, setting, groupLevel, chosen: m !== undefined || (setting === 'inherit' && isLevel(g)) };
}

/** What the role gets in an area when management has chosen nothing. */
export const builtIn = (role: string, area: Area): Level => resolve(new Map(), role, area).level;

/**
 * Permissions by department, position and user (migration 0145, PLAN.md). Nothing calls this yet: accessFor and
 * levelsFor still follow the role. Rules are keyed by area key, or `group:<Category>` for a category baseline.
 */
export type PermissionLevel = Level;
export type DepartmentKind = 'management' | 'staff' | 'cleaning' | 'maintenance';
/** Where a person's level in an area comes from. 'fixed': management, always Full. 'none': nothing sets it. */
export type Origin = 'department' | 'position' | 'user' | 'fixed' | 'none';
export type RuleMap = ReadonlyMap<string, Setting>;
export interface DepartmentRules { rules: RuleMap }
export interface PositionRules { rules: RuleMap }
export interface UserOverrides { rules: RuleMap }
export interface Rules { department: DepartmentRules; position: PositionRules; user: UserOverrides }
export interface Who { userId: string; departmentId: string | null; positionId: string | null; kind: DepartmentKind }
export interface Resolution { level: PermissionLevel; origin: Origin }

const noRules: Rules = { department: { rules: new Map() }, position: { rules: new Map() }, user: { rules: new Map() } };
const levelIn = (rules: RuleMap, key: string): PermissionLevel | null => {
  const v = rules.get(key);
  return isLevel(v) ? v : null;
};

/**
 * One person's level in one area. Management is Full and cannot be changed; cleaning and maintenance have no desk
 * areas. Everyone else: the area's own setting at user, then position, then department; then the category baseline at
 * position, then department; then No access. An area setting at any tier beats every baseline, so a door a department
 * closes explicitly stays closed. 'inherit' counts as not set. The side closing the other side's categories is not
 * part of this.
 */
export function resolveFor(rules: Rules, who: Pick<Who, 'kind'>, area: Area): Resolution {
  if (who.kind === 'management') return { level: 'full', origin: 'fixed' };
  if (who.kind !== 'staff') return { level: 'none', origin: 'none' };
  const group = groupKey(area.group);
  const steps: [Origin, RuleMap, string][] = [
    ['user', rules.user.rules, area.key],
    ['position', rules.position.rules, area.key],
    ['department', rules.department.rules, area.key],
    ['position', rules.position.rules, group],
    ['department', rules.department.rules, group],
  ];
  for (const [origin, map, key] of steps) {
    const level = levelIn(map, key);
    if (level) return { level, origin };
  }
  return { level: 'none', origin: 'none' };
}

/** The stored rules that apply to this person, read in one query. Management and field accounts have none to read. */
export async function rulesFor(env: Env, who: Who): Promise<Rules> {
  if (who.kind !== 'staff') return noRules;
  const rows = await all<{ scope: string; area: string; level: string }>(env,
    `SELECT scope, area, level FROM access_rules
      WHERE (scope = 'user' AND scope_id = ?) OR (scope = 'position' AND scope_id = ?) OR (scope = 'department' AND scope_id = ?)`,
    who.userId, who.positionId, who.departmentId);
  const maps = { department: new Map<string, Setting>(), position: new Map<string, Setting>(), user: new Map<string, Setting>() };
  for (const r of rows) {
    if (r.scope !== 'department' && r.scope !== 'position' && r.scope !== 'user') continue;
    // A category row holds a level; an area row a level or 'inherit', as in role_access.
    if ((GROUP_KEYS.has(r.area) && isLevel(r.level)) || (BY_KEY.has(r.area) && isSetting(r.level))) maps[r.scope].set(r.area, r.level);
  }
  return { department: { rules: maps.department }, position: { rules: maps.position }, user: { rules: maps.user } };
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
  // Finance reads bookings but does not make or change them (owner, 11 Oct 2026); taking a guest's payment, recording
  // a channel payout and issuing a receipt are finance's own work, so those writes follow the Finance area.
  { method: 'POST', path: /^\/api\/reservations\/[^/]+\/payments$/, area: 'finance', why: 'Recording a guest payment on a reservation is money work.' },
  { method: 'DELETE', path: /^\/api\/reservations\/[^/]+\/payments\/[^/]+$/, area: 'finance', why: 'Removing a wrongly recorded guest payment is money work.' },
  { method: 'POST', path: /^\/api\/reservations\/[^/]+\/late-checkout\/paid$/, area: 'finance', why: 'Marking a late checkout paid records a guest payment.' },
  { method: 'POST', path: /^\/api\/reservations\/mark-paid-out$/, area: 'finance', why: 'Recording a channel payout is money work.' },
  { method: 'POST', path: /^\/api\/guest-documents$/, area: 'finance', why: 'Issuing a guest receipt or invoice is money work.' },
  { method: 'POST', path: /^\/api\/guest-documents\/[^/]+\/void$/, area: 'finance', why: 'Voiding a guest receipt or invoice is money work.' },
  { method: 'POST', path: /^\/api\/maintenance\/issues\/[^/]+\/approve$/, area: 'finance', why: 'Recording an owner\'s approval of a repair quote is a money decision.' },
  { method: 'GET', path: /^\/api\/audit$/, area: null, why: 'The History panel on every record: the handler applies the area of the record asked for; the whole trail stays management and finance only.' },
  { method: 'GET', path: /^\/api\/(warehouses|suppliers|drivers|vehicles|threepl-companies)$/, area: null, why: 'Supply chain reference lists that every supply chain screen picks from.' },
];

function routeArea(method: string, path: string): Area | null {
  const o = ROUTE_AREAS.find(r => (r.method === method || (method === 'HEAD' && r.method === 'GET')) && r.path.test(path));
  if (o) return o.area ? BY_KEY.get(o.area) ?? null : null;
  return areaForPath(path);
}

let cache: { at: number; rows: Chosen } | null = null;
const CACHE_MS = 10_000;

export function forgetAccess() { cache = null; }

async function chosen(env: Env): Promise<Chosen> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.rows;
  let rows: Chosen = new Map();
  try {
    const r = await all<{ role: string; area: string; level: string }>(env, 'SELECT role, area, level FROM role_access');
    // A category row holds a level; a module row a level or 'inherit' (migration 0144).
    for (const x of r) {
      if ((GROUP_KEYS.has(x.area) && isLevel(x.level)) || (BY_KEY.has(x.area) && isSetting(x.level))) rows.set(`${x.role}:${x.area}`, x.level);
    }
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
export async function accessFor(env: Env, role: string, path: string, method = 'GET', side: Side = 'both'): Promise<Access> {
  const area = routeArea(method, path);
  if (!area) return { area: null, level: 'full', chosen: false, role };
  // Closed by the account's side: treated as a chosen No access, so the handlers' own role lists give way too.
  if (offSide(role, side, area)) return { area, level: 'none', chosen: true, role };
  const r = resolve(EDITABLE_ROLES.includes(role) ? await chosen(env) : new Map(), role, area);
  return { area, level: r.level, chosen: r.chosen, role };
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

/** Every area's level for one role and side: what its menu and screens follow. */
export async function levelsFor(env: Env, role: string, side: Side = 'both'): Promise<Record<string, Level>> {
  const rows: Chosen = EDITABLE_ROLES.includes(role) ? await chosen(env) : new Map();
  return Object.fromEntries(AREAS.map(a => [a.key, offSide(role, side, a) ? 'none' : resolve(rows, role, a).level]));
}

export interface GroupCell { level: Level; builtIn: Level; chosen: boolean }
export interface AreaCell { setting: Setting; builtIn: Setting; chosen: boolean; level: Level }
export interface ChartGroup { group: string; roles: Record<string, GroupCell> }
export interface ChartArea { key: string; label: string; group: string; managed: boolean; roles: Record<string, AreaCell> }

/** The whole chart for the Permissions tab: each category's baseline per role, then each module's own setting. */
export async function chart(env: Env): Promise<{ groups: ChartGroup[]; areas: ChartArea[] }> {
  const rows = await chosen(env);
  const groups = GROUPS.map(group => ({
    group,
    roles: Object.fromEntries(EDITABLE_ROLES.map(r => {
      const picked = rows.get(`${r}:${groupKey(group)}`);
      const builtIn = builtInGroup(r, group);
      return [r, { level: isLevel(picked) ? capped(r, picked) : builtIn, builtIn, chosen: isLevel(picked) }];
    })),
  }));
  const areas = AREAS.map(a => ({
    key: a.key, label: a.label, group: a.group, managed: !!a.managed,
    roles: Object.fromEntries(EDITABLE_ROLES.map(r => {
      const { setting, level } = resolve(rows, r, a);
      return [r, { setting, builtIn: builtInSetting(r, a), chosen: rows.has(`${r}:${a.key}`), level }];
    })),
  }));
  return { groups, areas };
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
