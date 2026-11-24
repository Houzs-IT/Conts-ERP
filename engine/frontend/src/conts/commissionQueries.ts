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
export type CommissionData = {
  rows: CommissionRow[]; schemes: CommissionScheme[]; payouts: CommissionPayout[];
  staff: Array<{ id: string; name: string }>; months: CommissionMonth[]; brandings: string[];
};

const KEY = ["conts-commission"];
export const useCommission = () => useQuery({ queryKey: KEY, queryFn: () => authedFetch<CommissionData>("/commission"), staleTime: 30_000 });

function useSave<V>(fn: (v: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: KEY }) });
}
const send = (path: string, method: string, body?: unknown) => authedFetch(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

export type SchemeInput = Omit<CommissionScheme, "id">;
export const useSaveScheme = () => useSave((v: { id: string | null; scheme: SchemeInput }) =>
  v.id ? send(`/commission/schemes/${v.id}`, "PUT", v.scheme) : send("/commission/schemes", "POST", v.scheme));
export const useDeleteScheme = () => useSave((id: string) => send(`/commission/schemes/${id}`, "DELETE"));
export const useRecordPayout = () => useSave((v: { soDocNo: string; staffId: string; amountSen: number; paidOn: string; note: string }) =>
  send("/commission/payouts", "POST", v));
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
