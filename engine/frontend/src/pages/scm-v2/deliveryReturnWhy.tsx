/* The Delivery Returns list's Why and What happens columns (owner, 6 Nov 2026). Why is the return's reason. What happens
   is read from the status, the one record of it: a return books its goods back into stock on create, so an open one
   reads Back to stock. Replace is on the design but nothing records it, so it is never shown. */

import type { Column } from "../../components/DataTable";

export const drWhatHappens = (status: string | null | undefined): string => {
  switch ((status ?? "").toUpperCase()) {
    case "PENDING":
    case "RECEIVED":
    case "INSPECTED":
      return "Back to stock";
    case "REFUNDED":
      return "Refund";
    case "CREDIT_NOTED":
      return "Credit note";
    case "REJECTED":
      return "Rejected";
    default:
      return "—";
  }
};

/** Puts Why and What happens straight after Status. */
export function withDrWhy<R extends { reason: string | null; status: string }, L>(columns: Column<R, L>[]): Column<R, L>[] {
  const added: Column<R, L>[] = [
    {
      key: "why", label: "Why", width: "180px",
      getValue: (r) => r.reason ?? "",
      render: (r) => <span className="block min-w-0 truncate text-[12.5px] text-ink-secondary">{r.reason || "—"}</span>,
    },
    {
      key: "what_happens", label: "What happens", width: "130px",
      getValue: (r) => drWhatHappens(r.status),
      render: (r) => <span className="text-[12.5px] text-ink-secondary">{drWhatHappens(r.status)}</span>,
    },
  ];
  const at = columns.findIndex((c) => c.key === "status");
  return at < 0 ? [...columns, ...added] : [...columns.slice(0, at + 1), ...added, ...columns.slice(at + 1)];
}
