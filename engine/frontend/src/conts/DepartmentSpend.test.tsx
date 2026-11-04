import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

// Spending by department (SOP 1.1; chew 4 Nov 2026): each department's cost against the period before, then each
// department's sub-departments adding up to it, then a team's costs with no unit.
const SPEND = {
  from: "2026-11-01", to: "2026-11-30", previous: { from: "2026-10-02", to: "2026-10-31" },
  departments: [
    { department: "rental", label: "Rental", incomeSen: 90000, costSen: 10000, previousCostSen: 8000, rows: [
      { subDepartmentId: "s-gen", name: "Rental (general)", active: true, incomeSen: 90000, costSen: 2000, previousCostSen: 7000 },
      { subDepartmentId: "s-cln", name: "Cleaning", active: true, incomeSen: 0, costSen: 5000, previousCostSen: 1000 },
      { subDepartmentId: "s-mnt", name: "Maintenance", active: true, incomeSen: 0, costSen: 3000, previousCostSen: 0 },
    ] },
    { department: "supply", label: "Renovation", incomeSen: 0, costSen: 7000, previousCostSen: 14000, rows: [
      { subDepartmentId: "s-dc", name: "Renovation (Dream Crafter)", active: true, incomeSen: 0, costSen: 0, previousCostSen: 14000 },
      { subDepartmentId: "s-tc", name: "In-house Reno (The Conts)", active: true, incomeSen: 0, costSen: 7000, previousCostSen: 0 },
    ] },
    { department: "shared", label: "Company", incomeSen: 0, costSen: 0, previousCostSen: 0, rows: [
      { subDepartmentId: "s-co", name: "Company", active: true, incomeSen: 0, costSen: 0, previousCostSen: 0 },
    ] },
  ],
  totals: { incomeSen: 90000, costSen: 17000, previousCostSen: 22000 },
};
const NO_UNIT = { from: "2026-11-01", to: "2026-11-30", rows: [
  { jeNo: "JE-2", date: "2026-11-04", source: "PV PV-2", subDepartment: "Maintenance", accountCode: "905-0000", accountName: "Repairs", amountSen: 3000, notes: null },
] };
vi.mock("../vendor/scm/lib/authed-fetch", () => ({
  authedFetch: vi.fn(async (url: string) => (url.startsWith("/accounting/no-unit-costs") ? NO_UNIT : SPEND)),
}));

import { costChange, DepartmentSpend } from "./DepartmentSpend";

const draw = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><DepartmentSpend /></MemoryRouter>
  </QueryClientProvider>,
);

describe("spending by department", () => {
  it("a cost's change against the period before: up is bad, down is good, none when there was nothing", () => {
    expect(costChange(10000, 8000)).toEqual({ text: "▲ 25.0% vs previous period", tone: "error" });
    expect(costChange(7000, 14000)).toEqual({ text: "▼ 50.0% vs previous period", tone: "success" });
    expect(costChange(3000, 0)).toEqual({ text: "New this period", tone: "default" });
    expect(costChange(0, 0)).toEqual({ text: "No cost either period", tone: "default" });
  });

  it("shows each department's cost, its sub-departments adding up to it, and the bold total", async () => {
    draw();
    const table = await screen.findByRole("table", { name: "Spending by sub-department" });
    const rental = screen.getByRole("group", { name: "Rental cost" });
    expect(within(rental).getByText("100.00")).toBeTruthy();
    expect(within(rental).getByText("▲ 25.0% vs previous period")).toBeTruthy();
    expect(within(table).getByText("Cleaning")).toBeTruthy();
    expect(within(table).getByText("In-house Reno (The Conts)")).toBeTruthy();
    const total = within(table).getByText("Total").closest("tr")!;
    expect(total.textContent).toContain("170.00");
  });

  it("lists a team's costs with no unit", async () => {
    draw();
    const list = await screen.findByRole("table", { name: "Team costs with no unit" });
    expect(within(list).getByText("JE-2")).toBeTruthy();
    expect(within(list).getByText("Maintenance")).toBeTruthy();
    expect(within(list).getByText("30.00")).toBeTruthy();
  });
});
