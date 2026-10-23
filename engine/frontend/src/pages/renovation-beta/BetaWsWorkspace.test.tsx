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
      task(2, "in_progress", "Electrical wiring & ceiling frame", day(-2), day(3), { actual_start: day(-2) }),
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
    expect(screen.getByText("1 of 3 paid · each payment unlocks the next step")).toBeTruthy();
    expect(screen.getByText(/Contract RM 50,000.00 · VO 1 of 2 approved/)).toBeTruthy();
    expect(screen.getByText("Paid · unlocked Design")).toBeTruthy();
    expect(screen.getByText("Not confirmed")).toBeTruthy();
    expect(screen.getByText("At handover")).toBeTruthy();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((x) => x.textContent);
    expect(headings).toEqual(["Payments", "To do", "Site progress", "Unit key", "Design progress", "Sales order", "Final drawings", "Client & team"]);
    expect(screen.getByText("Day 13 of 19 · updated as each step is done")).toBeTruthy();
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
      expect(within(team).getAllByText("Yi Xuan").length).toBe(2);
      expect(within(team).getAllByText("3D artist · Design").length).toBe(2);
      expect(within(team).getAllByText("Site supervisor · Projects").length).toBe(2);
      fireEvent.click(within(team).getByRole("button", { name: "Assign" }));
      const dialog = await screen.findByRole("dialog", { name: "Assign" });
      const two = within(dialog).getByRole("group", { name: "2D by" });
      // Only people linked to an active account are offered, labelled as on the project page.
      await waitFor(() => expect(within(two).getByRole("option", { name: "Alex · Site supervisor · Projects" })).toBeTruthy());
      expect(within(two).queryByRole("option", { name: /Old Name/ })).toBeNull();
      fireEvent.change(within(two).getByRole("combobox"), { target: { value: "3" } });
      expect(within(within(two).getByRole("list", { name: "2D by picked" })).getAllByRole("listitem").length).toBe(2);
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
    expect(screen.getByRole("heading", { name: "Variation orders" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Defects" }));
    expect(await screen.findByRole("heading", { name: "Defects" })).toBeTruthy();
    expect(screen.getByText("Contractor's turn")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Drawings" }));
    expect(await screen.findByRole("group", { name: "Drawing type" })).toBeTruthy();
  });
});
