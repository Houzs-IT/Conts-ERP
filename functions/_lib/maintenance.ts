import { type Env, all, one, run, audit, nowIso } from './db';
import { type Session, hasColumn } from './auth';
import { technicianFor } from './notify';

/** Migration 0144: the technician list (Workers > Technicians) and each job's link to it. */
export const hasTechnicianList = (env: Env): Promise<boolean> => hasColumn(env, 'maintenance_issues', 'technician_id').catch(() => false);

/** The logins an in-house entry on the technician list may be linked to. */
export const TECH_LOGIN_ROLES = ['technician', 'housekeeper', 'operations_staff'];

/** Who a job is given to, as the job row keeps it. technicianId is undefined on a database without the list. */
export interface Assignee { name: string; kind: 'in_house' | 'contractor'; userId: string | null | undefined; technicianId: string | null | undefined }

/**
 * The person a picked name stands for. With the technician list: the active entry of that name, and a name typed
 * for the first time is added to the list as a contractor. A switched-off entry is refused, not silently reused.
 * Without the list: matched against staff accounts by name, as before. Returns a message when it cannot be used.
 */
export async function pickAssignee(env: Env, session: Session, raw: string): Promise<Assignee | string> {
  const name = raw.trim().slice(0, 80);
  if (!(await hasTechnicianList(env))) {
    return { name, kind: await assigneeKindFor(env, name), userId: await assigneeUserId(env, name), technicianId: undefined };
  }
  const found = await all<{ id: string; full_name: string; employment_type: string; user_id: string | null; is_active: number; active_login: string | null }>(env, `
    SELECT t.id, t.full_name, t.employment_type, t.user_id, t.is_active, u.id AS active_login
    FROM technicians t LEFT JOIN users u ON u.id = t.user_id AND u.is_active = 1
    WHERE lower(trim(t.full_name)) = lower(?) ORDER BY t.is_active DESC`, name);
  const active = found.filter(t => t.is_active);
  if (active.length > 1) return `Two people on the technician list are called ${name}. Rename one under Workers > Technicians.`;
  const [t] = active;
  if (t) return { name: t.full_name, kind: t.employment_type === 'internal' ? 'in_house' : 'contractor', userId: t.active_login, technicianId: t.id };
  if (found.length) return `${found[0]?.full_name ?? name} is switched off under Workers > Technicians. Switch them back on to give them jobs.`;

  const id = crypto.randomUUID(), now = nowIso();
  await run(env, `INSERT INTO technicians (id, full_name, employment_type, is_active, created_at, updated_at) VALUES (?, ?, 'outsourced', 1, ?, ?)`, id, name, now, now);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'maintenance.technician_create', entityTable: 'technicians', entityId: id, after: { name, employment: 'outsourced', reason: 'new contractor typed on a job' } });
  return { name, kind: 'contractor', userId: null, technicianId: id };
}

/** The staff account a typed technician name stands for (migration 0105, maintenance_issues.assignee_user_id): the one
 *  active account with that name, or null for a contractor or a name two accounts share. Undefined when the column is
 *  not on this database, so callers write nothing new. */
export async function assigneeUserId(env: Env, name: string | null): Promise<string | null | undefined> {
  if (!(await hasColumn(env, 'maintenance_issues', 'assignee_user_id').catch(() => false))) return undefined;
  const ids = name ? await technicianFor(env, name) : [];
  return ids.length === 1 ? ids[0] : null;
}

export const CATEGORIES = ['plumbing', 'electrical', 'aircon', 'furniture', 'appliance', 'other'] as const;
export const URGENCIES = ['normal', 'urgent'] as const;
export const SOURCES = ['guest', 'cleaner', 'inspection', 'staff'] as const;
export const ASSIGNEE_KINDS = ['in_house', 'contractor'] as const;
/** Who pays: the owner through the statement, the company, the guest from the deposit, or a warranty. */
export const CHARGE_TO = ['owner', 'the_conts', 'guest_deposit', 'warranty'] as const;

// The old single threshold (operations.maintenanceApprovalThreshold) is not read. Since 17 Oct 2026 management sets a rule
// per category (approvalRules below); the office can still send any quote to the owner (request-approval.ts).

/** A Malaysian-time instant "YYYY-MM-DDTHH:MM:00+08:00" from a datetime-local value ("2026-10-10T14:00", read as
 *  Malaysian time) or any ISO instant, or null. One format, so stored instants also compare as text. */
export function toInstant(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return `${v}:00+08:00`;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : `${new Date(t + 8 * 3600e3).toISOString().slice(0, 16)}:00+08:00`;
}

/** Migration 0108: billing date, money collected, and what the technician or contractor is owed and when it was paid.
 *  Without it those fields are left out of every read and refused on write, and the job works as before. */
export const hasBilling = (env: Env) => hasColumn(env, 'maintenance_issues', 'billing_date').catch(() => false);

export const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Whether a picked name is one of the company's own people (an active technician, housekeeper or operations
 *  account) or an outside contractor. The office picks a person; the kind follows from who it is. */
export async function assigneeKindFor(env: Env, name: string): Promise<'in_house' | 'contractor'> {
  return (await technicianFor(env, name)).length ? 'in_house' : 'contractor';
}

/** SQL that is true when the job on alias `m` is the given user's: since migration 0105 by account, older jobs (and a
 *  database without the column) by the technician's name. Pass the user id twice when `byId`, once otherwise. */
export function mineSql(byId: boolean) {
  const named = 'lower(trim(m.vendor_name)) = (SELECT lower(trim(full_name)) FROM users WHERE id = ?)';
  return byId ? `(m.assignee_user_id = ? OR (m.assignee_user_id IS NULL AND ${named}))` : named;
}

export const hasAssigneeUser = (env: Env) => hasColumn(env, 'maintenance_issues', 'assignee_user_id').catch(() => false);

/** Whether a repair job is the signed-in field user's: the rule every field write on a repair checks. */
export async function isAssignee(env: Env, id: string, userId: string): Promise<boolean> {
  const byId = await hasAssigneeUser(env);
  const visible = fieldVisibleSql(await hasJobType(env));
  return !!(await one(env, `SELECT 1 AS x FROM maintenance_issues m WHERE m.id = ? AND ${mineSql(byId)} AND ${visible}`, id, ...(byId ? [userId, userId] : [userId])));
}

/** A job nobody has: no technician or contractor named and no account linked. Only these can be picked up on the phone. */
export const UNASSIGNED_SQL = "(m.vendor_name IS NULL OR trim(m.vendor_name) = '')";

/** SQL true when the unit (column `unitCol`) has no open job blocking it: only then may anything put it back on sale
 *  or mark it cleaning, else a closed second job or a finished clean would sell a unit still under repair. */
export const noOpenBlockerSql = (unitCol: string) =>
  `NOT EXISTS (SELECT 1 FROM maintenance_issues mb WHERE mb.unit_id = ${unitCol} AND mb.blocks_unit = 1 AND mb.state != 'resolved')`;

/** Job types (staff comment sheet, 16-17 Oct 2026): Urgent first, then Pass key (hand over or collect a key), then
 *  Normal, worked one by one in due-date order. urgency stays in step for older readers: urgent <-> 'urgent'. */
export const JOB_TYPES = ['urgent', 'pass_key', 'normal'] as const;
export const SEVERITIES = ['minor', 'major'] as const;
export const urgencyOf = (jobType: string) => (jobType === 'urgent' ? 'urgent' : 'normal');

/** Migration 0126: job type, severity, parts and due date. Without it jobs are Normal or Urgent as before. */
export const hasJobType = (env: Env) => hasColumn(env, 'maintenance_issues', 'job_type').catch(() => false);

/** Management's rule per problem category for when the owner must approve a job before work starts
 *  (Maintenance > Approval rules, owner 17 Oct 2026): never, always, only Major jobs, or when the quote is over an amount. */
export type ApprovalMode = 'never' | 'always' | 'major' | 'over';
export interface ApprovalRule { mode: ApprovalMode; amount?: number }
export const APPROVAL_MODES: ApprovalMode[] = ['never', 'always', 'major', 'over'];
export const RULES_KEY = 'maintenance.approvalRules';

export async function approvalRules(env: Env): Promise<Record<string, ApprovalRule>> {
  const row = await one<{ value: string }>(env, 'SELECT value FROM settings WHERE key = ?', RULES_KEY).catch(() => null);
  let raw: any = {};
  try { raw = row?.value ? JSON.parse(row.value) : {}; } catch { raw = {}; }
  return Object.fromEntries(CATEGORIES.map(c => {
    const r = raw?.[c];
    const mode: ApprovalMode = APPROVAL_MODES.includes(r?.mode) ? r.mode : 'never';
    return [c, mode === 'over' ? { mode, amount: Number.isInteger(r?.amount) && r.amount >= 0 ? r.amount : 0 } : { mode }];
  }));
}

/** Whether the rules say this job waits for the owner. A quote not yet known never trips an amount rule. */
export function ruleNeedsApproval(rules: Record<string, ApprovalRule>, category: string, severity: string, quote: number | null): boolean {
  const r = rules[category] ?? { mode: 'never' };
  if (r.mode === 'always') return true;
  if (r.mode === 'major') return severity === 'major';
  if (r.mode === 'over') return quote != null && quote > (r.amount ?? 0);
  return false;
}

/** SQL true when the job on alias `m` may show in the field app: a job waiting for the owner stays with the office
 *  until the owner approved and, when it needs parts, they arrived (owner, 17 Oct 2026). */
export const fieldVisibleSql = (cols: boolean) => cols
  ? `NOT (m.owner_approval_required = 1 AND m.charge_to = 'owner' AND (m.owner_approved_at IS NULL OR (m.needs_parts = 1 AND m.parts_arrived_at IS NULL)))`
  : `NOT (m.owner_approval_required = 1 AND m.charge_to = 'owner' AND m.owner_approved_at IS NULL)`;

/** Field order: Urgent, Pass key, then Normal by due date (the day reported when none is set), oldest first. */
export const fieldOrderSql = (cols: boolean) => cols
  ? `CASE m.job_type WHEN 'urgent' THEN 0 WHEN 'pass_key' THEN 1 ELSE 2 END, COALESCE(m.due_on, substr(m.reported_at, 1, 10)), m.reported_at`
  : `(m.urgency = 'urgent') DESC, m.reported_at`;
