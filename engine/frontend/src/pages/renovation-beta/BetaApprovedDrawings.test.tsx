/* The approved 2D set on a Built-in PO and line: nothing before approval, and sheets as they are in the set. */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ answer: {} as Record<string, unknown> }));
vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return { ...actual, api: { ...actual.api, get: async (path: string) => {
    if (path.endsWith("/design-sheets")) return { ready: true, sheets: [] };
    return h.answer;
  }, fetchBlobUrl: async () => "blob:x" } };
});

import { LineApprovedDrawings, PoApprovedDrawings, approvedSheets } from "./BetaApprovedDrawings";

const FILE = { id: 1, kind: "2d", version: 2, file_name: "Kitchen.png", r2_key: "renovation/7/k.png", external_url: null, content_type: "image/png", size_bytes: 1, submitted_on: null, uploaded_at: "2026-11-01" };
const wrap = (node: React.ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>);


// These are Dream Crafter screens: dates read day first (YH, 11 Nov 2026).

describe("approved 2D", () => {
  it("shows nothing for a PO that is not Built-in, or before approval", () => {
    expect(approvedSheets({ projectId: null }, [])).toBeNull();
    expect(approvedSheets({ projectId: 7, files: [FILE as never], approved: null }, [])).toBeNull();
  });
  it("shows the set on the PO", async () => {
    h.answer = { projectId: 7, files: [FILE], approved: { fileId: 1, version: 2, approvedOn: "2026-11-05" } };
    wrap(<PoApprovedDrawings poId="p1" />);
    expect(await screen.findByText("2D V2, approved 05/11/2026")).toBeTruthy();
    expect(await screen.findByAltText("Kitchen.png")).toBeTruthy();
  });
  it("shows the set on the line", async () => {
    h.answer = { projectId: 7, files: [FILE], approved: { fileId: 1, version: 2, approvedOn: "2026-11-05" } };
    wrap(<LineApprovedDrawings projectId={7} />);
    expect(await screen.findByRole("group", { name: "Approved 2D set V2" })).toBeTruthy();
  });
});
