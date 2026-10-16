/* Projects > Calendar in renovation mode: Notion-style coloured cards from the feed, filters kept in the URL,
   a card opens the item with a link to its project, "+N more" opens the day. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RenoCalendarItem } from "./renovationCalendarItems";

const h = vi.hoisted(() => ({ paths: [] as string[], items: [] as unknown[], me: [] as number[] }));

vi.mock("../../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/client")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      get: async (path: string) => {
        h.paths.push(path);
        if (path.includes("/mode")) return { mode: "renovation" };
        if (path.startsWith("/api/projects/calendar/events")) return { projects: [], tasks: [], renoItems: h.items, renoMe: h.me };
        return { data: [] };
      },
    },
  };
});

import { ProjectsCalendarView } from "../ProjectsCalendarView";

const ying = { id: 1, name: "YING TZY", roles: ["designer"] };
const jia = { id: 3, name: "JIA XIN", roles: ["reno_pic"] };
function item(over: Partial<RenoCalendarItem>): RenoCalendarItem {
  return {
    key: "k", projectId: 7, projectName: "JERNIH KAJANG B-28-09 MR EDDIE & MS SHAR", projectCode: "RN-007", short: "Jernih B-28-09",
    date: "2026-10-13", end: "2026-10-13", kind: "task", title: "PLUMBING WORK", what: "Plumbing work", done: false,
    people: [], department: "renovation", supplier: null, brand: null, status: null, organizer: null, ...over,
  };
}

let lastSearch = "";
let lastPath = "";
function Spy() {
  const loc = useLocation();
  lastSearch = loc.search;
  lastPath = loc.pathname + loc.hash;
  return null;
}

function renderAt(url: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/projects" element={<><ProjectsCalendarView /><Spy /></>} />
          <Route path="/projects/:id" element={<Spy />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  h.paths = [];
  h.me = [];
  sessionStorage.clear();
  h.items = [
    item({ key: "amend", kind: "amendment", title: "2D AMENDMENT", department: "design", people: [ying], done: true, date: "2026-10-05", end: "2026-10-05" }),
    item({ key: "span", title: "HACKING", department: "renovation", people: [jia], date: "2026-10-06", end: "2026-10-09" }),
    ...["a", "b", "c", "d"].map((k) => item({ key: `busy-${k}`, title: `TASK ${k.toUpperCase()}`, date: "2026-10-20", end: "2026-10-20" })),
  ];
});

describe("renovation calendar (Notion layout)", () => {
  it("asks the feed for cards over the Sunday-first month and draws coloured cards with people, project and status", async () => {
    renderAt("/projects?view=calendar&month=2026-10");
    expect(await screen.findByText("October 2026")).toBeTruthy();
    const card = await screen.findByRole("button", { name: /2D AMENDMENT/ });
    expect(card.getAttribute("data-department")).toBe("design");
    expect(within(card).getByText("YING TZY")).toBeTruthy();
    expect(within(card).getByText("Done")).toBeTruthy();
    expect(within(card).getByText("Design")).toBeTruthy();
    expect(within(card).getByText("Jernih B-28-09")).toBeTruthy();
    expect(h.paths).toContain("/api/projects/calendar/events?from=2026-09-27&to=2026-10-31&items=1");
    // A multi-day task is ONE card.
    expect(screen.getAllByRole("button", { name: /HACKING/ })).toHaveLength(1);
  });

  it("caps a busy day at three cards and opens the day from +N more", async () => {
    renderAt("/projects?view=calendar&month=2026-10");
    fireEvent.click(await screen.findByRole("button", { name: "+1 more" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByRole("button", { name: /TASK [ABCD]/ })).toHaveLength(4);
  });

  it("keeps department and status filters in the URL", async () => {
    renderAt("/projects?view=calendar&month=2026-10");
    await screen.findByRole("button", { name: /2D AMENDMENT/ });
    fireEvent.click(screen.getByRole("button", { name: /^Design/, pressed: false }));
    await waitFor(() => expect(lastSearch).toContain("dept=design"));
    expect(screen.queryByRole("button", { name: /HACKING/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open", pressed: false }));
    await waitFor(() => expect(lastSearch).toContain("state=open"));
    expect(screen.queryByRole("button", { name: /2D AMENDMENT/ })).toBeNull();
  });

  it("restores filters from a link and filters by person", async () => {
    renderAt("/projects?view=calendar&month=2026-10&person=3");
    await screen.findByRole("button", { name: /HACKING/ });
    expect(screen.queryByRole("button", { name: /2D AMENDMENT/ })).toBeNull();
  });

  it("a card opens the item; Open project goes to its section", async () => {
    renderAt("/projects?view=calendar&month=2026-10");
    fireEvent.click(await screen.findByRole("button", { name: /2D AMENDMENT/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/JERNIH KAJANG B-28-09 MR EDDIE/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: /Open project/ }));
    await waitFor(() => expect(lastPath).toBe("/projects/7#reno-design"));
  });

  it("week view shows the Sunday-first week with every card", async () => {
    renderAt("/projects?view=calendar&mode=week&week=2026-10-18");
    expect(await screen.findByText("18 – 24 Oct 2026")).toBeTruthy();
    expect(await screen.findAllByRole("button", { name: /TASK [ABCD]/ })).toHaveLength(4);
    expect(h.paths).toContain("/api/projects/calendar/events?from=2026-10-18&to=2026-10-24&items=1");
  });

  it("My tasks stays off until the account is linked to a person", async () => {
    renderAt("/projects?view=calendar&month=2026-10");
    await screen.findByRole("button", { name: /2D AMENDMENT/ });
    expect((screen.getByRole("button", { name: /My tasks/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
