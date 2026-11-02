import { type Env, all, one, run, audit, nowIso, transaction } from './db';
import { CHARGE_TO, finalMonthsFor } from './expenses';
import { firstOpenMonth } from '../../src/lib/deductMonth';
import { contractSplit, type SplitContract } from '../../src/lib/utilitySplit';
import type { AccountMark, RecentBill } from '../../src/lib/utilityMatch';

/** Scanned utility bills (plan docs/superpowers/plans/2026-11-02-utility-bill-scan.md Task 4; spec
 *  docs/superpowers/specs/2026-10-27-utility-bills-design.md §5). The engine reads a page; this file holds what Property
 *  OS does with it: the accounts and recent bills a page is matched against, and recording the checked rows.
 *  Recording a row, in one transaction with the others:
 *    - the bill as an expense on its unit (its page as the receipt, the printed period kept), deducted on its own month's
 *      statement or the first open one after it (as the Utility bills screen does);
 *    - a period crossing the contract's start or end is split by days (FINANCE-SOP §3.10): the expense keeps the days
 *      inside, the days outside are the owner's alone as an O2 charge; a bill wholly outside is kept record-only;
 *    - "Owner paid this bill": the full amount back to the owner as an O2 credit (chew, 2 Nov 2026);
 *    - the account's marks, so next month's page matches by itself.
 *  What the user typed or picked is what is saved: the model's figures are never re-applied. */
export const SCAN_KINDS = ['electricity', 'water', 'internet', 'sewerage'] as const;
export const KIND_LABEL: Record<string, string> = { electricity: 'Electricity', water: 'Water', internet: 'Internet', sewerage: 'Indah Water' };
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthName = (ym: string) => `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const lastDay = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const shortDate = (d: string) => `${Number(d.slice(8, 10))} ${MONTH_NAMES[Number(d.slice(5, 7)) - 1]}`;
const addMonths = (ym: string, n: number) => { const t = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1 + n; return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}`; };

export type ScanUnit = { id: string; label: string; ownerId: string | null; contracts: SplitContract[] };

/** Every unit (for the picker and the split preview) with its contracts, and every utility account with its marks. */
export async function scanContext(env: Env): Promise<{ units: ScanUnit[]; accounts: AccountMark[] }> {
  const [units, contracts, accounts] = await Promise.all([
    all<{ id: string; label: string; owner_id: string | null }>(env, `
      SELECT u.id, p.name || ' ' || u.unit_number AS label, u.owner_id FROM units u JOIN properties p ON p.id = u.property_id
      WHERE u.parent_unit_id IS NULL ORDER BY p.name, u.unit_number`),
    all<{ unit_id: string; owner_id: string; starts_on: string | null; ends_on: string | null }>(env, `
      SELECT unit_id, owner_id, starts_on, ends_on FROM owner_contracts WHERE unit_id IS NOT NULL AND starts_on IS NOT NULL`),
    all<{ id: string; unit_id: string; kind: string; account_no: string | null; deposit_sen: number | null; building: string | null; owner_name: string | null; last_meter_reading: number | null; pattern: string | null }>(env, `
      SELECT a.id, a.unit_id, a.kind, a.account_no, m.deposit_sen, coalesce(m.building_text, p.name) AS building,
             coalesce(m.owner_name, o.legal_name, o.display_name) AS owner_name, m.last_meter_reading, m.account_no_pattern AS pattern
      FROM unit_utility_accounts a JOIN units u ON u.id = a.unit_id JOIN properties p ON p.id = u.property_id
      LEFT JOIN owners o ON o.id = u.owner_id LEFT JOIN utility_account_marks m ON m.account_id = a.id`),
  ]);
  const byUnit = new Map<string, SplitContract[]>();
  for (const c of contracts) {
    const l = byUnit.get(c.unit_id) ?? [];
    l.push({ startsOn: c.starts_on!.slice(0, 10), endsOn: c.ends_on ? c.ends_on.slice(0, 10) : null, ownerId: c.owner_id });
    byUnit.set(c.unit_id, l);
  }
  return {
    units: units.map(u => ({ id: u.id, label: u.label, ownerId: u.owner_id, contracts: byUnit.get(u.id) ?? [] })),
    /* An account whose own number is empty is matched on the pattern its bills showed. */
    accounts: accounts.map(a => ({
      accountId: a.id, unitId: a.unit_id, kind: a.kind, accountNo: a.account_no || a.pattern || null, depositSen: a.deposit_sen == null ? null : Number(a.deposit_sen),
      building: a.building, ownerName: a.owner_name, lastMeterReading: a.last_meter_reading == null ? null : Number(a.last_meter_reading),
    })),
  };
}

/** Utility bills recorded from three months before `month` to the month after it, for the guards (already recorded, unusual). */
export async function recentBills(env: Env, kind: string, month: string): Promise<RecentBill[]> {
  const rows = await all<{ unit_id: string; category: string; incurred_on: string; amount: number }>(env, `
    SELECT unit_id, category, incurred_on, amount FROM expenses WHERE category = ? AND incurred_on >= ? AND incurred_on < ?`,
    kind, `${addMonths(month, -3)}-01`, `${addMonths(month, 2)}-01`);
  return rows.map(r => ({ unitId: r.unit_id, kind: r.category, billMonth: String(r.incurred_on).slice(0, 7), amountSen: Number(r.amount) }));
}

export type RecordRow = {
  scanId: string; unitId: string; accountId?: string | null; kind: string; billMonth: string;
  periodFrom?: string | null; periodTo?: string | null; amountSen: number; chargeTo?: string; ownerPaid?: boolean;
};
export type RecordResult =
  | { ok: true; recorded: number; rolled: { scanId: string; deductMonth: string }[]; ownerLines: number; notSplit: string[]; toPay: { provider: string; count: number; amountSen: number }[] }
  | { ok: false; status: number; code: string; message: string; fields?: Record<string, string> };

type ScanRow = { id: string; batch_id: string; document_id: string; read: Record<string, unknown>; expense_id: string | null };

export async function recordScannedBills(env: Env, session: { userId: string; fullName?: string }, batchId: string, rows: RecordRow[]): Promise<RecordResult> {
  const bad = (scanId: string, message: string): RecordResult => ({ ok: false, status: 422, code: 'VALIDATION', message, fields: { [scanId]: message } });
  if (!batchId || !rows.length) return { ok: false, status: 422, code: 'VALIDATION', message: 'Tick the bills to record.' };
  if (rows.length > 300) return { ok: false, status: 422, code: 'VALIDATION', message: 'Record up to 300 bills at a time.' };
  for (const r of rows) {
    if (!SCAN_KINDS.includes(r.kind as (typeof SCAN_KINDS)[number])) return bad(r.scanId, 'Pick the kind of bill.');
    if (!MONTH.test(String(r.billMonth))) return bad(r.scanId, 'Enter the bill month.');
    if (!Number.isInteger(r.amountSen) || r.amountSen <= 0) return bad(r.scanId, 'Enter the amount.');
    if (!r.unitId) return bad(r.scanId, 'Pick the unit');
    if ((r.periodFrom && !DATE.test(r.periodFrom)) || (r.periodTo && !DATE.test(r.periodTo)) || (!!r.periodFrom !== !!r.periodTo)) return bad(r.scanId, 'Enter both dates of the period, or neither.');
    if (r.periodFrom && r.periodTo && r.periodTo < r.periodFrom) return bad(r.scanId, 'The period ends before it starts.');
    if (r.chargeTo !== undefined && !CHARGE_TO.includes(r.chargeTo)) return bad(r.scanId, 'Choose who pays the bill.');
  }
  if (new Set(rows.map(r => r.scanId)).size !== rows.length) return { ok: false, status: 422, code: 'VALIDATION', message: 'A page is in the list twice.' };
  const keyOf = (r: RecordRow) => `${r.unitId}|${r.kind}|${r.billMonth}`;
  const dup = rows.find((r, i) => rows.findIndex(x => keyOf(x) === keyOf(r)) !== i);
  if (dup) return bad(dup.scanId, 'Two pages are the same unit, kind and month.');

  const ctx = await scanContext(env);
  const unitOf = new Map(ctx.units.map(u => [u.id, u]));
  const missing = rows.find(r => !unitOf.has(r.unitId));
  if (missing) return bad(missing.scanId, 'That unit was not found.');
  const finals = await finalMonthsFor(env, [...new Set(rows.map(r => r.unitId))], rows.map(r => r.billMonth).sort()[0]);
  const now = nowIso();
  const rolled: { scanId: string; deductMonth: string }[] = [], notSplit: string[] = [];
  let ownerLines = 0;

  try {
    await transaction(env, async tx => {
      const scans = await all<ScanRow>(tx, `SELECT id, batch_id, document_id, read, expense_id FROM utility_bill_scans
        WHERE batch_id = ? AND id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) FOR UPDATE`, batchId, JSON.stringify(rows.map(r => r.scanId)));
      const scanOf = new Map(scans.map(s => [s.id, s]));
      for (const r of rows) {
        const scan = scanOf.get(r.scanId);
        if (!scan) throw new Refused(r.scanId, 'This page was not found in the scan. Scan it again.');
        if (scan.expense_id) throw new Refused(r.scanId, 'Already recorded');
        const read = (typeof scan.read === 'string' ? JSON.parse(scan.read) : scan.read) as Record<string, unknown>;
        /* Two people recording the same bill at once: the second waits here and then sees the first one's bill. */
        await run(tx, 'SELECT pg_advisory_xact_lock(hashtext(?))', `utility-bill|${keyOf(r)}`);
        const there = await one(tx, `SELECT 1 AS x FROM expenses WHERE unit_id = ? AND category = ? AND incurred_on >= ? AND incurred_on <= ?`,
          r.unitId, r.kind, `${r.billMonth}-01`, lastDay(r.billMonth));
        if (there) throw new Refused(r.scanId, 'Already recorded');

        /* The account: the one picked, else the unit's account of this kind, else a new one named from the page. */
        let account = r.accountId
          ? await one<{ id: string; account_no: string; provider: string | null }>(tx, 'SELECT id, account_no, provider FROM unit_utility_accounts WHERE id = ? AND unit_id = ? AND kind = ?', r.accountId, r.unitId, r.kind)
          : await one<{ id: string; account_no: string; provider: string | null }>(tx, 'SELECT id, account_no, provider FROM unit_utility_accounts WHERE unit_id = ? AND kind = ? ORDER BY created_at LIMIT 1', r.unitId, r.kind);
        if (r.accountId && !account) throw new Refused(r.scanId, "That account is not this unit's.");
        const provider = (typeof read.provider === 'string' && read.provider) || account?.provider || null;
        if (!account) {
          const code = (await one<{ code: string }>(tx, `SELECT coalesce(nullif(u.unit_code, ''), u.unit_number) AS code FROM units u WHERE u.id = ?`, r.unitId))?.code ?? r.unitId.slice(0, 8);
          const printed = (typeof read.accountNoFull === 'string' && read.accountNoFull) || (typeof read.accountNoVisible === 'string' && read.accountNoVisible) || '';
          /* Never an empty number: the Utility bills screen reads an empty one as "recorded elsewhere". */
          const accountNo = printed || `${r.kind.toUpperCase()}-${code}`;
          const id = crypto.randomUUID();
          await run(tx, `INSERT INTO unit_utility_accounts (id, unit_id, kind, account_no, provider, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'Added by a bill scan', ?, ?)`,
            id, r.unitId, r.kind, accountNo, provider, now, now);
          account = { id, account_no: accountNo, provider };
        }

        const deductMonth = firstOpenMonth(r.billMonth, finals.get(r.unitId) ?? new Set());
        if (deductMonth !== r.billMonth) rolled.push({ scanId: r.scanId, deductMonth });
        const unit = unitOf.get(r.unitId)!;
        const split = r.periodFrom && r.periodTo ? contractSplit({ from: r.periodFrom, to: r.periodTo }, r.amountSen, unit.contracts) : { kind: 'none' as const };
        if (split.kind === 'two-contracts') notSplit.push(r.scanId);
        const inside = split.kind === 'split' ? split.insideSen : r.amountSen;
        const label = `${KIND_LABEL[r.kind]} ${monthName(r.billMonth)}${provider ? ` (${provider})` : ''}`;
        const expenseId = crypto.randomUUID();
        await run(tx, `INSERT INTO expenses (id, unit_id, category, description, amount, currency, incurred_on, deduct_month, rolled, record_only, reference, charge_to,
            receipt_document_id, period_from, period_to, created_by, created_at)
          VALUES (?, ?, ?, ?, ?, 'MYR', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          expenseId, r.unitId, r.kind,
          split.kind === 'split' && inside > 0 ? `${label}, ${split.insideDays} of ${split.totalDays} days in the contract` : label,
          inside > 0 ? inside : r.amountSen, lastDay(r.billMonth), deductMonth, deductMonth !== r.billMonth, inside <= 0,
          account.account_no, r.chargeTo ?? 'owner', scan.document_id, r.periodFrom ?? null, r.periodTo ?? null, session.userId, now);

        const owner = split.kind === 'split' ? split.ownerId : unit.ownerId;
        /* source stays 'manual' (its CHECK allows manual or owner_workbook, and production SQL never drops a constraint);
           expense_id is what marks a line as a scanned bill's. */
        const adjust = async (amount: number, description: string) => {
          if (!owner) throw new Refused(r.scanId, 'This unit has no owner to put the owner line on.');
          await run(tx, `INSERT INTO owner_adjustments (id, owner_id, unit_id, kind, amount, description, occurred_on, reference, state, source, expense_id, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', 'manual', ?, ?, ?, ?)`,
            crypto.randomUUID(), owner, r.unitId, amount > 0 ? 'credit' : 'charge', amount, description, `${deductMonth}-01`, account!.account_no, expenseId, session.userId, now, now);
          ownerLines++;
        };
        if (split.kind === 'split') {
          await adjust(-split.outsideSen, `${KIND_LABEL[r.kind]} ${shortDate(r.periodFrom!)}–${shortDate(r.periodTo!)}: ${split.outsideDays} of ${split.totalDays} days outside the contract`);
        }
        if (r.ownerPaid) await adjust(r.amountSen, `${label}, paid by the owner`);

        const meter = typeof read.meterCurrent === 'number' ? read.meterCurrent : null;
        await run(tx, `INSERT INTO utility_account_marks (account_id, account_no_pattern, deposit_sen, building_text, owner_name, last_meter_reading, last_bill_month, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (account_id) DO UPDATE SET
            account_no_pattern = coalesce(excluded.account_no_pattern, utility_account_marks.account_no_pattern),
            deposit_sen = coalesce(excluded.deposit_sen, utility_account_marks.deposit_sen),
            building_text = coalesce(excluded.building_text, utility_account_marks.building_text),
            owner_name = coalesce(excluded.owner_name, utility_account_marks.owner_name),
            last_meter_reading = CASE WHEN excluded.last_bill_month >= coalesce(utility_account_marks.last_bill_month, '') THEN coalesce(excluded.last_meter_reading, utility_account_marks.last_meter_reading) ELSE utility_account_marks.last_meter_reading END,
            last_bill_month = greatest(excluded.last_bill_month, utility_account_marks.last_bill_month),
            updated_at = excluded.updated_at`,
          account.id, (read.accountNoVisible as string | null) ?? (read.accountNoFull as string | null) ?? null,
          typeof read.depositSen === 'number' ? read.depositSen : null, (read.buildingName as string | null) ?? null, (read.ownerName as string | null) ?? null,
          meter, r.billMonth, now);
        await run(tx, `UPDATE utility_bill_scans SET expense_id = ?, owner_paid = ?, bill_sen = ?, provider = ?, account_no = ? WHERE id = ?`,
          expenseId, !!r.ownerPaid, r.amountSen, provider ?? KIND_LABEL[r.kind], account.account_no, r.scanId);
        /* The page was uploaded before anyone knew its unit; it is that unit's receipt now. */
        await run(tx, 'UPDATE documents SET unit_id = ? WHERE id = ? AND unit_id IS NULL', r.unitId, scan.document_id);
      }
      await audit(tx, { actorId: session.userId, actorLabel: session.fullName ?? '', action: 'expense.utility_scan', entityTable: 'expenses', entityId: batchId,
        after: { batchId, recorded: rows.length, rolled: rolled.length, ownerLines, notSplit } });
    });
  } catch (e) {
    if (e instanceof Refused) return { ok: false, status: 409, code: e.message === 'Already recorded' ? 'ALREADY_RECORDED' : 'REFUSED', message: e.message, fields: { [e.scanId]: e.message } };
    throw e;
  }
  const toPay = (await billsToPay(env, batchId, rows.map(r => r.scanId))).map(g => ({ provider: g.provider, count: g.bills.length, amountSen: g.bills.reduce((n, x) => n + x.amountSen, 0) }));
  return { ok: true, recorded: rows.length, rolled, ownerLines, notSplit, toPay };
}

class Refused extends Error { constructor(public scanId: string, message: string) { super(message); } }

/** The bills of one save (`scanIds`) the company pays (not ticked "Owner paid"), by provider, for the payment requests. */
export async function billsToPay(env: Env, batchId: string, scanIds: string[], provider?: string): Promise<{ provider: string; bills: { unitId: string; kind: string; billMonth: string; accountNo: string | null; amountSen: number }[] }[]> {
  const rows = await all<{ provider: string; unit_id: string; category: string; incurred_on: string; account_no: string | null; bill_sen: number }>(env, `
    SELECT s.provider, e.unit_id, e.category, e.incurred_on, s.account_no, s.bill_sen FROM utility_bill_scans s JOIN expenses e ON e.id = s.expense_id
    WHERE s.batch_id = ? AND NOT s.owner_paid AND s.id IN (SELECT jsonb_array_elements_text(?::text::jsonb))
    ORDER BY s.provider, e.incurred_on, e.unit_id`, batchId, JSON.stringify(scanIds));
  const out = new Map<string, { unitId: string; kind: string; billMonth: string; accountNo: string | null; amountSen: number }[]>();
  for (const r of rows) {
    if (provider && r.provider !== provider) continue;
    const l = out.get(r.provider) ?? [];
    l.push({ unitId: r.unit_id, kind: r.category, billMonth: String(r.incurred_on).slice(0, 7), accountNo: r.account_no, amountSen: Number(r.bill_sen) });
    out.set(r.provider, l);
  }
  return [...out].map(([p, bills]) => ({ provider: p, bills }));
}
