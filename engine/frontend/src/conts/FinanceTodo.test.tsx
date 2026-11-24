// Finance's To do page (Conts; ported from Houzs FinanceTodo.test.tsx): it draws what the server raised — the jobs
// in their groups with how long they waited, who the others wait for, what was done today, the month's checklist —
// and says when part of it could not be read. authed-fetch is mocked at the module seam; the rules themselves are
// pinned in backend conts/finance-todo.test.ts.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../vendor/scm/lib/authed-fetch", () => ({ authedFetch: vi.fn() }));

import { authedFetch } from "../vendor/scm/lib/authed-fetch";
import { FinanceTodoPage, ageTag } from "./FinanceTodo";
import type { FinanceTodo, TodoJob } from "./financeTodoQueries";

const mockedFetch = vi.mocked(authedFetch);

const job = (over: Partial<TodoJob>): TodoJob => ({
  key: "k", rule: "requests", group: "pay", tone: "out", icon: "send", title: "T", detail: "D",
  amountSen: null, since: "2026-11-02", action: { label: "Open", to: "/x", primary: false }, who: null, ...over,
});

const PAGE: FinanceTodo = {
  today: "2026-11-02",
  mine: [
    job({ key: "bank-decide:310", rule: "bank-decide", group: "bank", tone: "bank", icon: "landmark", title: "Match 4 Hong Leong lines", since: "2026-10-28", amountSen: 1_234_500, action: { label: "Match", to: "/scm/bank-recon", primary: false } }),
    job({ key: "requests", title: "Pay 2 payment requests", since: "2026-11-02", amountSen: 50_000, action: { label: "Review", to: "/scm/payment-requests", primary: true } }),
    job({ key: "ap-due", rule: "ap-due", icon: "file-text", title: "Pay 1 supplier bill due within 7 days", since: null, action: { label: "Open", to: "/scm/ap-invoices", primary: false } }),
    job({ key: "receipts", rule: "receipts", group: "in", tone: "money", icon: "receipt", title: "Confirm 1 customer payment received", since: "2026-11-01", action: { label: "Confirm", to: "/scm/official-receipts?status=DRAFT", primary: true } }),
  ],
  others: [job({ key: "pv-approve", rule: "pv-approve", icon: "wallet", title: "Approve 1 payment voucher", who: "Approver" })],
  done: [{ key: "d1", text: "Checked LIM", ref: "PV-2611-0001", at: "09:05" }],
  checklist: { month: "2026-11", daysLeft: 28, items: [{ key: "bank-open", label: "Bank lines open", value: "4", state: "open", to: "/scm/bank-recon" }] },
  problems: [],
};

const renderPage = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><FinanceTodoPage /></MemoryRouter>
  </QueryClientProvider>,
);

beforeEach(() => { mockedFetch.mockReset(); });

describe("the waiting tag", () => {
  test("new today, then a calm day, a warning day, and late with a dot from the third", () => {
    expect(ageTag("2026-11-02", "2026-11-02")).toEqual({ text: "New", tone: "info", dot: false });
    expect(ageTag("2026-11-01", "2026-11-02")).toMatchObject({ text: "Waiting 1 day", tone: "calm" });
    expect(ageTag("2026-10-31", "2026-11-02")).toMatchObject({ text: "Waiting 2 days", tone: "warn" });
    expect(ageTag("2026-10-28", "2026-11-02")).toEqual({ text: "Waiting 5 days", tone: "late", dot: true });
    expect(ageTag(null, "2026-11-02")).toBeNull();
  });
});

describe("FinanceTodoPage", () => {
  test("reads GET /accounting/todo and draws each group, oldest first, each job linking to its screen", async () => {
    mockedFetch.mockResolvedValueOnce(PAGE);
    renderPage();
    const pay = await screen.findByLabelText("Payments");
    expect(mockedFetch).toHaveBeenCalledWith("/accounting/todo");
    expect(within(pay).getAllByText(/^Pay /).map((n) => n.textContent)).toEqual(["Pay 2 payment requests", "Pay 1 supplier bill due within 7 days"]);
    expect(within(pay).getByText("New")).toBeTruthy();
    expect(within(pay).getByRole("link", { name: /Review/ }).getAttribute("href")).toBe("/scm/payment-requests");
    const bank = screen.getByLabelText("Bank statements");
    expect(within(bank).getByText("Waiting 5 days")).toBeTruthy();
    const moneyIn = screen.getByLabelText("Money in & e-invoice");
    expect(within(moneyIn).getByRole("link", { name: /Confirm/ }).getAttribute("href")).toBe("/scm/official-receipts?status=DRAFT");
    expect(screen.getByText("· 2 from earlier days")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Rules/ }).getAttribute("href")).toBe("/scm/finance/rules");
    expect(screen.getByRole("link", { name: /All screens/ }).getAttribute("href")).toBe("/scm/finance/menu");
  });

  test("others show who they wait for; done today keeps its voucher number; the checklist counts the month", async () => {
    mockedFetch.mockResolvedValueOnce(PAGE);
    renderPage();
    const others = await screen.findByLabelText("Waiting on others");
    expect(within(others).getByText("Approver")).toBeTruthy();
    const done = screen.getByLabelText("Done today");
    expect(within(done).getByText("PV-2611-0001")).toBeTruthy();
    expect(screen.getByText("1 of 5 done today")).toBeTruthy();
    const check = screen.getByLabelText("Month checklist");
    expect(within(check).getByText("November checklist")).toBeTruthy();
    expect(within(check).getByText("28 days left")).toBeTruthy();
    expect(within(check).getByRole("link", { name: /Bank lines open/ }).getAttribute("href")).toBe("/scm/bank-recon");
  });

  test("a section that could not be read is said, and nothing waiting is said plainly", async () => {
    mockedFetch.mockResolvedValueOnce({ ...PAGE, mine: [], others: [], problems: ["bank lines (timeout)"] });
    renderPage();
    expect(await screen.findByText(/Some of it could not be read, so it is not listed: bank lines \(timeout\)/)).toBeTruthy();
    expect(screen.getByText("Nothing is waiting on you.")).toBeTruthy();
  });
});
