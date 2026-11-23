// Conts only: what a payment request pays out that the unit's owner pays back (chew, 20 Nov 2026: "payment request 时这个
// 钱是要和 owner 收回"). One amount per request and unit (scm.payment_request_recoveries, migration 0352), set by the
// person asking on a line for a unit (the whole line, or an amount typed by hand) and changed by finance until the
// request is paid. Once it is PAID the database itself charges the owner (an open O2 charge, pos.charge_owner_recoveries),
// so nothing here writes to Property OS.
// Staff claims (scm.staff_receipt_recoveries, migration 0363; chew, 23 Nov 2026) work the same way, keyed by the receipt:
// the owner is charged once finance checks the claim (CHECKED, then TOPPED_UP or PAID_BACK), by
// pos.charge_owner_receipt_recoveries.
import type { LineRow } from './claims-lines';

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST client, untyped as in the routes it serves */
export type Recovery = { unitId: string; amountSen: number; charged: boolean };
/** Where a recovery is kept: on a payment request, or on a staff claim (receipt). */
export type RecoveryOf = 'request' | 'receipt';
const STORE: Record<RecoveryOf, { table: string; key: string }> = {
  request: { table: 'payment_request_recoveries', key: 'request_id' },
  receipt: { table: 'staff_receipt_recoveries', key: 'receipt_id' },
};
/** A claim's states in which the owner is charged (0363): finance accepted the cost, and its pay-backs after. */
export const RECEIPT_CHARGED_STATUSES: ReadonlySet<string> = new Set(['CHECKED', 'TOPPED_UP', 'PAID_BACK']);

/** The amounts the person asked to recover, from the lines as sent (`recoverSen` on a line) against the lines as built
 *  (same order): only on a line for a unit that is not a maintenance job's, no more than the line; two lines of one unit add up. A message when wrong. */
export function readRecoveries(raw: unknown, lines: LineRow[]): { ok: true; byUnit: Map<string, number> } | { ok: false; message: string } {
  const list = Array.isArray(raw) ? (raw as Array<Record<string, unknown> | null>) : [];
  const byUnit = new Map<string, number>();
  for (const [i, l] of list.entries()) {
    if (l?.recoverSen == null || l.recoverSen === '') continue;
    const sen = Number(l.recoverSen);
    const line = lines[i];
    if (!line) continue;
    if (!(Number.isInteger(sen) && sen > 0)) return { ok: false, message: 'Enter what the owner pays back, more than RM 0.00.' };
    if (!line.unit_id) return { ok: false, message: 'Only a line for a unit can be paid back by its owner.' };
    /* A maintenance job's cost reaches the owner through the job's Who pays (chew, 21 Nov 2026): never twice. */
    if (line.maintenance_issue_id) return { ok: false, message: 'A maintenance job\'s cost goes to the owner through the job\'s Who pays, not here.' };
    if (sen > line.amount_sen) return { ok: false, message: 'The owner pays back no more than the line.' };
    byUnit.set(line.unit_id, (byUnit.get(line.unit_id) ?? 0) + sen);
  }
  return { ok: true, byUnit };
}

/** The request's (or claim's) recoveries replaced with these (a new request or claim, or one sent again). */
export async function saveRecoveries(sb: any, id: string, byUnit: Map<string, number>, by: string, of: RecoveryOf = 'request'): Promise<string | null> {
  const { table, key } = STORE[of];
  const gone = await sb.from(table).delete().eq(key, id);
  if (gone.error) return gone.error.message;
  if (!byUnit.size) return null;
  const ins = await sb.from(table).insert([...byUnit].map(([unit_id, amount_sen]) => ({ [key]: id, unit_id, amount_sen, set_by: by })));
  return ins.error ? ins.error.message : null;
}

/** Each request's (or claim's) recoveries, for the screens. */
export async function recoveriesOf(sb: any, ids: string[], of: RecoveryOf = 'request'): Promise<Map<string, Recovery[]>> {
  const { table, key } = STORE[of];
  const out = new Map<string, Recovery[]>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await sb.from(table).select(`${key}, unit_id, amount_sen, adjustment_id`).in(key, ids.slice(i, i + 200));
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      const owner = String(r[key]);
      const list = out.get(owner) ?? [];
      list.push({ unitId: String(r.unit_id), amountSen: Number(r.amount_sen), charged: !!r.adjustment_id });
      out.set(owner, list);
    }
  }
  return out;
}

/** What each unit's recovery may be at most: the unit's lines that are not a maintenance job's. */
export function unitCaps(lines: Array<{ unit_id: string | null; maintenance_issue_id: string | null; amount_sen: number }>): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of lines) if (l.unit_id && !l.maintenance_issue_id) out.set(l.unit_id, (out.get(l.unit_id) ?? 0) + Number(l.amount_sen));
  return out;
}

/** Recoveries brought within the lines finance ends a check with (a claim's lines are rewritten then): a unit no longer
 *  on a line (or only on a job's) loses its recovery, one more than its lines comes down to them. Only the changes. */
export function fitRecoveries(recoveries: Recovery[], lines: Array<{ unit_id: string | null; maintenance_issue_id: string | null; amount_sen: number }>):
  { drop: string[]; lower: Array<{ unitId: string; amountSen: number }> } {
  const caps = unitCaps(lines);
  const drop: string[] = [];
  const lower: Array<{ unitId: string; amountSen: number }> = [];
  for (const r of recoveries) {
    if (r.charged) continue;
    const cap = caps.get(r.unitId) ?? 0;
    if (cap <= 0) drop.push(r.unitId);
    else if (r.amountSen > cap) lower.push({ unitId: r.unitId, amountSen: cap });
  }
  return { drop, lower };
}
