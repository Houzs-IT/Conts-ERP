// Conts only: the renovation project status table (SOP 4.2.3; backend acc/reno-projects.ts, GET /accounting/reno-projects).
// Management only: completion revenue is never in the books.
import { useQuery } from "@tanstack/react-query";
import { authedFetch } from "../vendor/scm/lib/authed-fetch";

export type RenoProjectRow = {
  soDocNo: string; projectId: number | null; projectName: string; customerCode: string | null; customerName: string;
  salesperson: string | null; brand: string | null; kind: "RENOVATION" | "INHOUSE_RENOVATION"; status: string; stage: string | null;
  handoverDate: string | null; delayed: boolean;
  contractSen: number; voSen: number; revisedContractSen: number;
  receivedSen: number; outstandingSen: number; collectedBp: number | null;
  nextInstalment: { seq: number; label: string; amountSen: number; trigger: string } | null;
  gapsByInvoiceDays: Array<number | null>; gapsByPaymentDays: Array<number | null>;
  invoicedSen: number; advanceLeftSen: number; completionBp: number; earnedSen: number; differenceSen: number;
  expectedCostSen: number; costSpentSen: number; orderedNotBilledSen: number; remainingCostSen: number; owedToSuppliersSen: number;
  overBudget: boolean; lossExpected: boolean; goliveCostMissing: boolean;
  expectedGpBp: number | null; gpToDateBp: number | null;
  workAheadOfMoney: boolean;
};

export const useRenoProjects = (asOf: string) => useQuery({
  queryKey: ["conts-reno-projects", asOf],
  queryFn: () => authedFetch<{ asOf: string; rows: RenoProjectRow[] }>(`/accounting/reno-projects?asOf=${encodeURIComponent(asOf)}`),
  staleTime: 60_000,
});

/** The alerts a row raises, in plain words (SOP 4.2.1, 4.2.3). */
export function alertsOf(r: RenoProjectRow): string[] {
  const out: string[] = [];
  if (r.overBudget) out.push("Over budget");
  if (r.lossExpected) out.push("Loss expected");
  if (r.workAheadOfMoney) out.push("Work ahead of money");
  if (r.goliveCostMissing) out.push("Cost before go-live not entered");
  if (r.delayed) out.push("Delayed");
  return out;
}

/** The KPI row, worked out once from the rows the table shows. */
export function kpisOf(rows: RenoProjectRow[]): { revisedSen: number; invoicedSen: number; earnedSen: number; overBudget: number } {
  return rows.reduce((k, r) => ({
    revisedSen: k.revisedSen + r.revisedContractSen, invoicedSen: k.invoicedSen + r.invoicedSen,
    earnedSen: k.earnedSen + r.earnedSen, overBudget: k.overBudget + (r.overBudget ? 1 : 0),
  }), { revisedSen: 0, invoicedSen: 0, earnedSen: 0, overBudget: 0 });
}
