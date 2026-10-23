import { type Env, all, one } from './db';
import {
  AREAS, GROUPS, closedBySide, LEVELS, groupKey, isKind, isLevel, isSetting, isSide, resolveFor, rulesFor,
  type DepartmentKind, type Level, type Origin, type Rules, type Setting, type Side,
} from './access';

/**
 * Shared by the department, rule and per-person access endpoints (functions/api/departments, functions/api/users):
 * request-body parsing as type guards, and the readers that build the response bodies fixed in PLAN.md.
 */

export interface Position { id: string; name: string; sort: number; headCount: number }
export interface Department { id: string; name: string; kind: DepartmentKind; side: Side; sort: number; headCount: number; positions: Position[] }

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };
const bad = (message: string): { ok: false; message: string } => ({ ok: false, message });

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export const NAME_MAX = 80;
/** A department or position name: trimmed, inner runs of spaces collapsed, 1 to 80 characters. Null when unusable. */
export function cleanName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().replace(/\s+/g, ' ');
  return s.length >= 1 && s.length <= NAME_MAX ? s : null;
}

/** Postgres 23505, e.g. the unique index on a department's name. */
export const isUniqueViolation = (e: unknown): boolean => isRecord(e) && e.code === '23505';

/** A stored `sort` or a sort sent by a screen. */
export const isSort = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && Math.abs(v) < 1_000_000;

const AREA_KEYS = new Set(AREAS.map(a => a.key));
const GROUP_KEYS = new Set(GROUPS.map(groupKey));
/** 'area' for an area key, 'group' for `group:<Category>`, null for anything else. */
export const ruleKeyKind = (key: string): 'area' | 'group' | null => (AREA_KEYS.has(key) ? 'area' : GROUP_KEYS.has(key) ? 'group' : null);
export function ruleKeyLabel(key: string): string {
  const area = AREAS.find(a => a.key === key);
  if (area) return area.label;
  return `${key.replace(/^group:/, '')} (category)`;
}

/** The people in a department or position are moved with a delete. `positionId` null means no position. */
export interface MoveToDepartment { departmentId: string; positionId: string | null }
export interface MoveToPosition { positionId: string | null }

/** `moveTo` of DELETE /api/departments/:id. An absent body or key is fine (value null); a malformed one is not. */
export function parseDepartmentMove(body: unknown): Parsed<MoveToDepartment | null> {
  if (!isRecord(body) || body.moveTo === undefined || body.moveTo === null) return { ok: true, value: null };
  const m = body.moveTo;
  if (!isRecord(m) || typeof m.departmentId !== 'string' || !m.departmentId) return bad('Pick the department to move people to.');
  if (m.positionId !== undefined && m.positionId !== null && typeof m.positionId !== 'string') return bad('Pick the position to move people to.');
  return { ok: true, value: { departmentId: m.departmentId, positionId: typeof m.positionId === 'string' && m.positionId ? m.positionId : null } };
}

/** `moveTo` of DELETE /api/departments/positions/:id. */
export function parsePositionMove(body: unknown): Parsed<MoveToPosition | null> {
  if (!isRecord(body) || body.moveTo === undefined || body.moveTo === null) return { ok: true, value: null };
  const m = body.moveTo;
  if (!isRecord(m)) return bad('Pick the position to move people to.');
  if (m.positionId !== undefined && m.positionId !== null && typeof m.positionId !== 'string') return bad('Pick the position to move people to.');
  return { ok: true, value: { positionId: typeof m.positionId === 'string' && m.positionId ? m.positionId : null } };
}

export interface RuleChange { scope: 'department' | 'position'; scopeId: string; key: string; level: Setting | null }
export const MAX_CHANGES = 300;

/**
 * PUT /api/users/access body. A category key takes a level or null, never 'inherit'; an area key takes a setting or
 * null. Two changes to the same cell collapse to the last one.
 */
export function parseRuleChanges(body: unknown): Parsed<RuleChange[]> {
  if (!isRecord(body) || !Array.isArray(body.changes)) return bad('Nothing to save.');
  const list: unknown[] = body.changes;
  if (list.length === 0 || list.length > MAX_CHANGES) return bad('Nothing to save.');
  const out = new Map<string, RuleChange>();
  for (const c of list) {
    if (!isRecord(c)) return bad('Each change needs a scope, a person group, an area and a level.');
    const { scope, scopeId, key, level } = c;
    if (scope !== 'department' && scope !== 'position') return bad('A rule belongs to a department or a position.');
    if (typeof scopeId !== 'string' || !scopeId) return bad('Pick the department or position.');
    if (typeof key !== 'string') return bad('Unknown area.');
    const kind = ruleKeyKind(key);
    if (!kind) return bad('Unknown area or category.');
    // A category baseline is a level; only an area can inherit.
    const value = level === null ? null : kind === 'group' ? (isLevel(level) ? level : undefined) : (isSetting(level) ? level : undefined);
    if (value === undefined) return bad('Unknown access level.');
    out.set(`${scope}:${scopeId}:${key}`, { scope, scopeId, key, level: value });
  }
  return { ok: true, value: [...out.values()] };
}

export interface AreaChange { area: string; level: Level | null }
export type PersonChanges = { resetAll: true } | { resetAll: false; changes: AreaChange[] };

/** PUT /api/users/:id/access body: `{ resetAll: true }` or `{ changes: [{ area, level | null }] }`. */
export function parsePersonChanges(body: unknown): Parsed<PersonChanges> {
  if (isRecord(body) && body.resetAll === true) return { ok: true, value: { resetAll: true } };
  if (!isRecord(body) || !Array.isArray(body.changes)) return bad('Nothing to save.');
  const list: unknown[] = body.changes;
  if (list.length === 0 || list.length > MAX_CHANGES) return bad('Nothing to save.');
  const out = new Map<string, AreaChange>();
  for (const c of list) {
    if (!isRecord(c)) return bad('Each change needs an area and a level.');
    const { area, level } = c;
    if (typeof area !== 'string' || ruleKeyKind(area) !== 'area') return bad('Unknown area.');
    if (level !== null && !isLevel(level)) return bad('Unknown access level.');
    out.set(area, { area, level });
  }
  return { ok: true, value: { resetAll: false, changes: [...out.values()] } };
}

export { closedBySide } from './access';


// ---- departments and positions ----

interface DepartmentRow { id: string; name: string; kind: string; side: string; sort: number; head_count: number }
interface PositionRow { id: string; department_id: string; name: string; sort: number; head_count: number }

/** Every department with its positions and head counts, ordered by sort then name. */
export async function loadDepartments(env: Env): Promise<Department[]> {
  const [departments, positions] = await Promise.all([
    all<DepartmentRow>(env, `SELECT d.id, d.name, d.kind, d.side, d.sort, (SELECT count(*) FROM users u WHERE u.department_id = d.id) AS head_count
                               FROM departments d ORDER BY d.sort, lower(d.name)`),
    all<PositionRow>(env, `SELECT p.id, p.department_id, p.name, p.sort, (SELECT count(*) FROM users u WHERE u.position_id = p.id) AS head_count
                             FROM positions p ORDER BY p.sort, lower(p.name)`),
  ]);
  const out: Department[] = [];
  for (const d of departments) {
    if (!isKind(d.kind) || !isSide(d.side)) continue;
    out.push({
      id: d.id, name: d.name, kind: d.kind, side: d.side, sort: d.sort, headCount: d.head_count,
      positions: positions.filter(p => p.department_id === d.id).map(p => ({ id: p.id, name: p.name, sort: p.sort, headCount: p.head_count })),
    });
  }
  return out;
}

export async function loadDepartment(env: Env, id: string): Promise<Department | null> {
  return (await loadDepartments(env)).find(d => d.id === id) ?? null;
}

/** The department a position belongs to, and the position. Null when the position does not exist. */
export async function loadPosition(env: Env, id: string): Promise<{ department: Department; position: Position } | null> {
  for (const department of await loadDepartments(env)) {
    const position = department.positions.find(p => p.id === id);
    if (position) return { department, position };
  }
  return null;
}

// ---- department and position rules ----

export type RuleBook = { department: Record<string, Record<string, Setting>>; position: Record<string, Record<string, Setting>> };

/** Every stored department and position rule. A row for an area that no longer exists is skipped. */
export async function loadRuleBook(env: Env): Promise<RuleBook> {
  const rows = await all<{ scope: string; scope_id: string; area: string; level: string }>(env,
    `SELECT scope, scope_id, area, level FROM access_rules WHERE scope IN ('department', 'position')`);
  const book: RuleBook = { department: {}, position: {} };
  for (const r of rows) {
    if (r.scope !== 'department' && r.scope !== 'position') continue;
    const kind = ruleKeyKind(r.area);
    if (!kind || !(kind === 'group' ? isLevel(r.level) : isSetting(r.level))) continue;
    const level: unknown = r.level;
    if (!isSetting(level)) continue;
    (book[r.scope][r.scope_id] ??= {})[r.area] = level;
  }
  return book;
}

export interface CategoryList { group: string; areas: { key: string; label: string; managed: boolean }[] }
export const categoryList = (): CategoryList[] =>
  GROUPS.map(group => ({ group, areas: AREAS.filter(a => a.group === group).map(({ key, label, managed }) => ({ key, label, managed: !!managed })) }));

/** The body of GET and PUT /api/users/access. */
export async function permissionBody(env: Env, canEdit: boolean) {
  const [departments, rules] = await Promise.all([loadDepartments(env), loadRuleBook(env)]);
  return { levels: LEVELS, categories: categoryList(), departments, rules, canEdit };
}

// ---- one person's access ----

export type InheritedOrigin = 'position' | 'department' | 'none';
export interface PersonArea {
  key: string; label: string; group: string; level: Level; origin: Origin; override: Level | null;
  inherited: { level: Level; origin: InheritedOrigin };
}
export interface PersonAccess {
  user: { id: string; fullName: string; departmentId: string; departmentName: string; positionId: string | null; positionName: string | null; kind: DepartmentKind; side: Side };
  areas: PersonArea[];
  canEdit: boolean;
}
export type PersonResult = { found: 'no-user' } | { found: 'no-department' } | { found: 'ok'; body: PersonAccess };

interface PersonRow {
  id: string; full_name: string; department_id: string | null; position_id: string | null;
  dept_name: string | null; kind: string | null; dept_side: string | null; pos_name: string | null;
}

/** The person's grid: effective level and origin per area, their own override, and what they would get without it. */
export async function personAccess(env: Env, userId: string, canEdit: boolean): Promise<PersonResult> {
  const row = await one<PersonRow>(env,
    `SELECT u.id, u.full_name, u.department_id, u.position_id, d.name AS dept_name, d.kind, d.side AS dept_side, p.name AS pos_name
       FROM users u LEFT JOIN departments d ON d.id = u.department_id LEFT JOIN positions p ON p.id = u.position_id WHERE u.id = ?`, userId);
  if (!row) return { found: 'no-user' };
  if (!row.department_id || !row.dept_name || !isKind(row.kind) || !isSide(row.dept_side)) return { found: 'no-department' };
  const { kind, dept_side: side } = row;
  const who = { userId: row.id, departmentId: row.department_id, positionId: row.position_id, kind };
  const rules: Rules = await rulesFor(env, who);
  const withoutOverrides: Rules = { ...rules, user: { rules: new Map() } };
  const areas = AREAS.map((a): PersonArea => {
    const closed = closedBySide(kind, side, a.group);
    const now = resolveFor(rules, who, a);
    const base = resolveFor(withoutOverrides, who, a);
    const own = rules.user.rules.get(a.key);
    // Management is fixed Full from its department, so "what you would get" names the department.
    const origin: InheritedOrigin = base.origin === 'position' ? 'position' : base.origin === 'none' ? 'none' : 'department';
    return {
      key: a.key, label: a.label, group: a.group,
      level: closed ? 'none' : now.level, origin: closed ? 'none' : now.origin,
      override: isLevel(own) ? own : null,
      inherited: closed ? { level: 'none', origin: 'none' } : { level: base.level, origin },
    };
  });
  return {
    found: 'ok',
    body: {
      user: { id: row.id, fullName: row.full_name, departmentId: row.department_id, departmentName: row.dept_name, positionId: row.position_id, positionName: row.pos_name, kind, side },
      areas, canEdit,
    },
  };
}
