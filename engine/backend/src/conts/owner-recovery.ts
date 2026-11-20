// Conts only: what a payment request pays out that the unit's owner pays back (chew, 20 Nov 2026: "payment request 时这个
// 钱是要和 owner 收回"). One amount per request and unit (scm.payment_request_recoveries, migration 0352), set by the
// person asking on a line for a unit (the whole line, or an amount typed by hand) and changed by finance until the
// request is paid. Once it is PAID the database itself charges the owner (an open O2 charge, pos.charge_owner_recoveries),
// so nothing here writes to Property OS.
import type { LineRow } from './claims-lines';

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST client, untyped as in the routes it serves */
export type Recovery = { unitId: string; amountSen: number; charged: boolean };

/** The amounts the person asked to recover, from the lines as sent (`recoverSen` on a line) against the lines as built
 *  (same order): only on a line for a unit, no more than the line; two lines of one unit add up. A message when wrong. */
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
    if (sen > line.amount_sen) return { ok: false, message: 'The owner pays back no more than the line.' };
    byUnit.set(line.unit_id, (byUnit.get(line.unit_id) ?? 0) + sen);
  }
  return { ok: true, byUnit };
}

/** The request's recoveries replaced with these (a new request, or one sent again). */
export async function saveRecoveries(sb: any, requestId: string, byUnit: Map<string, number>, by: string): Promise<string | null> {
  const gone = await sb.from('payment_request_recoveries').delete().eq('request_id', requestId);
  if (gone.error) return gone.error.message;
  if (!byUnit.size) return null;
  const ins = await sb.from('payment_request_recoveries').insert([...byUnit].map(([unit_id, amount_sen]) => ({ request_id: requestId, unit_id, amount_sen, set_by: by })));
  return ins.error ? ins.error.message : null;
}

/** Each request's recoveries, for the screens. */
export async function recoveriesOf(sb: any, requestIds: string[]): Promise<Map<string, Recovery[]>> {
  const out = new Map<string, Recovery[]>();
  for (let i = 0; i < requestIds.length; i += 200) {
    const { data } = await sb.from('payment_request_recoveries').select('request_id, unit_id, amount_sen, adjustment_id').in('request_id', requestIds.slice(i, i + 200));
    for (const r of (data ?? []) as Array<{ request_id: string; unit_id: string; amount_sen: number; adjustment_id: string | null }>) {
      const list = out.get(r.request_id) ?? [];
      list.push({ unitId: r.unit_id, amountSen: Number(r.amount_sen), charged: !!r.adjustment_id });
      out.set(r.request_id, list);
    }
  }
  return out;
}
