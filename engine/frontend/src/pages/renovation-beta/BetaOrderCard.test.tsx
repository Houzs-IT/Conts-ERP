// Project workspace > Overview > Sales order — Open SO shows the order's PDF in the in-app viewer, not the order's page
// (feedback list, 11 Nov 2026: "Open SO ... should link to the show PDF ver").
import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { BetaTabProps } from "./betaShared";

const downloadSoPdf = vi.fn(async (..._a: unknown[]) => {});
vi.mock("../scm-v2/soPdfDownload", () => ({ downloadSoPdf: (...a: unknown[]) => downloadSoPdf(...a) }));

import { OrderCard } from "./BetaOverviewTab";

const props = (so: { doc_no: string } | null, onError = vi.fn()) => ({
  projectId: 313, canWrite: true, onDone: vi.fn(), onError, openTab: vi.fn(),
  detail: { project: { id: 313 }, so: so && { ...so, status: "CONFIRMED", so_date: "2026-11-01", agent: null }, signedSo: null, lines: [] },
}) as unknown as BetaTabProps;

describe("Sales order card — Open SO", () => {
  test("opens the order's PDF in the viewer, the renovation kind read from the order", async () => {
    render(<MemoryRouter><OrderCard p={props({ doc_no: "TC-SO-2611-028" })} /></MemoryRouter>);
    expect(screen.queryByRole("link", { name: "Open SO" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open SO" }));
    await waitFor(() => expect(downloadSoPdf).toHaveBeenCalledWith("TC-SO-2611-028", null, "preview"));
  });

  test("a PDF that cannot be made says so", async () => {
    downloadSoPdf.mockRejectedValueOnce(new Error("payments read failed"));
    const onError = vi.fn();
    render(<MemoryRouter><OrderCard p={props({ doc_no: "TC-SO-2611-028" }, onError)} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Open SO" }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.stringContaining("payments read failed")));
  });

  test("no sales order, no button", () => {
    render(<MemoryRouter><OrderCard p={props(null)} /></MemoryRouter>);
    expect(screen.queryByRole("button", { name: "Open SO" })).toBeNull();
  });
});
