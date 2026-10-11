import { type Env } from './db';
import { hasColumn } from './auth';
import { technicianFor } from './notify';

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

// No approval threshold (owner, 11 Oct 2026): a quote goes to the owner only when the office presses "Send to owner for
// approval" (request-approval.ts). The old setting operations.maintenanceApprovalThreshold may still be saved; nothing reads it.

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
