// Conts only (not part of Houzs's code): one customer's or supplier's ledger (finance phase 1.5; backend
// conts/party-ledger.ts, GET /accounting/party-ledger).
import { useQuery } from "@tanstack/react-query";
import { authedFetch } from "../vendor/scm/lib/authed-fetch";

export type PartyKind = "debtor" | "creditor";
export type PartyLedgerLine = {
  date: string; jeNo: string; sourceType: string; doc: string | null; description: string | null; account: string;
  debitSen: number; creditSen: number; balanceSen: number;
};
export type PartyLedger = {
  party: { code: string; name: string; control_account: string | null };
  from: string; to: string; openingSen: number; lines: PartyLedgerLine[]; debitSen: number; creditSen: number; closingSen: number;
};

export const usePartyLedger = (p: { kind: PartyKind; code: string; from: string; to: string }) => useQuery({
  queryKey: ["conts-party-ledger", p.kind, p.code, p.from, p.to],
  queryFn: () => authedFetch<PartyLedger>(`/accounting/party-ledger?${new URLSearchParams(p).toString()}`),
  enabled: Boolean(p.code && p.from && p.to),
  staleTime: 30_000,
});
