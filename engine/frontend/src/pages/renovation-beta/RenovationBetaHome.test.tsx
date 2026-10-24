/* Home and Calendar render from a board answer: the words the mockup shows, the tab counts, the row opening a project,
   the Deadlines groups, and + Add project going to the New project form. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BetaBoard } from "./renovationBetaBoardApi";

const h = vi.hoisted(() => ({ board: null as unknown, can: true, puts: [] as Array<{ path: string; body: unknown }> }));

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      get: async () => h.board,
      put: async (path: string, body: unknown) => { h.puts.push({ path, body }); return { ok: true }; },
    },
  };
});
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ can: () => h.can }) }));

import { RenovationBetaCalendar } from "./RenovationBetaCalendar";
import { RenovationBetaHome } from "./RenovationBetaHome";

const person = (id: number, name: string) => ({ id, name, roles: [] as string[] });
const base = {
  code: null, salesName: null, createdOn: null, handoverOn: null, person3d: null, person2d: null, sitePic: null, measuredOn: "2026-09-01",
  start3dOn: null, start2dOn: null, poDoneOn: null, files: [], notes: [], reviews: [], appointments: [], payment: { state: "ok", label: "1st payment" },
};
h.board = {
  today: "2026-10-23", mePersonId: 1, settings: { design3dDays: 10, design2dDays: 12, amendmentDays: 3 },
  people: [person(1, "Jia Xin"), person(2, "Ying Tzy")],
  projects: [
    { ...base, id: 13, name: "Bukit Jalil The Park 2", building: "Bukit Jalil The Park 2", unitNo: null, customerName: "Ms Tan", lead: null, measuredOn: null },
    {
      ...base, id: 7, name: "Seri Riana C-12-03", building: "Seri Riana", unitNo: "C-12-03", customerName: "Ms Lim", lead: { id: 1, name: "Jia Xin" },
      files: [{ id: 71, kind: "3d", version: 1, submittedOn: "2026-09-03" }, { id: 72, kind: "2d", version: 1, submittedOn: "2026-09-20" }],
      reviews: [{ fileId: 71, sentOn: null, approvedOn: "2026-09-05" }, { fileId: 72, sentOn: null, approvedOn: "2026-09-22" }],
      appointments: [
        { kind: "carpentry_measure", onDate: "2026-10-01", atTime: null, personId: 1, withText: null, doneAt: null },
        { kind: "site_briefing", onDate: "2026-10-05", atTime: null, personId: 1, withText: null, doneAt: null },
      ],
    },
    { ...base, id: 4, name: "Baron C-20-08", building: "Baron", unitNo: "C-20-08", customerName: "Mr Albert", lead: { id: 1, name: "Jia Xin" }, start3dOn: "2026-10-20" },
  ],
  events: [{ id: 9, projectId: 4, onDate: "2026-10-27", atTime: "11:30:00", type: "client", note: "Client meeting @ 11:30am", personId: 1, done: false }],
} as unknown as BetaBoard;

let phone = false;
beforeEach(() => {
  phone = false;
  h.can = true;
  h.puts = [];
  window.matchMedia = ((query: string) => ({
    matches: phone && query.includes("719px"), media: query, addEventListener: () => undefined, removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
});

let where = "";
function Spy(): null {
  const l = useLocation();
  where = l.pathname + l.search;
  return null;
}

function renderAt(url: string): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/beta/projects" element={<><RenovationBetaHome /><Spy /></>} />
          <Route path="/beta/calendar" element={<><RenovationBetaCalendar /><Spy /></>} />
          <Route path="/beta/projects/:id" element={<Spy />} />
          <Route path="/projects" element={<Spy />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Beta Home", () => {
  it("shows the title, counts, tabs and rows as the mockup does", async () => {
    renderAt("/beta/projects");
    expect(await screen.findByRole("heading", { name: "All projects" })).toBeTruthy();
    expect(screen.getByText("3 projects")).toBeTruthy();
    const tabs = within(screen.getByRole("tablist", { name: "Project groups" })).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["All projects3", "Site Measure1", "Design1", "Carpentry · Site · PO1", "Done Design0"]);
    expect(screen.getByText("New")).toBeTruthy();
    expect(screen.getByTitle("A - New · team not assigned")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Assign/ })).toBeTruthy();
    expect(screen.getByText("3D in progress")).toBeTruthy();
    expect(screen.getByText("3 shown · tap a project to open it")).toBeTruthy();
  });

  it("opens a project from its row and remembers it", async () => {
    window.localStorage.removeItem("beta:lastProject");
    renderAt("/beta/projects");
    fireEvent.click((await screen.findAllByText("Baron C-20-08"))[0]);
    expect(where).toBe("/beta/projects/4");
    expect(window.localStorage.getItem("beta:lastProject")).toBe("4");
  });

  it("shows cards instead of the table on a phone", async () => {
    phone = true;
    renderAt("/beta/projects");
    expect(await screen.findByText("Needs team")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getAllByText("Now: Jia Xin · 1st payment").length).toBeGreaterThan(0);
  });

});

describe("Beta Calendar", () => {
  it("shows the SOP line, the viewer's deadlines and sends + Add project to the New project form", async () => {
    renderAt("/beta/calendar");
    expect(await screen.findByRole("heading", { name: "Calendar" })).toBeTruthy();
    expect(screen.getByText("Deadlines follow the ID SOP: 3D in 10 days, 2D in 12 days")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Jia Xin's deadlines" })).toBeTruthy();
    expect(screen.getByText("Next 7 days · 1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "+ Add project" }));
    expect(where).toBe("/projects?view=list&new=1");
  });

  it("hides the write buttons from people without projects.write", async () => {
    h.can = false;
    renderAt("/beta/calendar");
    expect(await screen.findByRole("heading", { name: "Calendar" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "+ Add project" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Calendar" }));
    expect(screen.queryByRole("button", { name: "+ Add work" })).toBeNull();
  });

  it("marks the PO done from the to-do box", async () => {
    renderAt("/beta/calendar");
    fireEvent.click(await screen.findByRole("button", { name: "PO done" }));
    await screen.findByText("PO done", { selector: "[role=status]" });
    expect(h.puts).toEqual([{ path: "/api/beta/projects/7/design", body: { poDoneOn: "2026-10-23" } }]);
  });

  it("switches to Progress and to the month with its coming-up list", async () => {
    renderAt("/beta/calendar");
    fireEvent.click(await screen.findByRole("tab", { name: "Progress" }));
    expect(screen.getByRole("heading", { name: "Jia Xin's projects" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Calendar" }));
    expect(screen.getByRole("heading", { name: "October 2026" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Coming up" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "+ Add work" }));
    expect(screen.getByRole("dialog", { name: "Add work" })).toBeTruthy();
  });
});
