import { describe, expect, it } from "vitest";
import { fiscalYearStart, MONTHS } from "./ledgerSettings";

// The fiscal year (finance phase 1, spec 3.7) — the same rule as backend/src/acc/ledger-settings.ts.
describe("fiscalYearStart", () => {
  it("is the first day of the fiscal year a date falls in", () => {
    expect(fiscalYearStart("2026-12-15", 8)).toBe("2026-09-01");
    expect(fiscalYearStart("2026-08-31", 8)).toBe("2025-09-01");
    expect(fiscalYearStart("2026-09-01", 8)).toBe("2026-09-01");
    expect(fiscalYearStart("2026-03-10", 12)).toBe("2026-01-01");
  });
  it("names the twelve months for the year-end picker", () => {
    expect(MONTHS).toHaveLength(12);
    expect(MONTHS[7]).toBe("August");
  });
});
