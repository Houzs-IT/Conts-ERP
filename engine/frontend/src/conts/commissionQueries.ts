// Conts only: sales commission on renovation contracts (backend scm/routes/renovation-commission.ts, /api/scm/commission).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authedFetch } from "../vendor/scm/lib/authed-fetch";

export type StageKind = "collected" | "instalment";
export type CommissionStage = { label: string; kind: StageKind; value: number; releaseBp: number };
export type CommissionTier = { fromSen: number; bp: number };
export type CommissionScheme = {
  id: string; name: string; branding: string | null; managerStaffId: string | null; managerBp: number; companyPoolBp: number;
  tiers: CommissionTier[]; stages: CommissionStage[]; active: boolean;
};
export type CommissionShare = {
  staffId: string; staffName: string; role: "sales" | "manager"; rateBp: number;
  totalSen: number; earnedSen: number; paidSen: number; claimableSen: number;
};
export type CommissionPortion = {
  month: string; date: string; sen: number; source: "SO" | "VO" | "OTHER"; ref: string;
  monthSalesSen: number; salesBp: number; managerBp: number; salesSen: number; managerSen: number;
  salespersonId: string; salespersonName: string; managerStaffId: string | null; managerName: string | null;
  /** When the month closed and these rates were fixed; null while the month is still open. */
  lockedAt: string | null;
};
export type CommissionRow = {
  soDocNo: string; soDate: string | null; projectName: string; customerName: string; status: string; branding: string | null;
  salespersonId: string | null; salespersonName: string | null; schemeId: string | null; schemeName: string | null;
  problem: "no_salesperson" | "no_scheme" | null;
  baseSen: number; collectedSen: number; collectedBp: number; releasedBp: number; companyPoolSen: number;
  stages: Array<{ label: string; thresholdBp: number | null; reached: boolean; releaseBp: number }>;
  portions: CommissionPortion[];
  shares: CommissionShare[];
};
export type CommissionPayout = {
  id: string; soDocNo: string; staffId: string; staffName: string; amountSen: number; paidOn: string; note: string;
  createdBy: string | null; voidedAt: string | null;
};
export type CommissionMonth = { schemeId: string; staffId: string; staffName: string; month: string; salesSen: number };
/** What the caller may do: management sees and pays everyone; a scheme's sales manager sees and sets that scheme;
    everyone else sees only their own share. */
export type CommissionViewer = { staffId: string | null; isAdmin: boolean; canPay: boolean; canAddScheme: boolean; editableSchemeIds: string[] };
export type CommissionData = {
  rows: CommissionRow[]; schemes: CommissionScheme[]; payouts: CommissionPayout[];
  staff: Array<{ id: string; name: string }>; months: CommissionMonth[]; brandings: string[]; viewer: CommissionViewer;
};

const KEY = ["conts-commission"];
export const useCommission = () => useQuery({ queryKey: KEY, queryFn: () => authedFetch<CommissionData>("/commission"), staleTime: 30_000 });

function useSave<V>(fn: (v: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: KEY }) });
}
const send = (path: string, method: string, body?: unknown) => authedFetch(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

export type SchemeInput = Omit<CommissionScheme, "id">;
export const useSaveScheme = () => useSave((v: { id: string | null; scheme: SchemeInput; relockClosedMonths?: boolean }) =>
  v.id ? send(`/commission/schemes/${v.id}`, "PUT", { ...v.scheme, relockClosedMonths: v.relockClosedMonths === true }) : send("/commission/schemes", "POST", v.scheme));
export const useDeleteScheme = () => useSave((id: string) => send(`/commission/schemes/${id}`, "DELETE"));
export const useRecordPayout = () => useSave((v: { soDocNo: string; staffId: string; amountSen: number; paidOn: string; note: string }) =>
  send("/commission/payouts", "POST", v));
export const useSettle = () => useSave((v: { paidOn: string; note: string; items: Array<{ soDocNo: string; staffId: string; amountSen: number }> }) =>
  send("/commission/payouts/batch", "POST", v));
export const useVoidPayout = () => useSave((id: string) => send(`/commission/payouts/${id}/void`, "POST"));

/* ── Display helpers (pure) ─────────────────────────────────────────────── */
export const pctText = (bp: number): string => `${Number((bp / 100).toFixed(2))}%`;
export const bpFromPct = (text: string): number | null => {
  const t = text.replace("%", "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
};
export const senFromRm = (text: string): number | null => {
  const t = text.replace(/^\s*RM\s*/i, "").replace(/,/g, "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
};
/** The salesperson's rate for a month's sales under a scheme (the backend's salesRateBp; display only). */
export const tierBp = (tiers: readonly CommissionTier[], salesSen: number, capBp: number): number => {
  let bp = 0;
  for (const t of [...tiers].sort((a, b) => a.fromSen - b.fromSen)) if (salesSen >= t.fromSen) bp = t.bp;
  return Math.max(0, Math.min(bp, capBp));
};
export const stageText = (s: CommissionStage): string =>
  s.kind === "instalment" ? `Payment ${s.value} paid` : `${pctText(s.value)} collected`;

/** One line per person: what they earned, were paid and can still claim, over every contract. */
export type PersonTotal = { staffId: string; staffName: string; orders: number; totalSen: number; earnedSen: number; paidSen: number; claimableSen: number };
export function personTotals(rows: readonly CommissionRow[]): PersonTotal[] {
  const out = new Map<string, PersonTotal>();
  for (const r of rows) for (const s of r.shares) {
    const t = out.get(s.staffId) ?? { staffId: s.staffId, staffName: s.staffName, orders: 0, totalSen: 0, earnedSen: 0, paidSen: 0, claimableSen: 0 };
    t.orders += 1; t.totalSen += s.totalSen; t.earnedSen += s.earnedSen; t.paidSen += s.paidSen; t.claimableSen += s.claimableSen;
    out.set(s.staffId, t);
  }
  return [...out.values()].sort((a, b) => b.claimableSen - a.claimableSen || a.staffName.localeCompare(b.staffName));
}

/** One claim ready to pay: a person's unpaid, released commission on one order. */
export type Claim = { key: string; row: CommissionRow; share: CommissionShare };
export function claimsOf(rows: readonly CommissionRow[]): Claim[] {
  const out: Claim[] = [];
  for (const r of rows) for (const s of r.shares) if (s.claimableSen > 0) out.push({ key: `${r.soDocNo}|${s.staffId}`, row: r, share: s });
  return out.sort((a, b) => a.share.staffName.localeCompare(b.share.staffName) || (a.row.soDate ?? "").localeCompare(b.row.soDate ?? ""));
}

/** A salesperson's month: every SO and VO dated in it, the total that picked the tier, and the rate it paid. */
export type MonthGroup = {
  key: string; staffId: string; staffName: string; month: string; schemeName: string; totalSen: number; salesBp: number; locked: boolean;
  lines: Array<{ row: CommissionRow; portion: CommissionPortion }>;
};
export function monthGroups(rows: readonly CommissionRow[]): MonthGroup[] {
  const out = new Map<string, MonthGroup>();
  for (const r of rows) {
    if (r.problem) continue;
    for (const p of r.portions) {
      const key = `${r.schemeId}|${p.salespersonId}|${p.month}`;
      const g = out.get(key) ?? { key, staffId: p.salespersonId, staffName: p.salespersonName, month: p.month, schemeName: r.schemeName ?? "", totalSen: p.monthSalesSen, salesBp: p.salesBp, locked: p.lockedAt != null, lines: [] };
      g.lines.push({ row: r, portion: p });
      out.set(key, g);
    }
  }
  return [...out.values()].sort((a, b) => b.month.localeCompare(a.month) || a.staffName.localeCompare(b.staffName));
}

/** One person's commission on one part of an order (the SO, a VO, other changes), and how much of it was claimed.
    Payments are set against the parts in order: the SO first, then each VO by date. */
export type ClaimPart = { portion: CommissionPortion; rateBp: number; commissionSen: number; earnedSen: number; claimedSen: number; leftSen: number };
export function claimParts(row: CommissionRow, staffId: string, paidSen: number): ClaimPart[] {
  const parts = [...row.portions]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((p) => {
      const commissionSen = (p.salespersonId === staffId ? p.salesSen : 0) + (p.managerStaffId === staffId ? p.managerSen : 0);
      const rateBp = (p.salespersonId === staffId ? p.salesBp : 0) + (p.managerStaffId === staffId ? p.managerBp : 0);
      return { portion: p, rateBp, commissionSen, earnedSen: Math.round((commissionSen * row.releasedBp) / 10_000), claimedSen: 0, leftSen: 0 };
    })
    .filter((x) => x.commissionSen !== 0);
  let rest = paidSen;
  parts.forEach((x, i) => {
    const take = i === parts.length - 1 ? rest : Math.max(0, Math.min(rest, x.earnedSen));
    x.claimedSen = take;
    rest -= take;
    x.leftSen = x.earnedSen - x.claimedSen;
  });
  return parts;
}

/** A person's month: what they sold, the rate it reached, the commission it made them, and the money that moved. */
export type PersonMonth = {
  month: string; salesSen: number; salesBp: number | null; commissionSen: number;
  lines: Array<{ row: CommissionRow; portion: CommissionPortion; role: "sales" | "manager"; rateBp: number; commissionSen: number }>;
};
export function personMonths(rows: readonly CommissionRow[], staffId: string): PersonMonth[] {
  const out = new Map<string, PersonMonth>();
  for (const r of rows) for (const p of r.portions) {
    const asSales = p.salespersonId === staffId && p.salesSen !== 0;
    const asManager = p.managerStaffId === staffId && p.managerSen !== 0;
    if (!asSales && !asManager && p.salespersonId !== staffId) continue;
    const m = out.get(p.month) ?? { month: p.month, salesSen: 0, salesBp: null, commissionSen: 0, lines: [] };
    if (p.salespersonId === staffId) { m.salesSen += p.sen; m.salesBp = p.salesBp; }
    if (asSales || p.salespersonId === staffId) m.lines.push({ row: r, portion: p, role: "sales", rateBp: p.salesBp, commissionSen: p.salesSen });
    if (asManager) m.lines.push({ row: r, portion: p, role: "manager", rateBp: p.managerBp, commissionSen: p.managerSen });
    m.commissionSen += (asSales ? p.salesSen : 0) + (asManager ? p.managerSen : 0);
    out.set(p.month, m);
  }
  return [...out.values()].sort((a, b) => b.month.localeCompare(a.month));
}
