// ----------------------------------------------------------------------------
// Opening deposits by project or unit (finance, chew 2 Nov 2026; plan
// docs/superpowers/plans/2026-11-02-renovation-close-out.md Task 2).
//
// The OPENING journal carries each 330 deposit account as one figure from
// AutoCount's trial balance. Finance uploads, by deposit account, which project
// or unit each deposit still out belongs to. One journal, OPENING_DEPOSITS,
// dated the opening day, tags them without moving any account's total:
//   for each row     Dr the account on its project (or unit)
//   for each account Cr the same account untagged, for the rows' total
// so a deposit returned after go-live on its project or unit nets to nothing
// there, which the renovation close-out check reads (acc/reno-close-out).
// Never more than the account's opening balance; one at a time; reverse it on
// its own day to do it again.
// ----------------------------------------------------------------------------

import { postJournal, reverseJournal } from './engine';
import { loadLedgerSettings } from './ledger-settings';
import { dayBefore } from './opening';
import type { Department } from './rules';

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST client, untyped throughout the acc layer */
type Db = any;
type Row = Record<string, any>;

export const OPENING_DEPOSITS = 'OPENING_DEPOSITS';
const DOC = 'OPENING-DEPOSITS';

export type OpeningDepositRow = {
  accountCode: string;
  /** A project's code (RN-2607-003), or a unit by building and number: exactly one of the two. */
  projectCode?: string | null; building?: string | null; unitNumber?: string | null;
  amountSen: number; paidTo?: string | null;
};
export type DepositProblem = { row: number; problem: string };
export type OpeningDepositsResult =
  | { ok: true; dryRun?: boolean; jeNo?: string; rows: number; totalSen: number }
  | { ok: false; error?: string; problems?: DepositProblem[] };

const norm = (v: unknown): string => String(v ?? '').trim().toUpperCase();

async function activeDeposits(sb: Db, companyId: number): Promise<{ ok: true; je: Row | null } | { ok: false; error: string }> {
  const { data, error } = await sb.from('journal_entries').select('id, je_no, reversed').eq('company_id', companyId).eq('source_type', OPENING_DEPOSITS);
  if (error) return { ok: false, error: error.message };
  return { ok: true, je: ((data ?? []) as Row[]).find((j) => !j.reversed) ?? null };
}

export async function importOpeningDeposits(
  sb: Db, companyId: number, rows: OpeningDepositRow[], actorName: string, opts: { dryRun?: boolean } = {},
): Promise<OpeningDepositsResult> {
  const ls = await loadLedgerSettings(sb, companyId);
  if (!ls.ok) return { ok: false, error: 'The ledger settings could not be read.' };
  if (!ls.settings.ledgerStartDate) return { ok: false, error: 'Set the day the books start first.' };
  const day = dayBefore(ls.settings.ledgerStartDate);

  /* The opening balances per account, from the OPENING journal now in the books. */
  const { data: ops, error: opErr } = await sb.from('journal_entries').select('id, reversed').eq('company_id', companyId).eq('source_type', 'OPENING');
  if (opErr) return { ok: false, error: opErr.message };
  const opening = ((ops ?? []) as Row[]).find((j) => !j.reversed);
  if (!opening) return { ok: false, error: 'Import the opening balances first: the deposits are taken from them.' };
  const { data: opLines, error: lErr } = await sb.from('journal_entry_lines').select('account_code, debit_sen, credit_sen').eq('journal_entry_id', opening.id);
  if (lErr) return { ok: false, error: lErr.message };
  const openingOf = new Map<string, number>();
  for (const l of (opLines ?? []) as Row[]) openingOf.set(String(l.account_code), (openingOf.get(String(l.account_code)) ?? 0) + Number(l.debit_sen ?? 0) - Number(l.credit_sen ?? 0));

  const existing = await activeDeposits(sb, companyId);
  if (!existing.ok) return { ok: false, error: existing.error };
  if (existing.je && !opts.dryRun) return { ok: false, error: `The opening deposits ${existing.je.je_no} are already in the books — reverse them first to import again.` };

  const [{ data: accs, error: aErr }, { data: projects, error: pErr }, { data: units, error: uErr }] = await Promise.all([
    sb.from('accounts').select('account_code, account_type, is_active').eq('company_id', companyId).like('account_code', '330-%'),
    sb.schema('public').from('projects').select('id, code').eq('company_id', companyId),
    sb.schema('public').from('conts_units').select('id, building, unit_number'),
  ]);
  if (aErr || pErr || uErr) return { ok: false, error: (aErr ?? pErr ?? uErr).message };
  const depositAccount = new Set(((accs ?? []) as Row[]).filter((a) => a.account_type === 'ASSET' && a.is_active !== false).map((a) => String(a.account_code)));
  const projectOf = new Map(((projects ?? []) as Row[]).filter((p) => p.code).map((p) => [norm(p.code), Number(p.id)]));
  const unitOf = new Map(((units ?? []) as Row[]).map((u) => [`${norm(u.building)}|${norm(u.unit_number)}`, String(u.id)]));

  const problems: DepositProblem[] = [];
  const lines: Array<{ accountCode: string; sen: number; projectId: number | null; unitId: string | null; paidTo: string | null }> = [];
  rows.forEach((r, i) => {
    const row = i + 1;
    const code = String(r.accountCode ?? '').trim();
    const sen = Number(r.amountSen);
    const hasProject = !!String(r.projectCode ?? '').trim();
    const hasUnit = !!String(r.building ?? '').trim() || !!String(r.unitNumber ?? '').trim();
    if (!depositAccount.has(code)) { problems.push({ row, problem: `${code || 'No account'} is not a 330 deposit account.` }); return; }
    if (!Number.isInteger(sen) || sen <= 0) { problems.push({ row, problem: 'The amount must be above zero.' }); return; }
    if (hasProject === hasUnit) { problems.push({ row, problem: 'Name either a project code or a unit (building and unit), not both and not neither.' }); return; }
    let projectId: number | null = null;
    let unitId: string | null = null;
    if (hasProject) {
      projectId = projectOf.get(norm(r.projectCode)) ?? null;
      if (projectId == null) { problems.push({ row, problem: `No project ${String(r.projectCode).trim()}.` }); return; }
    } else {
      unitId = unitOf.get(`${norm(r.building)}|${norm(r.unitNumber)}`) ?? null;
      if (unitId == null) { problems.push({ row, problem: `No unit ${String(r.building ?? '').trim()} ${String(r.unitNumber ?? '').trim()}.` }); return; }
    }
    lines.push({ accountCode: code, sen, projectId, unitId, paidTo: r.paidTo ? String(r.paidTo).trim() : null });
  });
  const byAccount = new Map<string, number>();
  for (const l of lines) byAccount.set(l.accountCode, (byAccount.get(l.accountCode) ?? 0) + l.sen);
  for (const [code, sum] of byAccount) {
    const open = openingOf.get(code) ?? 0;
    if (sum > open) problems.push({ row: 0, problem: `${code}: the deposits come to RM ${(sum / 100).toFixed(2)}, more than its opening balance of RM ${(open / 100).toFixed(2)}.` });
  }
  if (problems.length > 0) return { ok: false, problems };
  const totalSen = lines.reduce((s, l) => s + l.sen, 0);
  if (opts.dryRun) return { ok: true, dryRun: true, rows: lines.length, totalSen };

  /* A project's deposit is Renovation's, a unit's is Rental's; each account comes off untagged in the same department. */
  const dept = (l: { projectId: number | null }): Department => (l.projectId != null ? 'supply' : 'rental');
  const offs = new Map<string, number>();
  for (const l of lines) offs.set(`${l.accountCode}|${dept(l)}`, (offs.get(`${l.accountCode}|${dept(l)}`) ?? 0) + l.sen);
  const r = await postJournal(sb, {
    companyId, entryDate: day, sourceType: OPENING_DEPOSITS, sourceDocNo: DOC,
    narration: `Opening deposits by project or unit, imported by ${actorName}`,
    lines: [
      ...lines.map((l) => ({ accountCode: l.accountCode, debitSen: l.sen, creditSen: 0, department: dept(l), projectId: l.projectId, unitId: l.unitId, notes: l.paidTo ? `Paid to ${l.paidTo}` : null })),
      ...[...offs].map(([k, sen]) => { const [accountCode, department] = k.split('|') as [string, Department]; return { accountCode, debitSen: 0, creditSen: sen, department, notes: 'Opening deposits, untagged' }; }),
    ],
  });
  if (!r.ok) return { ok: false, error: r.reason ? `${r.status}: ${r.reason}` : r.status };
  if (r.status !== 'posted') return { ok: false, error: `The opening deposits ${r.jeNo} are already in the books — reverse them first to import again.` };
  return { ok: true, jeNo: r.jeNo, rows: lines.length, totalSen };
}

/** Reverse the opening deposits on their own day, so they can be imported again. */
export async function reverseOpeningDeposits(sb: Db, companyId: number): Promise<{ ok: true; jeNo: string } | { ok: false; error: string }> {
  const existing = await activeDeposits(sb, companyId);
  if (!existing.ok) return { ok: false, error: existing.error };
  if (!existing.je) return { ok: false, error: 'There are no opening deposits to reverse.' };
  const { data: je } = await sb.from('journal_entries').select('entry_date').eq('id', existing.je.id).maybeSingle();
  const r = await reverseJournal(sb, {
    sourceType: OPENING_DEPOSITS, jeId: existing.je.id, companyId, entryDate: String((je as Row | null)?.entry_date ?? '').slice(0, 10),
    narration: (orig) => `Reversal of ${orig.je_no} — opening deposits to be imported again`,
  });
  if (!r.ok) return { ok: false, error: r.reason ? `${r.status}: ${r.reason}` : r.status };
  if (r.status !== 'reversed') return { ok: false, error: `Not reversed: ${r.status}.` };
  return { ok: true, jeNo: r.jeNo };
}
