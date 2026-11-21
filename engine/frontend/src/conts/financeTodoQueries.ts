// Conts: Finance's To do (ported from Houzs finance-todo-queries.ts). Every rule lives on the server
// (backend conts/finance-todo.ts); this is transport only.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authedFetch } from "../vendor/scm/lib/authed-fetch";
import { retryUnlessClientError } from "../lib/retryPolicy";
import { FINANCE_TODO_COUNT_KEY } from "../hooks/useAmendmentApprovals";

export type TodoRule =
  | "requests" | "utilities" | "claims-check" | "claims-pay"
  | "pv-check" | "pv-approve" | "ap-overdue" | "ap-due" | "limits"
  | "bank-missing" | "bank-decide"
  | "receipts" | "deposit-invoices" | "einvoice";

export type TodoGroup = "pay" | "bank" | "in";
export type TodoTone = "bank" | "out" | "money" | "err";
export type TodoIcon = "upload" | "landmark" | "send" | "wallet" | "receipt" | "alert-triangle" | "file-text" | "hand-coins" | "zap" | "gauge";

export type TodoJob = {
  key: string;
  rule: TodoRule;
  group: TodoGroup;
  tone: TodoTone;
  icon: TodoIcon;
  title: string;
  detail: string;
  amountSen: number | null;
  /** The day the oldest thing in it began waiting (YYYY-MM-DD). */
  since: string | null;
  action: { label: string; to: string; primary: boolean };
  /** Waiting on others only: who it waits for. */
  who: string | null;
};

/** `ref` is the document it touched (a voucher number), when there is one. */
export type TodoDone = { key: string; text: string; ref: string | null; at: string };
/** `detail` explains the line on hover ("Debits equal credits"). */
export type TodoCheck = { key: string; label: string; value: string; state: "ok" | "open" | "late"; to: string | null; detail?: string };

export type FinanceTodo = {
  today: string;
  mine: TodoJob[];
  others: TodoJob[];
  done: TodoDone[];
  checklist: { month: string; daysLeft: number; items: TodoCheck[] };
  /** Reads that failed, by what they were for — said on the page, never shown as zero. */
  problems: string[];
};

export const FINANCE_TODO_KEY = ["finance-todo"] as const;
export const FINANCE_TODO_PATH = "/accounting/todo";

export function useFinanceTodo() {
  return useQuery({
    queryKey: FINANCE_TODO_KEY,
    queryFn: () => authedFetch<FinanceTodo>(FINANCE_TODO_PATH),
    staleTime: 30_000,
    refetchInterval: 120_000,
    refetchOnWindowFocus: true,
    retry: retryUnlessClientError,
  });
}

/* ── To do rules ───────────────────────────────────────────────────────── */

export type TodoSettings = { rulesOff: string[]; mayEdit: boolean };
const SETTINGS_KEY = ["finance-todo-settings"] as const;
const SETTINGS_PATH = "/accounting/todo/settings";

export function useTodoSettings() {
  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => authedFetch<TodoSettings>(SETTINGS_PATH),
    retry: retryUnlessClientError,
  });
}

export function useSaveRulesOff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rulesOff: string[]) => authedFetch<{ rulesOff: string[] }>(SETTINGS_PATH, { method: "PUT", body: JSON.stringify({ rulesOff }) }),
    onSuccess: (r) => {
      qc.setQueryData<TodoSettings>(SETTINGS_KEY, (old) => (old ? { ...old, rulesOff: r.rulesOff } : old));
      void qc.invalidateQueries({ queryKey: FINANCE_TODO_KEY });
      void qc.invalidateQueries({ queryKey: FINANCE_TODO_COUNT_KEY });
    },
  });
}
