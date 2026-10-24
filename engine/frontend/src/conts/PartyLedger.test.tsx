import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// One customer's ledger (finance phase 1.5; SOP 2.1): the balance brought forward, the period's lines with a running
// balance and what is owed at the end. A customer in credit is marked.
let ledger: Record<string, unknown> | undefined;
vi.mock("./partyLedgerQueries", () => ({ usePartyLedger: () => ({ isLoading: false, isError: false, data: ledger }) }));
vi.mock("./debtorQueries", () => ({ useDebtors: () => ({ data: { controls: [{ code: "301-0000", name: "RENOVATION CUSTOMER", debtors: [{ code: "301-M001", name: "MS LEE" }] }] } }) }));
vi.mock("../vendor/scm/lib/suppliers-queries", () => ({ useSuppliers: () => ({ data: [] }) }));
vi.mock("../components/Layout", () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock("../components/DataTable", () => ({
  DataTable: ({ rows }: { rows: Array<{ key: string; jeNo: string; balanceSen: number }> | null }) => (
    <ul>{(rows ?? []).map((r) => <li key={r.key}>{r.jeNo} · {r.balanceSen}</li>)}</ul>
  ),
}));

import { PartyLedger } from "./PartyLedger";

const at = (path: string) => render(<MemoryRouter initialEntries={[path]}><PartyLedger /></MemoryRouter>);

describe("Customer ledger", () => {
  it("shows the balance brought forward, the running balance and what is owed at the end", () => {
    ledger = {
      party: { code: "301-M001", name: "MS LEE", control_account: "301-0000" }, from: "2026-11-01", to: "2026-11-30",
      openingSen: -100_000, debitSen: 3_000_000, creditSen: 900_000, closingSen: 2_000_000,
      lines: [
        { date: "2026-11-03", jeNo: "JE-2", sourceType: "CONTRACT", doc: "HC-SO-2611-001", description: "Contract", account: "301-0000", debitSen: 3_000_000, creditSen: 0, balanceSen: 2_900_000 },
        { date: "2026-11-12", jeNo: "JE-3", sourceType: "SIPAY", doc: "OR-1", description: "Payment", account: "301-0000", debitSen: 0, creditSen: 900_000, balanceSen: 2_000_000 },
      ],
    };
    at("/scm/party-ledger?kind=debtor&code=301-M001&from=2026-11-01&to=2026-11-30");
    expect(screen.getByText("Customer ledger")).toBeTruthy();
    expect(screen.getByText("RM -1,000.00")).toBeTruthy();
    expect(screen.getByText("RM 20,000.00")).toBeTruthy();
    expect(screen.getByText("JE-3 · 2000000")).toBeTruthy();
  });

  it("a customer in credit is marked", () => {
    ledger = { party: { code: "301-M001", name: "MS LEE", control_account: "301-0000" }, from: "2026-11-01", to: "2026-11-30", openingSen: 0, debitSen: 0, creditSen: 50_000, closingSen: -50_000, lines: [] };
    at("/scm/party-ledger?kind=debtor&code=301-M001&from=2026-11-01&to=2026-11-30");
    expect(screen.getByText("In credit: paid more than owed")).toBeTruthy();
  });

  it("asks for a customer before showing anything", () => {
    ledger = undefined;
    at("/scm/party-ledger?kind=debtor");
    expect(screen.getByText("Pick a customer to see their ledger.")).toBeTruthy();
  });
});
