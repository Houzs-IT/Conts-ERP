/** "Agent to let" (staff sheet UNIT, 17 Oct 2026): units we find a long-term tenant for on the owner's behalf. Each
 *  record is one search or one tenancy: looking for a tenant, rented (tenant, agreement dates, rent, our agent fee),
 *  or closed. A rented unit is flagged REMIND_DAYS before its agreement ends, so we can let it again for next year. */
import { checkDate } from './validate';

export const LETTING_STATUSES = ['looking', 'rented', 'closed'] as const;
export type LettingStatus = typeof LETTING_STATUSES[number];
export const REMIND_DAYS = 90;

export interface LettingInput {
  unitId?: string; status?: string; tenantName?: string | null; tenantPhone?: string | null;
  startsOn?: string | null; endsOn?: string | null; monthlyRent?: number | null; agentFee?: number | null; notes?: string | null;
}

const sen = (v: unknown) => v == null || (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 100_000_000);

/** Field-keyed problems with the record as it would be saved (stored values overlaid with the change). */
export function invalidLetting(m: LettingInput): Record<string, string> {
  const f: Record<string, string> = {};
  if (!(LETTING_STATUSES as readonly string[]).includes(m.status ?? '')) f.status = 'Pick looking for a tenant, rented or closed.';
  if (m.tenantName != null && (typeof m.tenantName !== 'string' || m.tenantName.length > 160)) f.tenantName = 'At most 160 characters.';
  if (m.tenantPhone != null && (typeof m.tenantPhone !== 'string' || m.tenantPhone.length > 40)) f.tenantPhone = 'At most 40 characters.';
  if (m.notes != null && (typeof m.notes !== 'string' || m.notes.length > 2000)) f.notes = 'At most 2,000 characters.';
  if (!sen(m.monthlyRent)) f.monthlyRent = 'Enter the rent in ringgit.';
  if (!sen(m.agentFee)) f.agentFee = 'Enter the fee in ringgit.';
  checkDate(f, 'startsOn', m.startsOn || null, { label: 'Start date' });
  checkDate(f, 'endsOn', m.endsOn || null, { label: 'End date' });
  if (!f.startsOn && !f.endsOn && m.startsOn && m.endsOn && m.endsOn < m.startsOn) f.endsOn = 'The agreement ends before it starts.';
  if (m.status === 'rented') {
    if (!m.tenantName?.trim()) f.tenantName = 'Enter the tenant.';
    if (!m.startsOn && !f.startsOn) f.startsOn = 'Enter when the agreement starts.';
    if (!m.endsOn && !f.endsOn) f.endsOn = 'Enter when the agreement ends, so we can remind you to let it again.';
    if (!m.monthlyRent && !f.monthlyRent) f.monthlyRent = 'Enter the monthly rent.';
  }
  return f;
}
