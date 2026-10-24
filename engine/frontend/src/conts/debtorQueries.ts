// Conts only (not part of Houzs's code): Debtors — finance's customers under their controls (finance phase 1.5;
// backend conts/debtors-routes.ts, GET/POST/PATCH /accounting/debtors).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authedFetch } from "../vendor/scm/lib/authed-fetch";

export type Debtor = {
  id: string; code: string; name: string; control_account: string; customer_id: string | null;
  phone: string | null; email: string | null; address: string | null; notes: string | null; is_active: boolean;
};
export type DebtorControl = { code: string; name: string; debtors: Debtor[] };
export type DebtorInput = {
  name?: string; code?: string; controlAccount?: string; phone?: string; email?: string; address?: string; notes?: string;
  isActive?: boolean;
};

const KEY = ["conts-debtors"];

export const useDebtors = () => useQuery({
  queryKey: KEY,
  queryFn: () => authedFetch<{ controls: DebtorControl[] }>("/accounting/debtors"),
  staleTime: 30_000,
});

export const useSaveDebtor = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string | null; body: DebtorInput }) => (id
      ? authedFetch<{ debtor: Debtor }>(`/accounting/debtors/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) })
      : authedFetch<{ debtor: Debtor }>("/accounting/debtors", { method: "POST", body: JSON.stringify(body) })),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: KEY }); },
  });
};

/** The server's refusal body, when a save was refused with one (authedFetch keeps it on the error). */
export function refusalOf(err: unknown): { status?: number; error?: string; message?: string } {
  const e = err as Error & { status?: number; body?: string };
  try {
    const body = e.body ? (JSON.parse(e.body) as { error?: string; message?: string }) : {};
    return { status: e.status, ...body };
  } catch {
    return { status: e.status, message: e.message };
  }
}
