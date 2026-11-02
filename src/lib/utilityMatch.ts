/** Which unit a scanned utility bill page is for (spec docs/superpowers/specs/2026-10-27-utility-bills-design.md §5.3-5.4;
 *  plan docs/superpowers/plans/2026-11-02-utility-bill-scan.md Task 3). Each account of the bill's kind is scored:
 *    decisive  the full account number;
 *    strong    the visible digits of a masked number, the deposit, the previous meter reading = the account's last one;
 *    supporting  the building or the owner's name.
 *  Green: one account with a decisive clue, or two strong ones, and no other account with a strong clue. Amber: any
 *  other clue (a building or owner name alone is never green). Red: nothing, or a page with no amount or month. */
export type BillReadLite = {
  kind: string; billMonth: string | null; amountDueSen: number | null; accountNoVisible: string | null; accountNoFull: string | null;
  depositSen: number | null; buildingName: string | null; ownerName: string | null; meterPrevious: number | null;
};
export type AccountMark = {
  accountId: string; unitId: string; kind: string; accountNo: string | null; depositSen: number | null;
  building: string | null; ownerName: string | null; lastMeterReading: number | null;
};
export type RecentBill = { unitId: string; kind: string; billMonth: string; amountSen: number };
export type Match = {
  colour: 'green' | 'amber' | 'red'; accountId: string | null; alreadyRecorded: boolean;
  candidates: { accountId: string; clues: string[] }[]; reasons: string[];
};

const digits = (s: string) => s.replace(/[^0-9X]/gi, '').toUpperCase();
const words = (s: string | null) => (s ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

/** A printed number with masked digits (TNB: 2104010945XX02) against one on file: the digits before the mask begin it
 *  and those after end it. At least six digits must show to count. A number with no mask must be equal. */
export function accountNoMatches(printed: string, onFile: string): boolean {
  const p = digits(printed), f = digits(onFile);
  if (!p || !f) return false;
  if (!p.includes('X')) return p === f;
  const head = p.slice(0, p.indexOf('X')), tail = p.slice(p.lastIndexOf('X') + 1);
  return head.length + tail.length >= 6 && f.startsWith(head) && f.endsWith(tail) && f.length >= head.length + tail.length;
}

const nameMatches = (printed: string | null, onFile: string | null) => {
  const a = words(printed), b = words(onFile);
  return !!a && !!b && (a.includes(b) || b.includes(a));
};

export function matchBill(read: BillReadLite, accounts: AccountMark[], recent: RecentBill[]): Match {
  const scored = accounts.filter(a => a.kind === read.kind).map(a => {
    const decisive: string[] = [], strong: string[] = [], supporting: string[] = [];
    if (read.accountNoFull && a.accountNo && digits(read.accountNoFull) === digits(a.accountNo)) decisive.push(`account ${read.accountNoFull}`);
    else if (read.accountNoVisible && a.accountNo && accountNoMatches(read.accountNoVisible, a.accountNo)) {
      (read.accountNoVisible.toUpperCase().includes('X') ? strong : decisive).push(`account ${read.accountNoVisible}`);
    }
    if (read.depositSen != null && a.depositSen != null && read.depositSen === a.depositSen) strong.push(`deposit ${(a.depositSen / 100).toFixed(2)}`) /* no format.ts here: node --test loads this file on its own */;
    if (read.meterPrevious != null && a.lastMeterReading != null && read.meterPrevious === a.lastMeterReading) strong.push(`meter reading ${read.meterPrevious}`);
    if (nameMatches(read.buildingName, a.building)) supporting.push('building');
    if (nameMatches(read.ownerName, a.ownerName)) supporting.push('owner name');
    return { a, decisive, strong, supporting, clues: [...decisive, ...strong, ...supporting] };
  }).filter(s => s.clues.length);

  const withStrong = scored.filter(s => s.decisive.length || s.strong.length);
  const best = scored.find(s => s.decisive.length || s.strong.length >= 2);
  const reasons: string[] = [];
  let colour: Match['colour'];
  let pick: (typeof scored)[number] | undefined;
  if (best && withStrong.length === 1) { colour = 'green'; pick = best; }
  else if (withStrong.length === 1) { colour = 'amber'; pick = withStrong[0]; }
  else if (withStrong.length > 1) { colour = 'amber'; reasons.push('Clues point to more than one unit'); }
  else if (scored.length === 1) { colour = 'amber'; pick = scored[0]; }
  else if (scored.length > 1) { colour = 'amber'; reasons.push('Clues point to more than one unit'); }
  else { colour = 'red'; reasons.push('No unit matched'); }
  if (pick) reasons.unshift(`${pick.clues.join(' + ')} match`);

  if (read.amountDueSen == null || read.billMonth == null) { colour = 'red'; reasons.push('The amount or the month could not be read'); }

  let alreadyRecorded = false;
  if (pick && read.billMonth) {
    const unitBills = recent.filter(r => r.unitId === pick!.a.unitId && r.kind === read.kind);
    if (unitBills.some(r => r.billMonth === read.billMonth)) { alreadyRecorded = true; reasons.push('Already recorded'); }
    const before = unitBills.filter(r => r.billMonth < read.billMonth!).sort((x, y) => (x.billMonth < y.billMonth ? 1 : -1)).slice(0, 3);
    if (read.amountDueSen != null && before.length) {
      const usual = before.reduce((n, r) => n + r.amountSen, 0) / before.length;
      if (usual > 0 && read.amountDueSen > usual * 1.5) { reasons.push('Much higher than usual'); if (colour === 'green') colour = 'amber'; }
      else if (usual > 0 && read.amountDueSen < usual * 0.5) { reasons.push('Much lower than usual'); if (colour === 'green') colour = 'amber'; }
    }
  }
  return {
    colour, accountId: pick?.a.accountId ?? null, alreadyRecorded,
    candidates: (pick ? [pick] : scored).map(s => ({ accountId: s.a.accountId, clues: s.clues })),
    reasons,
  };
}
