// Conts only (not part of Houzs's code): a utility bill's expense, booked against its accrual once finance has paid it
// (chew, 16 Nov 2026: "记在账单日期，但财务付款后才正真记录"; the expense follows the bill's period, not the day it is
// paid). A utility request's lines start on their kind's accrual (utility-bill-routes.ts UTILITY_ACCRUAL), so its
// payment voucher books Dr accrual / Cr bank; when the request becomes PAID this books, per bill date,
//   Dr the kind's expense (650-00xx) / Cr its accrual (420-00xx)
// so the accrual nets to nil and the expense sits in the bill's own month, closed or not (only the ledger start moves
// it: nothing is booked before the books begin). A line finance put on another account (expensed it directly) is left
// alone, as is a kind whose expense account the chart does not have yet. When the request stops being PAID (its
// voucher cancelled) the entries are reversed, dated that day. Best effort: a failure is logged, never undoes a voucher.
import { postJournal, reverseJournal } from '../acc/engine';
import { loadLedgerSettings } from '../acc/ledger-settings';
import type { RuleLine } from '../acc/rules';

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST client, untyped as in the modules it sits beside */
type Db = any;

/** Each accrual's expense: 420-0010 electrical, 420-0020 water, 420-0030 internet, 420-0040 Indah Water. */
export const ACCRUAL_EXPENSE: Record<string, string> = { '420-0010': '650-0020', '420-0020': '650-0010', '420-0030': '650-0030', '420-0040': '650-0040' };
export const ACCRUAL_SOURCE = 'UTA';

type Line = { account_code: string | null; amount_sen: number; bill_date: string | null; description: string | null; unit_id: string | null; sort: number };
type Req = { id: string; company_id: number; request_no: string };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** The day a line's expense belongs to: its bill date; for a line from before bill dates were kept, the end of the
 *  month its description names ("Electricity 2026-10 …"). */
export function lineDate(l: Pick<Line, 'bill_date' | 'description'>): string | null {
  const d = l.bill_date ? String(l.bill_date).slice(0, 10) : null;
  if (d && DAY.test(d)) return d;
  const m = /\b(\d{4})-(\d{2})\b/.exec(l.description ?? '');
  if (!m) return null;
  const last = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
  return `${m[1]}-${m[2]}-${String(last).padStart(2, '0')}`;
}

async function request(sb: Db, requestId: string): Promise<{ req: Req; lines: Line[] } | null> {
  const { data: r } = await sb.from('payment_requests').select('id, company_id, request_no').eq('id', requestId).maybeSingle();
  if (!r) return null;
  const { data: ls, error } = await sb.from('payment_request_lines').select('account_code, amount_sen, bill_date, description, unit_id, sort').eq('request_id', requestId);
  if (error) throw new Error(error.message);
  const lines = ((ls ?? []) as Line[]).filter(l => l.account_code && ACCRUAL_EXPENSE[l.account_code]).sort((a, b) => Number(a.sort) - Number(b.sort));
  return { req: r as Req, lines };
}

/** The request's accrual lines by the day they are booked on. */
function byDate(lines: Line[]): Map<string, Line[]> {
  const out = new Map<string, Line[]>();
  for (const l of lines) {
    const d = lineDate(l);
    if (!d) continue;
    out.set(d, [...(out.get(d) ?? []), l]);
  }
  return out;
}
const docNo = (req: Req, date: string) => `${req.request_no}/${date}`;

/** Books the request's utility expenses against their accruals, one entry per bill date. Posting again adds nothing. */
export async function postUtilityAccrual(sb: Db, requestId: string): Promise<void> {
  const got = await request(sb, requestId);
  if (!got || !got.lines.length) return;
  const { req, lines } = got;
  const expenses = [...new Set(lines.map(l => ACCRUAL_EXPENSE[l.account_code!]!))];
  const { data: chart } = await sb.from('accounts').select('account_code, is_active').eq('company_id', req.company_id).in('account_code', expenses);
  const open = new Set(((chart ?? []) as Array<{ account_code: string; is_active: boolean | null }>).filter(a => a.is_active !== false).map(a => a.account_code));
  const ls = await loadLedgerSettings(sb, req.company_id);
  const start = ls.ok ? ls.settings.ledgerStartDate : null;
  for (const [date, group] of byDate(lines.filter(l => open.has(ACCRUAL_EXPENSE[l.account_code!]!)))) {
    const rows: RuleLine[] = group.flatMap(l => {
      const sen = Number(l.amount_sen);
      if (!(sen > 0)) return [];
      const tags = { department: 'rental' as const, unitId: l.unit_id ?? null, notes: l.description ?? null };
      return [{ accountCode: ACCRUAL_EXPENSE[l.account_code!]!, debitSen: sen, creditSen: 0, ...tags }, { accountCode: l.account_code!, debitSen: 0, creditSen: sen, ...tags }];
    });
    if (!rows.length) continue;
    const out = await postJournal(sb, {
      companyId: req.company_id, entryDate: start && date < start ? start : date, sourceType: ACCRUAL_SOURCE, sourceDocNo: docNo(req, date),
      narration: `Utilities ${req.request_no}: expense against accrual`, lines: rows,
    });
    if (!out.ok) throw new Error(`${docNo(req, date)}: ${out.status}${'reason' in out && out.reason ? ` ${out.reason}` : ''}`);
  }
}

/** Reverses what postUtilityAccrual booked for the request, dated today. */
export async function reverseUtilityAccrual(sb: Db, requestId: string): Promise<void> {
  const got = await request(sb, requestId);
  if (!got || !got.lines.length) return;
  for (const date of byDate(got.lines).keys()) {
    const out = await reverseJournal(sb, { companyId: got.req.company_id, sourceType: ACCRUAL_SOURCE, sourceDocNo: docNo(got.req, date),
      narration: o => `Reversal of ${o.je_no}: utilities ${got.req.request_no} payment cancelled` });
    if (!out.ok) throw new Error(`${docNo(got.req, date)}: ${out.status}${out.reason ? ` ${out.reason}` : ''}`);
  }
}

/** After a request's status is settled: book on PAID, reverse on leaving it. Logged, never thrown. */
export async function utilityAccrualBestEffort(sb: Db, requestId: string, was: string, now: string): Promise<void> {
  try {
    if (now === 'PAID') await postUtilityAccrual(sb, requestId);
    else if (was === 'PAID') await reverseUtilityAccrual(sb, requestId);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[claims] request ${requestId}: utility accrual entry not booked:`, (e as Error).message);
  }
}
