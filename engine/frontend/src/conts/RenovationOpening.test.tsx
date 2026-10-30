// The "Renovation contracts at go-live" block of the Ledger setup page (plan 2026-10-30-renovation-revenue-ledger.md
// Task 8): upload → the server's preview with each row's problems → Apply, only when no row has one.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const ROWS = [
  { soDocNo: "2990-SO-2609-001", debtorCode: "301-C005", advanceAccountCode: "480-D007", billedBeforeGoLiveSen: 3_000_000 },
  { soDocNo: "2990-SO-2609-002", debtorCode: "300-C001", advanceAccountCode: "480-D008", billedBeforeGoLiveSen: 0 },
];
const previewAsync = vi.fn();
const applyAsync = vi.fn(async (_rows: unknown) => ({ ok: true, applied: 1 }));
const confirmFn = vi.fn(async () => true);
vi.mock("./opening", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./opening")>()),
  readWorkbookGrid: async () => [
    ["SO doc no", "Customer account", "Advance account", "Invoiced before go-live (RM)"],
    ...ROWS.map((r) => [r.soDocNo, r.debtorCode, r.advanceAccountCode, r.billedBeforeGoLiveSen / 100]),
  ],
}));
vi.mock("./renoOpening", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./renoOpening")>()),
  useRenoOpeningPreview: () => ({ mutateAsync: previewAsync, isPending: false }),
  useRenoOpeningApply: () => ({ mutateAsync: applyAsync, isPending: false }),
}));
vi.mock("../vendor/scm/components/ConfirmDialog", () => ({ useConfirm: () => confirmFn }));

import { RenovationOpening } from "./RenovationOpening";

const upload = () => fireEvent.change(screen.getByLabelText("Renovation contracts at go-live file"), {
  target: { files: [new File(["x"], "contracts.xlsx")] },
});

describe("Renovation contracts at go-live", () => {
  it("shows each row's problems from the server and holds Apply while any row has one", async () => {
    previewAsync.mockResolvedValueOnce({ ok: true, rows: [
      { ...ROWS[0], problems: [], contractSen: 10_000_000, current: null },
      { ...ROWS[1], problems: ["Customer 300-C001 is under 300-0000, not 301, 302 or 303 (renovation customers)."], contractSen: 2_000_000, current: null },
    ] });
    render(<RenovationOpening canSave ledgerStartDate="2026-11-01" />);
    upload();
    await waitFor(() => expect(screen.getByText(/300-C001 is under 300-0000/)).toBeTruthy());
    expect(previewAsync).toHaveBeenCalledWith(ROWS);
    expect(screen.getByText("30,000.00")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("a clean preview applies after a confirm, and says how many contracts were seeded", async () => {
    previewAsync.mockResolvedValueOnce({ ok: true, rows: [{ ...ROWS[0], problems: [], contractSen: 10_000_000, current: null }] });
    render(<RenovationOpening canSave ledgerStartDate="2026-11-01" />);
    upload();
    const apply = await screen.findByRole("button", { name: "Apply" });
    await waitFor(() => expect((apply as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(apply);
    await waitFor(() => expect(applyAsync).toHaveBeenCalledWith(ROWS));
    expect(confirmFn).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText(/1 contract seeded/)).toBeTruthy());
  });

  it("an Apply refused for problems found meanwhile shows them in the table", async () => {
    previewAsync.mockResolvedValueOnce({ ok: true, rows: [{ ...ROWS[0], problems: [], contractSen: 10_000_000, current: null }, { ...ROWS[1], problems: [], contractSen: 2_000_000, current: null }] });
    applyAsync.mockRejectedValueOnce(Object.assign(new Error("Some rows have problems: nothing was applied."), {
      status: 409,
      body: JSON.stringify({ error: "Some rows have problems: nothing was applied.", rows: [
        { ...ROWS[0], problems: [], contractSen: 10_000_000, current: null },
        { ...ROWS[1], problems: ["2990-SO-2609-002 has already posted to 480-D009: changing its advance account would double the advance."], contractSen: 2_000_000, current: null },
      ] }),
    }));
    render(<RenovationOpening canSave ledgerStartDate="2026-11-01" />);
    upload();
    const apply = await screen.findByRole("button", { name: "Apply" });
    await waitFor(() => expect((apply as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(apply);
    await waitFor(() => expect(screen.getByText(/has already posted to 480-D009/)).toBeTruthy());
    expect(screen.getByText(/nothing was applied/i)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("uses the theme's tokens, never a hard-coded colour", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, resolve } = await import("node:path");
    const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "RenovationOpening.tsx"), "utf8");
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,6}\b|rgba?\(/);
  });

  it("waits for the start of the books", () => {
    render(<RenovationOpening canSave ledgerStartDate={null} />);
    expect(screen.getByText(/Set the day the books start first/)).toBeTruthy();
  });
});
