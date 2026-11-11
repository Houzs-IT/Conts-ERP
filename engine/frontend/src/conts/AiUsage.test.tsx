import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { AiUsageReport } from "./AiUsage";

// AI usage (TODO item 19, Houzs AiUsage.tsx): this month's cost, calls and read rate; each month with calls as a table
// per feature; the latest failed calls named. The report itself is pinned in backend services/aiUsage.test.ts.
const feature = (over: Record<string, unknown>) => ({
  feature: "bill_extract", label: "Scan bills (payment vouchers, AP invoices)", calls: 0, failures: 0, readRatePct: null, rm: 0,
  inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, ...over,
});
const REPORT: AiUsageReport = {
  usdToRm: 4.7, firstRecordedAt: "2026-10-20T02:00:00.000Z",
  months: [
    { month: "2026-10", totalRm: 1.5, calls: 10, failures: 0, readRatePct: 100, partial: true, note: "Recording started on 2026-10-20; earlier calls this month are not counted.",
      features: [feature({ calls: 10, readRatePct: 100, rm: 1.5, inputTokens: 12000, outputTokens: 900 })] },
    { month: "2026-11", totalRm: 3.27, calls: 20, failures: 3, readRatePct: 85, partial: false, note: null,
      features: [
        feature({ calls: 16, failures: 3, readRatePct: 81.3, rm: 3.0, inputTokens: 20000, outputTokens: 1500 }),
        feature({ feature: "utility_bill_read", label: "Utility bills", calls: 4, readRatePct: 100, rm: 0.27, inputTokens: 3000, outputTokens: 200 }),
      ] },
  ],
  recentFailures: [{ at: "2026-11-09T02:00:00.000Z", feature: "bill_extract", label: "Scan bills (payment vouchers, AP invoices)", error: "overloaded_error: Overloaded", httpStatus: 529 }],
};
const fetchMock = vi.fn(async (_url: string) => REPORT);
vi.mock("../vendor/scm/lib/authed-fetch", () => ({ authedFetch: (url: string) => fetchMock(url) }));

import { AiUsage, monthLabel, rateText } from "./AiUsage";

const draw = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><AiUsage /></MemoryRouter>
  </QueryClientProvider>,
);

describe("AI usage", () => {
  it("names months and read rates", () => {
    expect(monthLabel("2026-11")).toBe("Nov 2026");
    expect(rateText(null)).toBe("–");
    expect(rateText(81.25)).toBe("81.3%");
  });

  it("shows this month first, a table per month with calls, and the latest failures", async () => {
    fetchMock.mockClear();
    draw();
    const nov = await screen.findByRole("table", { name: "AI usage Nov 2026" });
    expect(fetchMock).toHaveBeenCalledWith("/accounting/ai-usage?months=6");
    expect(screen.getByText("Nov 2026 · RM 3.27 · 20 calls · read rate 85.0%")).toBeTruthy();
    expect(screen.getByText("3 failed")).toBeTruthy();
    const scan = within(nov).getByText("Scan bills (payment vouchers, AP invoices)").closest("tr")!;
    expect(within(scan).getByText("81.3%")).toBeTruthy();
    expect(within(scan).getByText("3.00")).toBeTruthy();
    expect(within(nov).getByText("Utility bills")).toBeTruthy();
    /* The first recorded month says recording started part way through. */
    expect(screen.getByText(/Recording started on 2026-10-20/)).toBeTruthy();
    const failed = screen.getByRole("table", { name: "Latest failed calls" });
    expect(within(failed).getByText("529 · overloaded_error: Overloaded")).toBeTruthy();
    /* Newest month first. */
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent ?? "");
    expect(headings.findIndex((h) => h.startsWith("Nov 2026"))).toBeLessThan(headings.findIndex((h) => h.startsWith("Oct 2026")));
  });

  it("asks for more months when the person picks them", async () => {
    fetchMock.mockClear();
    draw();
    await screen.findByRole("table", { name: "AI usage Nov 2026" });
    fireEvent.change(screen.getByLabelText("Months"), { target: { value: "12" } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/accounting/ai-usage?months=12"));
  });
});
