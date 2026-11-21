// To do rules (Conts; ported from Houzs FinanceTodoRules.test.tsx, the switches only): switching a rule off sends the
// whole list of rules that are off; without Ledger full the switches are read only.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../vendor/scm/lib/authed-fetch", () => ({ authedFetch: vi.fn() }));

import { authedFetch } from "../vendor/scm/lib/authed-fetch";
import { FinanceTodoRulesPage, RULES } from "./FinanceTodoRules";

const mockedFetch = vi.mocked(authedFetch);

const renderPage = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><FinanceTodoRulesPage /></MemoryRouter>
  </QueryClientProvider>,
);

const bodyOf = (path: string) => {
  /* The write, not the read of the same path. */
  const call = mockedFetch.mock.calls.find(([p, init]) => p === path && init?.body !== undefined);
  return call ? JSON.parse(String(call[1]?.body)) as unknown : undefined;
};

beforeEach(() => { mockedFetch.mockReset(); });

describe("FinanceTodoRulesPage", () => {
  test("lists every rule; switching one sends the rules that are off", async () => {
    mockedFetch.mockImplementation(async (_p: string, init?: RequestInit) => (init?.method === "PUT" ? { rulesOff: ["einvoice", "ap-due"] } : { rulesOff: ["einvoice"], mayEdit: true }));
    renderPage();
    const rules = await screen.findByLabelText("Built-in rules");
    expect(within(rules).getAllByRole("switch")).toHaveLength(RULES.length);
    expect(within(rules).getByRole("switch", { name: "E-invoices to fix on" }).getAttribute("aria-checked")).toBe("false");
    fireEvent.click(within(rules).getByRole("switch", { name: "Supplier bills due soon on" }));
    await waitFor(() => expect(bodyOf("/accounting/todo/settings")).toEqual({ rulesOff: ["einvoice", "ap-due"] }));
  });

  test("without Ledger full the switches cannot be moved", async () => {
    mockedFetch.mockResolvedValue({ rulesOff: [], mayEdit: false });
    renderPage();
    const rules = await screen.findByLabelText("Built-in rules");
    expect((within(rules).getByRole("switch", { name: "Payment requests on" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(rules).getByText(/Only Ledger full can switch them/)).toBeTruthy();
  });
});
