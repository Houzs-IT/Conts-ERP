import { type Env, all } from './db';

export type Level = 'none' | 'view' | 'edit' | 'full';
export const LEVELS: Level[] = ['none', 'view', 'edit', 'full'];
const RANK: Record<Level, number> = { none: 0, view: 1, edit: 2, full: 3 };
/** A module's own setting: 'inherit' follows its category's baseline, a level overrides it. */
export type Setting = Level | 'inherit';
export const isLevel = (v: unknown): v is Level => typeof v === 'string' && (LEVELS as string[]).includes(v);
export const isSetting = (v: unknown): v is Setting => v === 'inherit' || isLevel(v);

export interface Area {
  key: string; label: string; group: string;
  /** First segment under /api that belongs to this area. */
  api: string[];
  /** Management-only today: any access to it carries the management-only actions inside it. */
  managed?: boolean;
  /** Kept for the Permissions chart's wording. Reads are refused at "No access" in every area now; the few
   *  reads other screens share across areas are listed in SHARED_READS instead. */
  strictRead?: boolean;
}

/** Which side of the business an account works on (migration 0143): The Conts is rental, Dream Crafter the supply
 *  chain. A side only closes the other side's areas; it never opens what the role does not allow. */
export type Side = 'conts' | 'dream_crafter' | 'both';
export const SIDES: Side[] = ['conts', 'dream_crafter', 'both'];
export const isSide = (v: unknown): v is Side => typeof v === 'string' && (SIDES as string[]).includes(v);

/** A department on one side puts everyone in it on that side; in a department on both sides the person's own
 *  "Works on" choice (users.side) decides. SQL for one row of users `u` joined to its department `d`. */
export const sideSql = (u: string, d: string) => `CASE WHEN ${d}.side IN ('conts', 'dream_crafter') THEN ${d}.side ELSE COALESCE(${u}.side, 'both') END`;
/** Whether a person may be put on `side` in a department on `departmentSide`: only a Both department leaves the choice. */
export const sideFits = (departmentSide: Side, side: Side) => departmentSide === 'both' || departmentSide === side;

/** The area groups each side closes. Finance and System are on neither list, so they follow the role. The Dream Crafter
 *  groups match its sidebar sections (owner, 26 Oct 2026; migration 0172 copied the old Dream Crafter baseline to each). */
const CLOSED_BY_SIDE: Record<Side, string[]> = {
  conts: ['Service cases', 'Projects', 'Supply chain'],
  dream_crafter: ['Workspace', 'Operations', 'HR', 'Growth'],
  both: [],
};
/** Management always sees both sides, so nobody can lock the system out of one. */
export const closedBySide = (kind: DepartmentKind, side: Side, group: string): boolean => kind !== 'management' && CLOSED_BY_SIDE[side].includes(group);
const offSide = (kind: DepartmentKind, side: Side, area: Area): boolean => closedBySide(kind, side, area.group);

export const AREAS: Area[] = [
  { key: 'dashboard', label: 'Dashboard', group: 'Workspace', api: ['dashboard'] },
  { key: 'portfolio', label: 'Portfolio', group: 'Workspace', api: ['portfolio'], managed: true, strictRead: true },
  // Reservations arrive from the channels through the API; finance reads them but does not create or change them (owner, 11 Oct 2026).
  { key: 'reservations', label: 'Reservations', group: 'Operations', api: ['reservations', 'guests', 'blocks', 'guest-documents'] },
  { key: 'operations', label: 'Operations', group: 'Operations', api: ['operations', 'housekeeping', 'maintenance', 'tasks'] },
  { key: 'properties', label: 'Units', group: 'Operations', api: ['properties', 'units', 'unit-layout-types', 'inventory', 'access-credentials', 'residence-rules', 'lettings'] },
  // Field staff's HR record: IC, bank, salary and statutory (PLAN-hr-employees.md). Its own group so Operations staff do
  // not see pay by default. The cleaner and technician rosters themselves stay under Operations.
  { key: 'hr', label: 'Employees', group: 'HR', api: ['employees', 'attendance', 'leaves', 'payroll', 'working-hours', 'penalties', 'labor-cost'], strictRead: true },
  { key: 'serviceCases', label: 'Service cases', group: 'Service cases', api: [] },
  { key: 'projects', label: 'Projects', group: 'Projects', api: [] },
  { key: 'scSales', label: 'Sales order', group: 'Supply chain', api: ['sales-orders', 'so-amendments', 'delivery-orders', 'sales-returns', 'customers'] },
  { key: 'scInvoices', label: 'Invoices and payments', group: 'Supply chain', api: ['payment-vouchers', 'purchase-invoices', 'sales-invoices', 'unbilled-deliveries', 'credit-notes', 'accounting'], managed: true, strictRead: true },
  { key: 'scConsignment', label: 'Consignment', group: 'Supply chain', api: ['consignment-notes', 'purchase-consignment'] },
  { key: 'scProcurement', label: 'Procurement', group: 'Supply chain', api: ['products', 'product-models', 'categories', 'fabrics', 'suppliers', 'mrp', 'purchase-orders', 'goods-receipts', 'purchase-returns'] },
  { key: 'scTransportPlan', label: 'Transportation', group: 'Supply chain', api: ['delivery-schedule', 'delivery-zones', 'driver-leave', 'drivers', 'fleet-health', 'coverage-fleet', 'vehicles', 'threepl-companies', 'rate-cards'] },
  { key: 'scWarehouse', label: 'Warehouse', group: 'Supply chain', api: ['loading-list', 'warehouses', 'racks', 'stock', 'stock-takes', 'stock-transfers'] },
  // 'owner': the owner portal's endpoints, which finance and management also open as an owner (?ownerId=).
  { key: 'finance', label: 'Finance', group: 'Finance', api: ['finance', 'expenses', 'statements', 'payouts', 'approvals', 'owner'], managed: true, strictRead: true },
  { key: 'owners', label: 'Owners', group: 'Finance', api: ['owners', 'contracts'] },
  // The company ledger in the engine (finance phase 1): no Property OS routes, sent to the engine at sign-on.
  // Operations managers read the rest of Finance but never the company books.
  { key: 'ledger', label: 'Ledger', group: 'Finance', api: [], managed: true, strictRead: true },
  { key: 'performance', label: 'Performance', group: 'Growth', api: ['analytics', 'pricing', 'rates', 'reviews', 'showcase'] },
  { key: 'comms', label: 'Communication', group: 'Growth', api: ['messages', 'automations'] },
  // The user list is read by management and operations managers only (functions/api/users), so finance admins start at none.
  { key: 'users', label: 'Users and roles', group: 'System', api: ['users', 'departments'], managed: true },
  { key: 'integrations', label: 'Integrations', group: 'System', api: ['integrations'], managed: true },
  { key: 'settings', label: 'Settings', group: 'System', api: ['settings'], managed: true },
  { key: 'health', label: 'System health', group: 'System', api: ['system', 'audit'], managed: true },
];

const BY_KEY = new Map(AREAS.map(a => [a.key, a]));
const BY_API = new Map(AREAS.flatMap(a => a.api.map(s => [s, a] as const)));
/** The categories in chart order. A category baseline is stored in access_rules under the area key `group:<name>`. */
export const GROUPS: string[] = [...new Set(AREAS.map(a => a.group))];
export const groupKey = (group: string): string => `group:${group}`;
const GROUP_KEYS = new Set(GROUPS.map(groupKey));

/**
 * Permissions by department, position and user (migration 0145, PLAN.md). accessFor and levelsFor follow these.
 * Rules are keyed by area key, or `group:<Category>` for a category baseline.
 */
export type PermissionLevel = Level;
export type DepartmentKind = 'management' | 'staff' | 'cleaning' | 'maintenance';
/** The hidden role a department's kind gives its people (PLAN.md). The role stays on the session because the field
 *  app, the owner portal and the management guards still branch on it; nobody picks it any more. */
export const roleForKind = (kind: DepartmentKind): string =>
  kind === 'management' ? 'management' : kind === 'cleaning' ? 'housekeeper' : kind === 'maintenance' ? 'technician' : 'operations_staff';
export const isKind = (v: unknown): v is DepartmentKind => v === 'management' || v === 'staff' || v === 'cleaning' || v === 'maintenance';
/** Cleaning and Maintenance hold the cleaners' and technicians' logins, which are managed on Workers only (owner,
 *  23 Oct 2026): no department screen or user form creates one, moves anyone into or out of one, or changes its kind. */
export const isFieldKind = (kind: DepartmentKind): boolean => kind === 'cleaning' || kind === 'maintenance';
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

const CACHE_MS = 10_000;
const rulesCache = new Map<string, { at: number; rules: Promise<Rules> }>();
const RULES_CACHE_MAX = 500;

/** Drops the cached rules, so a change to departments, positions or one person's overrides applies on the next
 *  request instead of after CACHE_MS. The handlers that write access_rules, users or departments call this. */
export function forgetRules(): void { rulesCache.clear(); }

/** `rulesFor`, remembered for CACHE_MS per person, so the session middleware, the
 *  handler's requireSession and every levelsFor in one request share a single read. */
function rulesCached(env: Env, who: Who): Promise<Rules> {
  const key = `${who.userId}|${who.departmentId}|${who.positionId}`;
  const hit = rulesCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.rules;
  if (rulesCache.size >= RULES_CACHE_MAX) rulesCache.clear();
  const rules = rulesFor(env, who);
  rulesCache.set(key, { at: Date.now(), rules });
  // A failed read must not be remembered.
  rules.catch(() => { if (rulesCache.get(key)?.rules === rules) rulesCache.delete(key); });
  return rules;
}

export function areaForPath(path: string): Area | null {
  const seg = /^\/api\/([^/]+)/.exec(path)?.[1];
  return seg ? BY_API.get(seg) ?? null : null;
}

/** What the access checks need to know about the person asking: the session, or anything shaped like it. A cookie
 *  signed before the departments shipped has no department or kind; the role then stands in for the kind. */
export interface Actor { userId: string; role: string; side?: Side; departmentId?: string | null; positionId?: string | null; kind?: DepartmentKind | null }

/** The kind of the person's department. Owners are not staff and never have one. */
export function kindOf(a: Pick<Actor, 'role' | 'kind'>): DepartmentKind {
  if (a.kind) return a.kind;
  return a.role === 'management' ? 'management' : a.role === 'housekeeper' ? 'cleaning' : a.role === 'technician' ? 'maintenance' : 'staff';
}
/** Whether the person's levels come from department, position and user rules: desk staff, not owners or field accounts. */
const isStaff = (a: Actor): boolean => a.role !== 'owner' && kindOf(a) === 'staff';
const whoOf = (a: Actor): Who => ({ userId: a.userId, departmentId: a.departmentId ?? null, positionId: a.positionId ?? null, kind: kindOf(a) });

export interface Access { area: Area | null; level: Level; chosen: boolean; role: string; staff: boolean }

/** The person's level for the area a request belongs to. Desk staff always get the level their rules resolve to
 *  (`chosen` is true), so the handlers' mayWork / maySee / mayRun follow it instead of their own role lists.
 *  Management is full and owners and field accounts none, with `chosen` false: the session middleware limits those
 *  to their apps' routes (FIELD_ALLOWED, OWNER_ALLOWED) and the handlers keep their lists. */
export async function accessFor(env: Env, who: Actor, path: string, method = 'GET'): Promise<Access> {
  const { role } = who;
  const kind = kindOf(who);
  const staff = isStaff(who);
  const area = routeArea(method, path);
  if (!area) return { area: null, level: 'full', chosen: false, role, staff };
  // Closed by the account's side: treated as a chosen No access, so the handlers' own role lists give way too.
  if (offSide(kind, who.side ?? 'both', area)) return { area, level: 'none', chosen: true, role, staff };
  if (!staff) return { area, level: kind === 'management' ? 'full' : 'none', chosen: false, role, staff };
  return { area, level: resolveFor(await rulesCached(env, whoOf(who)), whoOf(who), area).level, chosen: true, role, staff };
}

/** Whether the management-only actions in the request's area are open to this person. */
export function canManage(role: string, a: Access): boolean {
  if (!a.chosen || !a.area) return role === 'management';
  return a.level === 'full' || (!!a.area.managed && a.level !== 'none');
}

/** A refusal for the request, or null. For desk staff the level the Permissions screen shows is the level enforced:
 *  No access refuses reads and writes, View refuses writes. Management is always full; field and owner accounts are
 *  limited to their apps' routes by the session middleware. */
export function refusalFor(a: Access, method: string): string | null {
  if (!a.area || !a.staff) return null;
  const read = method === 'GET' || method === 'HEAD';
  if (read) return a.level === 'none' ? `Your access does not include ${a.area.label}.` : null;
  return RANK[a.level] < RANK.edit ? `Your access to ${a.area.label} is ${a.level === 'view' ? 'view only' : 'closed'}.` : null;
}

/** Every area's level for one person: what their menu and screens follow. */
export async function levelsFor(env: Env, who: Actor): Promise<Record<string, Level>> {
  const kind = kindOf(who);
  const side = who.side ?? 'both';
  const w = whoOf(who);
  const rules = isStaff(who) ? await rulesCached(env, w) : noRules;
  return Object.fromEntries(AREAS.map(a => [a.key, offSide(kind, side, a) || who.role === 'owner' ? 'none' : resolveFor(rules, w, a).level]));
}

/** One area's level for the person, for a handler whose action belongs to a different area than the request's path
 *  (a payment recorded from a reservation is Finance work). Side closing applies, as in levelsFor. */
export async function levelAt(env: Env, who: Actor, areaKey: string): Promise<Level> {
  return (await levelsFor(env, who))[areaKey] ?? 'none';
}
/** Whether the signed-in person's level in an area reaches at least `min`, read from `levels` that requireSession
 *  puts on the session. The synchronous form of mayIn, for the handlers that replaced a role list (management,
 *  finance, operations manager) with the level the Permissions screen shows. Management is full everywhere. */
export const can = (s: { levels?: Record<string, Level> }, areaKey: string, min: Level): boolean =>
  RANK[s.levels?.[areaKey] ?? 'none'] >= RANK[min];

/** Every active desk account whose level in an area reaches `min`, side closing included: the people a notice for
 *  that area goes to ("people whose department or position grants it"). Read in two queries however many people. */
export async function peopleWithAccess(env: Env, areaKey: string, min: Level): Promise<{ id: string; kind: DepartmentKind }[]> {
  const area = BY_KEY.get(areaKey);
  if (!area) return [];
  const [people, rows] = await Promise.all([
    all<{ id: string; role: string; side: string | null; department_id: string | null; position_id: string | null; kind: string | null }>(env,
      `SELECT u.id, u.role, ${sideSql('u', 'd')} AS side, u.department_id, u.position_id, d.kind
         FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.is_active = 1 AND u.role <> 'owner'`),
    all<{ scope: string; scope_id: string; area: string; level: string }>(env, 'SELECT scope, scope_id, area, level FROM access_rules'),
  ]);
  const mapFor = (scope: string, id: string | null): Map<string, Setting> => {
    const m = new Map<string, Setting>();
    if (id) for (const r of rows) if (r.scope === scope && r.scope_id === id && isSetting(r.level)) m.set(r.area, r.level);
    return m;
  };
  const out: { id: string; kind: DepartmentKind }[] = [];
  for (const p of people) {
    const kind = kindOf({ role: p.role, kind: isKind(p.kind) ? p.kind : null });
    if (kind !== 'management' && kind !== 'staff') continue;
    if (offSide(kind, isSide(p.side) ? p.side : 'both', area)) continue;
    const rules: Rules = { department: { rules: mapFor('department', p.department_id) }, position: { rules: mapFor('position', p.position_id) }, user: { rules: mapFor('user', p.id) } };
    if (RANK[resolveFor(rules, { kind }, area).level] >= RANK[min]) out.push({ id: p.id, kind });
  }
  return out;
}

/** Whether the person's level in an area reaches at least `min`. */
export async function mayIn(env: Env, who: Actor, areaKey: string, min: Level): Promise<boolean> {
  return RANK[await levelAt(env, who, areaKey)] >= RANK[min];
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
