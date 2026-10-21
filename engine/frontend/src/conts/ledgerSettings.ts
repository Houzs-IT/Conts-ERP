// Conts only (not part of Houzs's code): the ledger settings (finance phase 1, spec 3.7 and 3.8) — the day the
// books start in the engine and the month the fiscal year ends. Read and saved through
// GET/PUT /accounting/settings/ledger (backend/src/scm/routes/accounting.ts).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authedFetch } from "../vendor/scm/lib/authed-fetch";

export type LedgerSettings = { ledgerStartDate: string | null; fiscalYearEndMonth: number };

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

/** The first day of the fiscal year a date falls in — the same rule as backend/src/acc/ledger-settings.ts. */
export function fiscalYearStart(asOf: string, fyEndMonth: number): string {
  const year = Number(asOf.slice(0, 4));
  const month = Number(asOf.slice(5, 7));
  const startMonth = (fyEndMonth % 12) + 1;
  const startYear = month >= startMonth ? year : year - 1;
  return `${startYear}-${String(startMonth).padStart(2, "0")}-01`;
}

const KEY = ["ledger-settings"];

export const useLedgerSettings = () => useQuery({
  queryKey: KEY,
  queryFn: () => authedFetch<LedgerSettings>("/accounting/settings/ledger"),
  staleTime: 60_000,
});

export const useSaveLedgerSettings = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<LedgerSettings>) =>
      authedFetch<LedgerSettings>("/accounting/settings/ledger", { method: "PUT", body: JSON.stringify(patch) }),
    onSuccess: (saved) => {
      qc.setQueryData(KEY, saved);
      // Every statement reads the fiscal year; posting reads the start date.
      void qc.invalidateQueries({ queryKey: ["report-bs"] });
      void qc.invalidateQueries({ queryKey: ["report-pnl"] });
      void qc.invalidateQueries({ queryKey: ["report-monthly"] });
      void qc.invalidateQueries({ queryKey: ["account-balances"] });
      void qc.invalidateQueries({ queryKey: ["finance-dashboard"] });
    },
  });
};
