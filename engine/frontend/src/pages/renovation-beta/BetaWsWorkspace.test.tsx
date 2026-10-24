/* The Beta project workspace renders the mockup's words: the header, the stepper, the tab bar and the Overview cards. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ routes: {} as Record<string, unknown>, puts: [] as Array<[string, unknown]> }));

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  const get = async (path: string): Promise<unknown> => {
    const hit = Object.entries(h.routes).find(([k]) => path.includes(k));
    if (!hit) throw new Error(`no mock for ${path}`);
    return hit[1];
  };
  const put = async (path: string, body: unknown): Promise<unknown> => { h.puts.push([path, body]); return { ok: true }; };
  return { ...actual, api: { ...actual.api, get, put, fetchBlobUrl: async () => "blob:x" } };
});
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ can: () => true }) }));

import { DialogProvider } from "../../hooks/useDialog";
import { RenovationBetaWorkspace } from "./RenovationBetaWorkspace";

const day = (offset: number): string => new Date(Date.now() + 8 * 3600e3 + offset * 86_400_000).toISOString().slice(0, 10);

const task = (id: number, status: string, label: string, planned_start: string, planned_end: string, extra: Record<string, unknown> = {}): unknown => ({
  id, seq: id, status, label, planned_start, planned_end, actual_start: null, actual_end: null, stage_key: "hardware", trade_code: "x", state: "open", ...extra,
});

h.routes = {
  "/api/beta/projects/7/vo": {
    so: { docNo: "SO-2610-001", renovation: false }, finance: true, counts: { pending: 0, approved: 1, closed: 0 },
    totals: { addedSen: 50_000, deductedSen: -20_000, netSen: 30_000, pendingNetSen: 0 },
    vos: [{
      key: "a:1", label: "VO-01", source: "amendment", no: "A1", soDocNo: "SO-2610-001", title: "Client change", status: "SENT", statusLabel: "Approved",
      bucket: "approved", date: "2026-10-20T02:00:00Z", raisedBy: "Ali", approvedBy: "Ali", approvedAt: "2026-10-21T02:00:00Z", netSen: 30_000,
      href: "/scm/amendments/1",
      lines: [
        { itemCode: "CAB-1", description: "Kitchen cabinet", room: "Kitchen", qty: 1, measure: null, amountSen: 50_000, change: "add", goesTo: "po", fromItemCode: null },
        { itemCode: "LT-9", description: "Downlight", room: "Hall", qty: -2, measure: null, amountSen: -20_000, change: "deduct", goesTo: "po", fromItemCode: null },
      ],
    }],
  },
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
  "/api/beta/projects/7/lines": {
    finance: false, plansReady: true, sos: [], pendingPoChanges: [],
    lines: [{
      id: "li1", soDocNo: "SO-001", soStatus: "CONFIRMED", voLocked: false, lineNo: 1, itemCode: "CAB-01", description: "Kitchen cabinet", variantText: null, variants: {},
      itemGroup: null, uom: "UNIT", qty: 1, unitPriceSen: null, discountSen: null, amountSen: null, area: "Kitchen", remark: null, supplierName: "Kabinet Sdn Bhd",
      goesTo: "po", categoryLabel: "Cabinet", categorySort: 1, subLabel: "", subSort: 0, photoKeys: [], skuPhotos: [], gr: "yes", do: "yes",
      pos: [{ poId: "po-1", poNumber: "PO-001", poStatus: "SUBMITTED", poLineId: "pl1", poDate: null, deliveryDate: "2026-11-02", qty: 1, received: 1, photoKeys: [] }],
      plan: { orderOn: null, deliverOn: "2026-12-30", noPo: false },
    }],
  },
  "/api/beta/projects/7/site": {
    ready: true, areas: ["Kitchen", "Master bedroom"],
    deliveries: [
      { type: "goods_received", id: "g1", no: "GRN-001", at: `${day(-3)}T04:00:00Z`, status: "RECEIVED", from: "Kabinet Sdn Bhd", poNumber: "PO-001", poIds: ["po-1"], areas: ["Kitchen"],
        lines: [{ soItemId: "li1", poLineId: "pl1", qty: 1 }],
        photos: [
          { id: "site-1", path: "/api/renovation/7/files?key=a.jpg", name: "Cabinet in place", image: true, area: "Kitchen", at: null, source: "site" },
          { id: "site-2", path: "/api/renovation/7/files?key=b.jpg", name: "Cabinet top", image: true, area: "Kitchen", at: null, source: "site" },
        ] },
      { type: "delivery_order", id: "d1", no: "DO-001", at: `${day(-1)}T04:00:00Z`, status: "DELIVERED", from: "SO-001", poNumber: null, poIds: [], areas: ["Master bedroom"],
        lines: [{ soItemId: "li1", poLineId: null, qty: 1 }],
        photos: [{ id: "pod-d1", path: "/api/renovation/7/document-files/delivery_order/d1/pod", name: "Proof of delivery", image: true, area: null, at: null, source: "pod" }] },
    ],
  },
  "/api/beta/projects/7/photos": {
    ready: true, areas: ["Kitchen", "Master bedroom"],
    photos: [
      { id: "media-1", path: "/api/renovation/7/files?key=renovation/7/progress-1.jpg", kind: "image", name: "wall.jpg", at: `${day(0)}T07:42:00Z`, area: "Kitchen",
        category: "progress", label: null, group: { key: "progress:a", title: "Site photos by Alex" }, note: "Hacking done" },
      { id: "media-2", path: "/api/renovation/7/files?key=renovation/7/progress-2.mp4", kind: "video", name: "walk.mp4", at: `${day(0)}T07:42:00Z`, area: "Kitchen",
        category: "progress", label: null, group: { key: "progress:a", title: "Site photos by Alex" }, note: null },
      { id: "pod-d1", path: "/api/renovation/7/document-files/delivery_order/d1/pod", kind: "image", name: "Proof of delivery", at: `${day(-1)}T04:00:00Z`, area: "Master bedroom",
        category: "do", label: "POD", group: { key: "do:d1", title: "DO DO-001" }, note: null },
      { id: "defect-11-b0", path: "/api/renovation/7/files?key=renovation/7/defect-1.jpg", kind: "image", name: "Before", at: `${day(-5)}T02:00:00Z`, area: "Kitchen",
        category: "defect", label: "Before", group: { key: "defect:11", title: "Defect: Cabinet door not aligned" }, note: null },
    ],
    docs: { dos: [{ id: "d1", no: "DO-001" }], grs: [{ id: "g1", no: "GRN-001" }], pos: [] },
    tasks: [{ id: 2, label: "Electrical wiring & ceiling frame", state: "in_progress" }],
  },
  "/api/beta/projects/7/timeline": {
    entries: [
      { id: "act:202", at: `${day(0)}T03:46:23Z`, dateOnly: false, category: "site", title: "Site task done", body: "INTERNAL:pre_reno_delivery", by: "Lim" },
      { id: "act:178", at: `${day(0)}T03:08:56Z`, dateOnly: false, category: "design", title: "site_measure booked", body: "On 2026-10-24 · by JIAXIN", by: "Lim" },
      { id: "note:1", at: `${day(0)}T02:00:00Z`, dateOnly: false, category: "site", title: null, body: "Client asked about the_wall", by: "Lim", noteId: 1 },
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
    stepSla: { stepKey: "renovation", enteredOn: day(-12), daysIn: 12, days: 45, overdueBy: null, steps: [], totalDays: 45 },
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
    expect(within(steps).getByText(/Day 13 of 45/)).toBeTruthy();
    expect(within(steps).getAllByRole("listitem").find((li) => li.getAttribute("aria-current") === "step")?.textContent).toContain("Renovation");
    const tabs = screen.getByRole("navigation", { name: "Project sections" });
    expect(within(tabs).getAllByRole("button").map((b) => b.textContent)).toEqual(["Overview", "Drawings", "VO", "PO", "Client PO", "DO", "GR", "Site & photos", "Defects", "Timeline"]);
    expect(within(tabs).getByRole("button", { name: "Overview" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Back to the project list" }).getAttribute("href")).toBe("/beta/projects");
    expect(localStorage.getItem("beta:lastProject")).toBe("7");
  });

  it("draws the Overview cards in the mockup's order and wording", async () => {
    open();
    await screen.findByRole("heading", { name: "Payments" });
    expect(screen.getByText("1 of 3 received")).toBeTruthy();
    expect(screen.getByText("VO 1 of 2 approved")).toBeTruthy();
    const totals = screen.getByLabelText("Payment totals");
    expect(within(totals).getByText("RM 50,000.00")).toBeTruthy();
    expect(within(totals).getByText("Outstanding")).toBeTruthy();
    expect(screen.getByText("Paid · unlocked Design")).toBeTruthy();
    expect(screen.getByText("Not confirmed")).toBeTruthy();
    expect(screen.getByText("At handover")).toBeTruthy();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((x) => x.textContent);
    expect(headings).toEqual(["Payments", "To do", "Site progress", "Unit key", "Design progress", "Sales order", "Final drawings", "Client & team"]);
    // The same day count as the stepper and the project list (the step SLA), not the site tasks' span.
    expect(screen.getByText("Day 13 of 45 · 1 of 3 steps done")).toBeTruthy();
    // The step at the hardware stage waits for the unpaid 2nd payment; its PO has two site photos.
    expect(screen.getAllByText("Waits for 2nd payment").length).toBeGreaterThanOrEqual(1);
    expect(await screen.findByRole("button", { name: "2 photos" })).toBeTruthy();
    expect(screen.getByText("Electrical wiring & ceiling frame")).toBeTruthy();
    expect(screen.getByText("Site measure")).toBeTruthy();
    expect(screen.getByText("B - Pending 3D design")).toBeTruthy();
    expect(screen.getByText("2D · by Yi Xuan")).toBeTruthy();
    expect(screen.getByText("Site briefing · Alex")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start 3D today" })).toBeTruthy();
    // Past design the step bar's step leads To do (live run, 24 Oct 2026); the design and payment rows follow it.
    expect(screen.getByText("Next step · renovation")).toBeTruthy();
    expect(screen.getByText("Next site step: Electrical wiring & ceiling frame")).toBeTruthy();
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

  it("shows every 3D and 2D person with their position, and saves several from Assign", async () => {
    const saved = { ...h.routes };
    const b = h.routes["/api/beta/board"] as { people: unknown[]; projects: Array<Record<string, unknown>> };
    h.routes["/api/beta/board"] = {
      ...b,
      people: [
        { id: 1, name: "Jia Xin", roles: [], position: "Interior designer", department: "Design", offered: true },
        { id: 2, name: "Yi Xuan", roles: [], position: "3D artist", department: "Design", offered: true },
        { id: 3, name: "Alex", roles: [], position: "Site supervisor", department: "Projects", offered: true },
        { id: 4, name: "Old Name", roles: [], offered: false },
      ],
      projects: [{ ...b.projects[0], person3d: { id: 2, name: "Yi Xuan" }, people3d: [{ id: 2, name: "Yi Xuan" }, { id: 3, name: "Alex" }], people2d: [{ id: 2, name: "Yi Xuan" }] }],
    };
    h.routes["/api/renovation/people"] = { data: [
      { id: 1, name: "Jia Xin", roles: [], active: true, phone: "012-345 6789", position: "Interior designer", department: "Design", offered: true },
      { id: 2, name: "Yi Xuan", roles: [], active: true, position: "3D artist", department: "Design", offered: true },
      { id: 3, name: "Alex", roles: [], active: true, position: "Site supervisor", department: "Projects", offered: true },
      { id: 4, name: "Old Name", roles: [], active: true, offered: false },
    ] };
    h.puts = [];
    try {
      open();
      const team = await screen.findByRole("group", { name: "Project team" });
      // Two people on a card: one line with the first name and "+1 other", both names under it, two avatars.
      expect(within(team).getByText("Yi Xuan +1 other")).toBeTruthy();
      expect(within(team).getByText("Yi Xuan, Alex")).toBeTruthy();
      expect(within(team).getByText("3D artist · Design")).toBeTruthy();
      expect(within(team).getByText("Site supervisor · Projects")).toBeTruthy();
      fireEvent.click(within(team).getByRole("button", { name: "Assign" }));
      const dialog = await screen.findByRole("dialog", { name: "Assign" });
      const two = within(dialog).getByRole("group", { name: "2D by" });
      fireEvent.click(within(two).getByRole("button", { name: "Change people" }));
      // Only people linked to an active account are offered, labelled as on the project page, each with a tick box.
      await waitFor(() => expect(within(two).getByRole("checkbox", { name: "Alex · Site supervisor · Projects" })).toBeTruthy());
      expect(within(two).queryByRole("checkbox", { name: /Old Name/ })).toBeNull();
      fireEvent.change(within(two).getByRole("searchbox"), { target: { value: "ale" } });
      expect(within(two).queryByRole("checkbox", { name: /Yi Xuan/ })).toBeNull();
      fireEvent.click(within(two).getByRole("checkbox", { name: "Alex · Site supervisor · Projects" }));
      fireEvent.click(within(two).getByRole("button", { name: "Done" }));
      expect(within(within(two).getByRole("list", { name: "2D by picked" })).getAllByRole("listitem").length).toBe(2);
      expect(within(two).getByRole("button", { name: "Remove Alex" })).toBeTruthy();
      const three = within(dialog).getByRole("group", { name: "3D by" });
      fireEvent.click(within(three).getByRole("button", { name: "Remove Alex" }));
      fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
      await waitFor(() => expect(h.puts.find(([path]) => path.endsWith("/projects/7/design"))?.[1]).toEqual({ person3dIds: [2], person2dIds: [2, 3] }));
    } finally {
      Object.assign(h.routes, saved);
    }
  });

  it("opens the other tabs from the tab bar", async () => {
    open();
    await screen.findByRole("heading", { name: "Payments" });
    fireEvent.click(screen.getByRole("button", { name: "VO" }));
    expect(await screen.findByRole("heading", { name: "VO-01 · Client change" })).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "VO lines" })).getByText("Kitchen cabinet")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "VO lines" })).getByText("-2")).toBeTruthy();
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
    expect(within(dlg).getByLabelText("Photos or videos after the fix")).toBeTruthy();
    // Before and after each show their photos and videos, labelled.
    expect(within(dlg).getByText("Before · 1")).toBeTruthy();
    expect(within(dlg).getByText("After · 0")).toBeTruthy();
  });

  it("asks for the area from the project's areas, with Other for one typed by hand", async () => {
    open("/beta/projects/7?tab=defects");
    fireEvent.click(await screen.findByRole("button", { name: /Report a problem/ }));
    const form = screen.getByRole("form", { name: "Report a problem" });
    const area = within(form).getByRole("combobox", { name: "Area" });
    expect(within(area).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose the area", "Kitchen", "Master bedroom", "Other..."]);
    fireEvent.change(area, { target: { value: "__other__" } });
    expect(within(form).getByRole("textbox", { name: "Area, other" })).toBeTruthy();
    expect(within(form).getByText(/videos up to 95 MB/)).toBeTruthy();
  });

  it("shows each delivery order and goods receipt on its own tab, with its photos", async () => {
    open("/beta/projects/7?tab=do");
    const doCard = await screen.findByRole("listitem", { name: "Delivery order DO-001" });
    expect(within(doCard).getByRole("list", { name: "Photos of DO-001: 1 item" })).toBeTruthy();
    expect(within(doCard).getByText("POD")).toBeTruthy();
    // The PO and delivery date are the PO line's, as the PO tab shows them, not the line's own plan.
    expect(within(doCard).getByText("PO-001")).toBeTruthy();
    expect(within(doCard).getByText("2 Nov")).toBeTruthy();
    expect(screen.queryByRole("listitem", { name: "Goods receipt GRN-001" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "By category" }));
    const cat = await screen.findByRole("region", { name: "Cabinet" });
    expect(within(cat).getByText("Kitchen cabinet")).toBeTruthy();
    expect(within(cat).getByRole("button", { name: "DO-001 (1)" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "GR" }));
    const gr = await screen.findByRole("listitem", { name: "Goods receipt GRN-001" });
    expect(within(gr).getByRole("list", { name: "Photos of GRN-001: 2 items" })).toBeTruthy();
    expect(within(gr).getByText(/Kabinet Sdn Bhd/)).toBeTruthy();
    expect(within(gr).getByText("PO-001")).toBeTruthy();
    // A GR names the DO that delivered its lines; a click opens the DO tab on that DO's row.
    fireEvent.click(within(gr).getByRole("button", { name: "DO-001" }));
    const focused = await screen.findByRole("listitem", { name: "Delivery order DO-001" });
    expect(focused.getAttribute("aria-current")).toBe("true");
  });

  it("shows every photo on one timeline, newest first, filtered by category and area", async () => {
    open("/beta/projects/7?tab=site");
    const line = await screen.findByRole("list", { name: "Photo timeline" });
    const cards = within(line).getAllByRole("listitem").filter((li) => li.getAttribute("aria-label"));
    expect(cards.map((c) => c.getAttribute("aria-label"))).toEqual([
      "3:42 pm · Site photos by Alex · 1 photo, 1 video",
      "12:00 pm · DO DO-001 · POD · 1 photo",
      "10:00 am · Defect: Cabinet door not aligned · Before · 1 photo",
    ]);
    // The left column names each day once, then the time of each event, newest first.
    expect(within(cards[0]).getByText("Today")).toBeTruthy();
    expect(within(cards[1]).getByText("Yesterday")).toBeTruthy();
    const show = screen.getByRole("group", { name: "Show" });
    expect(within(show).getAllByRole("button").map((b) => b.textContent)).toEqual(["All 4", "Progress 2", "DO 1", "GR 0", "Measure 0", "Defect 1"]);
    fireEvent.click(within(show).getByRole("button", { name: /^DO/ }));
    expect(within(screen.getByRole("list", { name: "Photo timeline" })).getAllByRole("listitem").filter((li) => li.getAttribute("aria-label")).length).toBe(1);
    fireEvent.click(within(show).getByRole("button", { name: /^All/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by area" }), { target: { value: "Kitchen" } });
    expect(within(screen.getByRole("list", { name: "Photo timeline" })).getAllByRole("listitem").filter((li) => li.getAttribute("aria-label")).length).toBe(2);
    // A click opens the gallery with its counter, and Esc closes it.
    fireEvent.click(screen.getAllByRole("button", { name: /^Open video walk\.mp4/ })[0]);
    expect(await screen.findByText("2 / 2")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText("2 / 2")).toBeNull());
  });

  it("never shows a stored code on the Timeline", async () => {
    open("/beta/projects/7?tab=timeline");
    expect(await screen.findByText("Pre-reno works & item delivery")).toBeTruthy();
    const region = screen.getByRole("region", { name: "Timeline" });
    expect(String(region.textContent)).not.toMatch(/INTERNAL:|\bsite_measure\b/);
    expect(within(region).getByText("site measure booked")).toBeTruthy();
    // A note a person wrote is shown as written.
    expect(within(region).getByText("Client asked about the_wall")).toBeTruthy();
  });
});
