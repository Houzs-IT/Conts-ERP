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

/* ── Is the ledger ready to go live? (spec 3.4) — GET /accounting/setup-status ─────────────────────────────── */
export type RoleProblem = "missing_account" | "inactive" | "header" | "not_money";
export type LedgerSetupStatus = {
  ready: boolean;
  roles: { role: string; accountCode: string; problem: null | RoleProblem }[];
  itemGroups: { group: string; missing: string[] }[];
  banksWithoutLetter: string[];
  ledgerStartDate: string | null;
};

export const useSetupStatus = () => useQuery({
  queryKey: ["ledger-setup-status"],
  queryFn: () => authedFetch<LedgerSetupStatus>("/accounting/setup-status"),
  staleTime: 30_000,
});

/** Point one posting rule at an account — PUT /accounting/roles/:role. */
export const useSetRole = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ role, accountCode }: { role: string; accountCode: string }) =>
      authedFetch<{ ok: true }>(`/accounting/roles/${encodeURIComponent(role)}`, { method: "PUT", body: JSON.stringify({ accountCode }) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["ledger-setup-status"] });
      void qc.invalidateQueries({ queryKey: ["account-roles"] });
    },
  });
};

/** Each posting rule in the words finance uses (backend/src/acc/rules.ts AccountRole). */
export const ROLE_LABELS: Record<string, string> = {
  AR: "Trade debtors (customers)", AR_OTHER: "Other debtors", SALES: "Sales (fallback)", INVENTORY: "Stock (fallback)",
  AP: "Trade creditors (suppliers)", AP_OTHER: "Other creditors", CASH: "Cash in hand", BANK_DEFAULT: "Default bank",
  TRANSIT_EDC: "Card machine clearing", TRANSIT_ONLINE: "Online payment clearing", CUSTOMER_DEPOSITS: "Customer deposits",
  OVER_SHORT: "Cash over / short", CLOSING_STOCK: "Closing stock (one account)",
  INVENTORY_CUSTOMER: "Stock — customer", INVENTORY_DISPLAY: "Stock — display", INVENTORY_SERVICE: "Stock — service",
  OPENING_STOCK_CUSTOMER: "Opening stock — customer", OPENING_STOCK_DISPLAY: "Opening stock — display", OPENING_STOCK_SERVICE: "Opening stock — service",
  CLOSING_STOCK_CUSTOMER: "Closing stock — customer", CLOSING_STOCK_DISPLAY: "Closing stock — display", CLOSING_STOCK_SERVICE: "Closing stock — service",
  SALES_RETURNS: "Sales returns", PURCHASE_RETURNS: "Purchase returns", DEPOSIT_INCOME: "Deposit invoices (income)",
};

export const PROBLEM_TEXT: Record<RoleProblem, string> = {
  missing_account: "not in the chart",
  inactive: "inactive",
  header: "has accounts under it — choose one of those",
  not_money: "must be a bank or cash account",
};
