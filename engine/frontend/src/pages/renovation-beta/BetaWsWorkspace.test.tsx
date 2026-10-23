/* The Beta project workspace renders the mockup's words: the header, the stepper, the tab bar and the Overview cards. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ routes: {} as Record<string, unknown> }));

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  const get = async (path: string): Promise<unknown> => {
    const hit = Object.entries(h.routes).find(([k]) => path.includes(k));
    if (!hit) throw new Error(`no mock for ${path}`);
    return hit[1];
  };
  return { ...actual, api: { ...actual.api, get, fetchBlobUrl: async () => "blob:x" } };
});
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ can: () => true }) }));

import { DialogProvider } from "../../hooks/useDialog";
import { RenovationBetaWorkspace } from "./RenovationBetaWorkspace";

const day = (offset: number): string => new Date(Date.now() + 8 * 3600e3 + offset * 86_400_000).toISOString().slice(0, 10);

const task = (id: number, status: string, label: string, planned_start: string, planned_end: string, extra: Record<string, unknown> = {}): unknown => ({
  id, seq: id, status, label, planned_start, planned_end, actual_start: null, actual_end: null, stage_key: "hardware", trade_code: "x", state: "open", ...extra,
});

h.routes = {
  "design-records": { measures: [{ id: 1, done_on: day(-20), person_name: "Alex", note: "Beam near the DB box", files: [] }], files: [], notes: [] },
  "/api/beta/projects/7/workspace": {
    settings: { design3dDays: 10, design2dDays: 12 }, reviews: [], defects: [],
    payments: {
      state: "ok", contractSen: 5_000_000, receivedSen: 1_000_000,
      instalments: [
        { seq: 1, label: "Deposit", amountSen: 1_000_000, paidSen: 1_000_000, status: "paid", stageCode: "design", trigger: "x" },
        { seq: 2, label: "2nd payment", amountSen: 2_000_000, paidSen: 0, status: "billed", stageCode: "hardware", trigger: "x" },
        { seq: 3, label: "Final payment", amountSen: 2_000_000, paidSen: 0, status: "not_billed", stageCode: "handover", trigger: "x" },
      ],
    },
  },
  "/api/beta/board": {
    today: day(0), mePersonId: 1, settings: { design3dDays: 10, design2dDays: 12, amendmentDays: 3 },
    people: [{ id: 1, name: "Jia Xin", roles: [] }, { id: 2, name: "Yi Xuan", roles: [] }, { id: 3, name: "Alex", roles: [] }], events: [],
    projects: [{
      id: 7, code: "RN-2608-002", name: "Legacy OUG A26-03", building: "Legacy", unitNo: "A26-03", customerName: "Mr Wayne", salesName: "Chai", createdOn: day(-60), handoverOn: day(25),
      lead: { id: 1, name: "Jia Xin" }, person3d: null, person2d: { id: 2, name: "Yi Xuan" }, sitePic: { id: 3, name: "Alex" }, measuredOn: day(-20), start3dOn: null, start2dOn: null, poDoneOn: null,
      files: [], notes: [], reviews: [], appointments: [], payment: { state: "none" },
    }],
  },
  "key-log": { data: [] },
  "/api/beta/projects/7/defects": {
    defects: [
      { id: 11, phase: "snag", location: "Kitchen", description: "Cabinet door not aligned", trade: "carpenter", dueDate: day(-2), reportedAt: day(-5), reportedByName: "Alex",
        photoKey: "renovation/7/defect-1.jpg", afterPhotoKey: null, fixedAt: null, fixedByName: null, closedAt: null, closedByName: null, redoCount: 0,
        assigneeId: 3, assigneeName: "Alex", assigneePhone: null, lastRedoNote: null },
      { id: 12, phase: "snag", location: "Master bedroom", description: "Paint drip", trade: "painter", dueDate: null, reportedAt: day(-4), reportedByName: "Alex",
        photoKey: "renovation/7/defect-2.jpg", afterPhotoKey: "renovation/7/defect-3.jpg", fixedAt: `${day(-1)}T03:00:00Z`, fixedByName: "Alex", closedAt: null, closedByName: null,
        redoCount: 1, assigneeId: null, assigneeName: null, assigneePhone: null, lastRedoNote: "Still a drip" },
    ],
  },
  "/api/beta/projects/7/site": {
    ready: true, areas: ["Kitchen", "Master bedroom"],
    deliveries: [
      { type: "goods_received", id: "g1", no: "GRN-001", at: `${day(-3)}T04:00:00Z`, status: "RECEIVED", from: "Kabinet Sdn Bhd", poNumber: "PO-001", poIds: ["po-1"], areas: ["Kitchen"],
        photos: [
          { id: "site-1", path: "/api/renovation/7/files?key=a.jpg", name: "Cabinet in place", image: true, area: "Kitchen", at: null, source: "site" },
          { id: "site-2", path: "/api/renovation/7/files?key=b.jpg", name: "Cabinet top", image: true, area: "Kitchen", at: null, source: "site" },
        ] },
      { type: "delivery_order", id: "d1", no: "DO-001", at: `${day(-1)}T04:00:00Z`, status: "DELIVERED", from: "SO-001", poNumber: null, poIds: [], areas: ["Master bedroom"],
        photos: [{ id: "pod-d1", path: "/api/renovation/7/document-files/delivery_order/d1/pod", name: "Proof of delivery", image: true, area: null, at: null, source: "pod" }] },
    ],
  },
  "/api/renovation/people": { data: [{ id: 1, name: "Jia Xin", roles: [], active: true, phone: "012-345 6789" }] },
  "/api/renovation/7": {
    project: { id: 7, code: "RN-2608-002", name: "Legacy OUG A26-03", customer_name: "Mr Wayne", customer_phone: "012-111 2222", building: "Legacy", unit_no: "A26-03", planned_handover_date: day(25), handed_over_at: null, notes: null, layout_label: null },
    type: { id: 1, name: "Full renovation", stage_keys: [] },
    so: { doc_no: "SO-001", status: "RENO_SIGNED", so_date: "2026-08-10", agent: null },
    lines: [{ soItemId: "1", group: null, subCategory: null, qty: 1, room: "Kitchen", description: null, itemCode: null }],
    currentStage: "hardware", hold: null, money: { contractSen: 5_000_000, receivedSen: 1_000_000, receivedPct: 20 }, keyHolder: null, vo: { count: 2, approved: 1 },
    flow: { current: "renovation", currentLabel: "Renovation", currentIndex: 3, derived: "renovation", manualStep: null, manualInEffect: false, steps: [
      { key: "design", label: "Design" }, { key: "signed", label: "Signed" }, { key: "ordering", label: "Ordering" }, { key: "renovation", label: "Renovation" }, { key: "handover", label: "Handover" }, { key: "closed", label: "Closed" },
    ] },
    people: { sales: { id: 2, name: "Chai" }, designer: { id: 1, name: "Jia Xin" }, renoPic: { id: null, name: null }, pic: { id: 3, name: "Alex" }, attending: [] },
    tasks: [
      task(1, "done", "Hacking & demolition", day(-12), day(-10), { actual_end: day(-10) }),
      task(2, "in_progress", "Electrical wiring & ceiling frame", day(-2), day(3), { actual_start: day(-2), purchase_order_id: "po-1" }),
      task(3, "planned", "Plaster ceiling closed", day(4), day(6)),
    ],
    defects: [],
  },
};

const qc = (): QueryClient => new QueryClient({ defaultOptions: { queries: { retry: false } } });

function open(url = "/beta/projects/7"): void {
  render(
    <QueryClientProvider client={qc()}>
      <DialogProvider>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/beta/projects/:id" element={<RenovationBetaWorkspace />} />
            <Route path="/beta/projects" element={<p>Project list</p>} />
          </Routes>
        </MemoryRouter>
      </DialogProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => localStorage.clear());

describe("Beta project workspace", () => {
  it("shows the mockup's header, stepper and tabs, and remembers the project", async () => {
    open();
    expect(await screen.findByRole("heading", { level: 1, name: "LEGACY OUG A26-03 · MR WAYNE" })).toBeTruthy();
    expect(screen.getByText(/RN-2608-002 · Full renovation · Handover/)).toBeTruthy();
    expect(screen.getByText("(25 days left)")).toBeTruthy();
    const team = screen.getByRole("group", { name: "Project team" });
    expect(within(team).getByText("Design lead")).toBeTruthy();
    // 3D falls back to the design lead; 2D has its own person on the board.
    expect(within(team).getByText("Yi Xuan")).toBeTruthy();
    expect(within(team).getAllByText("Jia Xin").length).toBeGreaterThanOrEqual(2);
    expect(within(team).getByText("Alex")).toBeTruthy();
    expect(within(team).getByText("Site PIC · Handover lead")).toBeTruthy();
    // The phone comes from the people list, which loads after the page.
    await waitFor(() => expect(within(team).getByRole("link", { name: /WhatsApp/ }).getAttribute("href")).toContain("wa.me/60123456789"));
    expect(within(team).getByRole("button", { name: "Assign" })).toBeTruthy();
    const steps = screen.getByRole("list", { name: "Project stages" });
    expect(within(steps).getByText("Sales order")).toBeTruthy();
    expect(within(steps).getByText("Design approved")).toBeTruthy();
    expect(within(steps).getByText(/Day 13 of 19/)).toBeTruthy();
    expect(within(steps).getAllByRole("listitem").find((li) => li.getAttribute("aria-current") === "step")?.textContent).toContain("Renovation");
    const tabs = screen.getByRole("navigation", { name: "Project sections" });
    expect(within(tabs).getAllByRole("button").map((b) => b.textContent)).toEqual(["Overview", "Drawings", "VO", "PO", "Client PO", "Site & photos", "Defects", "Timeline"]);
    expect(within(tabs).getByRole("button", { name: "Overview" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Back to the project list" }).getAttribute("href")).toBe("/beta/projects");
    expect(localStorage.getItem("beta:lastProject")).toBe("7");
  });

  it("draws the Overview cards in the mockup's order and wording", async () => {
    open();
    await screen.findByRole("heading", { name: "Payments" });
    expect(screen.getByText("1 of 3 received")).toBeTruthy();
    expect(screen.getByText(/Contract RM 50,000.00 · received .* · VO 1 of 2 approved/)).toBeTruthy();
    expect(screen.getByText("Paid · unlocked Design")).toBeTruthy();
    expect(screen.getByText("Not confirmed")).toBeTruthy();
    expect(screen.getByText("At handover")).toBeTruthy();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((x) => x.textContent);
    expect(headings).toEqual(["Payments", "To do", "Site progress", "Unit key", "Design progress", "Sales order", "Final drawings", "Client & team"]);
    expect(screen.getByText("Day 13 of 19 · 1 of 3 steps done")).toBeTruthy();
    // The step at the hardware stage waits for the unpaid 2nd payment; its PO has two site photos.
    expect(screen.getAllByText("Waits for 2nd payment").length).toBeGreaterThanOrEqual(1);
    expect(await screen.findByRole("button", { name: "2 photos" })).toBeTruthy();
    expect(screen.getByText("Electrical wiring & ceiling frame")).toBeTruthy();
    expect(screen.getByText("Site measure")).toBeTruthy();
    expect(screen.getByText("B - Pending 3D design")).toBeTruthy();
    expect(screen.getByText("2D · by Yi Xuan")).toBeTruthy();
    expect(screen.getByText("Site briefing · Alex")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start 3D today" })).toBeTruthy();
    // To do uses the same board logic as Calendar's Deadlines.
    expect(screen.getByText("Next step · waiting for payment")).toBeTruthy();
    expect(screen.getByText("3D not started")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Start 3D today\s*: 3D not started/ })).toBeTruthy();
    expect(screen.getByText("SO-001 · signed 10 Aug 2026")).toBeTruthy();
  });

  it("opens the shared assign form from the header", async () => {
    open();
    await screen.findByRole("heading", { name: "Payments" });
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    expect(await screen.findByRole("dialog", { name: "Assign" })).toBeTruthy();
  });

  it("opens the other tabs from the tab bar", async () => {
    open();
    await screen.findByRole("heading", { name: "Payments" });
    fireEvent.click(screen.getByRole("button", { name: "VO" }));
    expect(screen.getByRole("heading", { name: "Variation orders" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Defects" }));
    expect(await screen.findByRole("heading", { name: "Defects" })).toBeTruthy();
    expect(await screen.findByText("Contractor's turn")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Drawings" }));
    expect(await screen.findByRole("group", { name: "Drawing type" })).toBeTruthy();
  });

  it("shows the defect pipeline with overdue in red and opens a ticket", async () => {
    open("/beta/projects/7?tab=defects");
    const pipe = await screen.findByRole("region", { name: "Defect pipeline" });
    expect(within(pipe).getByRole("region", { name: "To fix, 1" })).toBeTruthy();
    expect(within(pipe).getByRole("region", { name: "Check, 1" })).toBeTruthy();
    expect(within(pipe).getByRole("region", { name: "Done, 0" })).toBeTruthy();
    expect(within(pipe).getByText(/^Overdue 2 days/)).toBeTruthy();
    expect(within(pipe).getByText("Alex · Carpenter")).toBeTruthy();
    expect(within(pipe).getByText("Painter")).toBeTruthy();
    fireEvent.click(within(pipe).getByRole("button", { name: /Open defect: Kitchen/ }));
    const dlg = await screen.findByRole("dialog", { name: "Cabinet door not aligned" });
    expect(within(dlg).getByRole("button", { name: "Mark complete" }).hasAttribute("disabled")).toBe(true);
    expect(within(dlg).getByText("Photo after the fix (required)")).toBeTruthy();
  });

  it("shows each delivery with its proof photos and filters by area", async () => {
    open("/beta/projects/7?tab=site");
    expect(await screen.findByRole("listitem", { name: "Goods receipt GRN-001" })).toBeTruthy();
    expect(screen.getByRole("listitem", { name: "Delivery order DO-001" })).toBeTruthy();
    const areas = screen.getByRole("group", { name: "Filter by area" });
    fireEvent.click(within(areas).getByRole("button", { name: /^Master bedroom/ }));
    expect(screen.queryByRole("listitem", { name: "Goods receipt GRN-001" })).toBeNull();
    expect(screen.getByRole("listitem", { name: "Delivery order DO-001" })).toBeTruthy();
  });
});
