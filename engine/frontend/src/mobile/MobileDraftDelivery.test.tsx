/* The phone's Draft delivery: cards by day, the job's real PO, and Mark complete only with its proof. */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ posts: [] as Array<[string, unknown]> }));
vi.mock("../vendor/scm/lib/authed-fetch", () => ({
  authedFetch: async (path: string, init?: { body?: string }) => {
    if (init?.body) { h.posts.push([path, JSON.parse(init.body)]); return { ok: true }; }
    return { jobs: [JOB, { ...JOB, id: "d2", doNumber: "TC-DO-2", due: "2099-01-01", place: "CURVO 1234" }] };
  },
}));
vi.mock("../vendor/scm/lib/slip", () => ({ uploadSlipFull: async () => ({ r2Key: "pod/1.jpg" }) }));
vi.mock("../vendor/scm/components/NotifyDialog", () => ({ useNotify: () => vi.fn() }));
vi.mock("../hooks/useToast", () => ({ useToast: () => ({ success: vi.fn() }) }));

import { MobileDraftDelivery } from "./MobileDraftDelivery";
import { jobsFor, todayKl, weekEnd, type DraftJob } from "./renovationDraftDeliveryModel";

const JOB: DraftJob = { id: "d1", doNumber: "TC-DO-1", due: todayKl(), time: "10:30", place: "KL 48 B-35-13A", projectCode: "RN-1", soDocNo: "TC-SO-1",
  items: [{ code: "A", description: "Board", qty: 2, uom: "PCS" }], pos: [{ poNumber: "TC-PO-1", supplier: "Kim Hup" }] };
const wrap = () => render(<QueryClientProvider client={new QueryClient()}><MobileDraftDelivery onBack={vi.fn()} /></QueryClientProvider>);

describe("day filters", () => {
  const job = (due: string) => ({ ...JOB, id: due, due });
  it("Today holds late drafts, Tomorrow one day, This week to Sunday", () => {
    const today = "2026-11-04"; // a Wednesday
    const jobs = [job("2026-11-02"), job("2026-11-04"), job("2026-11-05"), job("2026-11-08"), job("2026-11-09")];
    expect(jobsFor(jobs, "today", today).map((j) => j.id)).toEqual(["2026-11-02", "2026-11-04"]);
    expect(jobsFor(jobs, "tomorrow", today).map((j) => j.id)).toEqual(["2026-11-05"]);
    expect(jobsFor(jobs, "week", today)).toHaveLength(4);
    expect(weekEnd("2026-11-08")).toBe("2026-11-08");
  });
});

describe("Draft delivery", () => {
  it("lists today's job, and opens it with the linked PO and supplier", async () => {
    wrap();
    expect(await screen.findByRole("heading", { name: "Draft delivery" })).toBeTruthy();
    expect(screen.queryByText("CURVO 1234")).toBeNull();
    fireEvent.click(await screen.findByText("KL 48 B-35-13A"));
    expect(await screen.findByText("TC-PO-1")).toBeTruthy();
    expect(screen.getByText("Kim Hup")).toBeTruthy();
  });
  it("Mark complete waits for a photo and a name, then sends both", async () => {
    h.posts.length = 0;
    wrap();
    fireEvent.click(await screen.findByText("KL 48 B-35-13A"));
    const mark = await screen.findByRole("button", { name: "Mark complete" }) as HTMLButtonElement;
    expect(mark.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Take photo"), { target: { files: [new File(["x"], "a.jpg", { type: "image/jpeg" })] } });
    await screen.findByText("POD photos · 1");
    expect(mark.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Received by"), { target: { value: "Ali" } });
    await waitFor(() => expect(mark.disabled).toBe(false));
    fireEvent.click(mark);
    await waitFor(() => expect(h.posts).toEqual([["/production-orders/draft-deliveries/d1/complete", { podKeys: ["pod/1.jpg"], receivedBy: "Ali" }]]));
  });
});
