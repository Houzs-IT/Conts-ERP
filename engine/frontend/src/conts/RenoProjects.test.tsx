import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Renovation projects (SOP 4.2.3; plan 2026-10-31 Task 7). Pinned: the KPI row sums the rows; alerts show as words;
// a new as-at date asks again; money sits right-aligned in RM.
const asked: string[] = [];
const ROW = {
  soDocNo: "SO-1", projectId: 7, projectName: "SKYLINE D-25-13", customerCode: "301-M002", customerName: "MS LEE", salesperson: "ALEX",
  brand: "The Conts", kind: "RENOVATION", status: "RENO_IN_PROGRESS", stage: "CARPENTRY", handoverDate: "2026-11-25", delayed: true,
  contractSen: 10_000_000, voSen: 1_000_000, revisedContractSen: 11_000_000, receivedSen: 2_000_000, outstandingSen: 9_000_000, collectedBp: 1818,
  nextInstalment: { seq: 3, label: "Handover", amountSen: 6_000_000, trigger: "manual" },
  gapsByInvoiceDays: [10, null, null], gapsByPaymentDays: [null, null, null],
  invoicedSen: 5_000_000, advanceLeftSen: 6_000_000, completionBp: 7817, earnedSen: 8_598_592, differenceSen: -3_598_592,
  expectedCostSen: 7_100_000, costSpentSen: 5_550_000, orderedNotBilledSen: 1_000_000, remainingCostSen: 1_550_000, owedToSuppliersSen: 1_900_000,
  overBudget: false, lossExpected: false, goliveCostMissing: false, expectedGpBp: 3545, gpToDateBp: -1100, workAheadOfMoney: true,
};
const OTHER = { ...ROW, soDocNo: "SO-2", projectId: 8, projectName: "TROFI A-3-1", revisedContractSen: 5_000_000, invoicedSen: 1_000_000, earnedSen: 1_000_000,
  overBudget: true, delayed: false, workAheadOfMoney: false };

vi.mock("./renoProjectsQueries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./renoProjectsQueries")>()),
  useRenoProjects: (asOf: string) => { asked.push(asOf); return { isLoading: false, isError: false, data: { asOf, rows: [ROW, OTHER] } }; },
}));
vi.mock("./projectLimitQueries", () => ({ useProjectLimit: () => ({ isLoading: false, data: { leftSen: 50_000 } }) }));
vi.mock("../components/Layout", () => ({ PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => <header><h1>{title}</h1>{actions}</header> }));
vi.mock("../vendor/scm/components/DateField", () => ({
  DateField: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => <input aria-label="As at" value={value} onChange={(e) => onChange(e.target.value)} />,
}));
vi.mock("../components/DataTable", () => ({
  DataTable: ({ rows, columns }: { rows: Array<Record<string, unknown>> | null; columns: Array<{ key: string; align?: string; defaultHidden?: boolean; render: (r: unknown) => React.ReactNode }> }) => (
    <table><tbody>{(rows ?? []).map((r, i) => (
      <tr key={i} data-row={String(r.soDocNo)}>{columns.filter((c) => !c.defaultHidden).map((c) => <td key={c.key} data-col={c.key} data-align={c.align ?? "left"}>{c.render(r)}</td>)}</tr>
    ))}</tbody></table>
  ),
}));

import { RenoProjects } from "./RenoProjects";
const page = () => render(<MemoryRouter><RenoProjects /></MemoryRouter>);

describe("Renovation projects", () => {
  it("KPI row sums the rows", () => {
    page();
    expect(within(screen.getByLabelText("Revised contracts (RM)")).getByText("160K")).toBeTruthy();
    expect(within(screen.getByLabelText("Invoiced — the books (RM)")).getByText("60K")).toBeTruthy();
    const earned = screen.getByLabelText("Earned by completion (RM)");
    expect(earned.textContent).toContain("▼ RM 35,985.92 of work not yet invoiced");
    expect(within(screen.getByLabelText("Projects over budget")).getByText("1")).toBeTruthy();
  });

  it("alerts show as text", () => {
    page();
    const row = document.querySelector('[data-row="SO-1"]')!;
    const alerts = row.querySelector('[data-col="alerts"]')!;
    expect(alerts.textContent).toBe("Work ahead of moneyDelayed");
    expect(document.querySelector('[data-row="SO-2"] [data-col="alerts"]')!.textContent).toBe("Over budget");
  });

  it("as-at date refetches", () => {
    asked.length = 0;
    page();
    fireEvent.change(screen.getByLabelText("As at"), { target: { value: "2026-11-30" } });
    expect(asked.at(-1)).toBe("2026-11-30");
  });

  it("money is right-aligned in RM; a negative is in brackets", () => {
    page();
    const diff = document.querySelector('[data-row="SO-1"] [data-col="differenceSen"]')!;
    expect(diff.getAttribute("data-align")).toBe("right");
    expect(diff.textContent).toBe("(35,985.92)");
    expect(document.querySelector('[data-row="SO-1"] [data-col="revisedContractSen"]')!.textContent).toBe("110,000.00");
  });
});
