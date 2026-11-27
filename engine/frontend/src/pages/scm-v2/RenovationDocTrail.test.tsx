import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { TrailStep } from "./renovationDocTrailModel";

const STEPS: TrailStep[] = [
  { kind: "so", id: "TC-SO-1", no: "TC-SO-1", word: "Confirmed", tone: "done", date: "2026-06-10", who: null },
  { kind: "po", id: "a", no: "TC-PO-81", word: "Arrives", tone: "active", date: "2020-11-25", who: null },
  { kind: "po", id: "b", no: "TC-PO-93", word: "Arrives", tone: "active", date: null, who: null },
  { kind: "po", id: "c", no: "TC-PO-99", word: "Arrives", tone: "active", date: null, who: null },
];
vi.mock("../../vendor/scm/lib/authed-fetch", () => ({ authedFetch: async () => ({ steps: STEPS }) }));
const { RenovationDocTrail } = await import("./RenovationDocTrail");

describe("RenovationDocTrail", () => {
  it("folds three POs into one stage that opens into each order", async () => {
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><RenovationDocTrail kind="so" id="TC-SO-1" /></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByText("PO (3)")).toBeTruthy();
    expect(screen.getByText("Next ETA 25/11/2020 · 2 pending ETA").className).toContain("text-err");
    expect(screen.queryByText("TC-PO-81")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /3 orders/ }));
    expect(screen.getByText("TC-PO-93")).toBeTruthy();
    expect(screen.getAllByText("ETA pending")).toHaveLength(2);
    expect(screen.getAllByText("Not yet")).toHaveLength(3);
  });
});
