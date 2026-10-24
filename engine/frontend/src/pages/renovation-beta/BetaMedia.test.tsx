/* The shared media grid keeps one 4:3 box for any count and the strip one tile size with "+N", a video is a play tile, a file that fails
   is a plain tile; the list keeps a row in place after a save; photo cards group by event. */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return { ...actual, api: { ...actual.api, fetchBlobUrl: async (path: string) => { if (path.includes("broken")) throw new Error("404"); return `blob:${path}`; } } };
});

import { MediaGrid, MediaStrip, durationText, mediaRefusal, type MediaItem } from "./BetaMedia";
import { keepOrder, matchesSearch, newestFirst, orderOf } from "./renovationBetaHomeModel";
import { cardLine, dayTitle, photoTimeline } from "./renovationBetaPhotosModel";
import type { ProjectPhoto } from "./renovationBetaMediaApi";
import type { DesignProject } from "./renovationBetaBoard";

const item = (i: number, kind: MediaItem["kind"] = "image", path = `/p/${i}`): MediaItem => ({ id: `m${i}`, path, kind, name: `file-${i}`, label: i === 0 ? "Before" : null });

describe("MediaGrid", () => {
  it.each([
    [1, "1fr", 1, null],
    [2, "1fr 1fr", 2, null],
    [3, "1fr 1fr", 3, null],
    [4, "1fr 1fr 1fr", 4, null],
    [11, "1fr 1fr 1fr", 4, "+7"],
  ])("lays out %i items in the same 4:3 box", (n, cols, tiles, more) => {
    const { container } = render(<MediaGrid items={Array.from({ length: n }, (_, i) => item(i, i === 2 ? "video" : "image"))} label="Photos" />);
    const grid = container.querySelector("[role=group] > div") as HTMLElement;
    expect(grid.style.gridTemplateColumns).toBe(cols);
    expect(grid.style.aspectRatio).toBe("4 / 3");
    expect(within(grid).getAllByRole("button").length).toBe(tiles);
    if (more) expect(within(grid).getByText(more)).toBeTruthy();
  });

  it("puts the first on top of an even row of tiles, and a video as a play tile", () => {
    const { container } = render(<MediaGrid items={[item(0), item(1), item(2, "video")]} label="Photos" />);
    const grid = container.querySelector("[role=group] > div") as HTMLElement;
    expect((grid.firstElementChild as HTMLElement).style.gridColumn).toBe("1 / -1");
    expect(screen.getByRole("button", { name: /^Open video file-2/ })).toBeTruthy();
    expect(screen.getByText("Before")).toBeTruthy();
  });

  it("shows a strip of equal tiles with +N on the last one, opening the gallery at that item", async () => {
    render(<MediaStrip items={Array.from({ length: 10 }, (_, i) => item(i))} label="POD" size={64} max={6} />);
    const strip = screen.getByRole("list", { name: "POD: 10 items" });
    const tiles = within(strip).getAllByRole("listitem");
    expect(tiles.length).toBe(6);
    expect(tiles.every((t) => t.style.width === "64px" && t.style.height === "64px")).toBe(true);
    expect(within(strip).getByText("+4")).toBeTruthy();
    fireEvent.click(within(tiles[5]).getByRole("button"));
    expect(await screen.findByText("6 / 10")).toBeTruthy();
  });

  it("shows a plain tile, never a broken image, for a file that cannot be read", async () => {
    render(<MediaGrid items={[item(0, "image", "/broken/1")]} label="Photos" />);
    expect(await screen.findByText("No preview")).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();
  });

  it("opens the gallery with a counter, arrows and a download link", async () => {
    render(<MediaGrid items={[item(0), item(1), item(2)]} label="Photos" />);
    fireEvent.click(screen.getByRole("button", { name: /^Open Before: photo file-0/ }));
    expect(await screen.findByText("1 / 3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("2 / 3")).toBeTruthy();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByText("3 / 3")).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("link", { name: "Download" }).getAttribute("download")).toBe("file-2"));
  });

  it("says why a file is refused and how long a video is", () => {
    expect(mediaRefusal(new File(["x"], "a.exe", { type: "application/x-msdownload" }))).toMatch(/photo or a video/);
    expect(mediaRefusal(new File(["x"], "walk.mov", { type: "video/quicktime" }))).toBeNull();
    expect(durationText(75)).toBe("1:15");
    expect(durationText(null)).toBeNull();
  });
});

describe("the project list", () => {
  const p = (id: number, createdAt: string | null, extra: Partial<DesignProject> = {}): DesignProject =>
    ({ id, createdAt, title: `P${id}`, name: `P${id}`, tag: "", building: null, unitNo: null, customer: null, code: null, soDocNos: [], salesName: null, lead: null, site: null, team: { "3": [], "2": [] }, ...extra }) as unknown as DesignProject;

  it("puts the newest project first", () => {
    expect(newestFirst([p(1, "2026-10-01T00:00:00Z"), p(3, "2026-10-24T02:57:52Z"), p(2, null)]).map((x) => x.id)).toEqual([3, 1, 2]);
  });

  it("keeps a row where it was after a save re-sorts the list", () => {
    const order = orderOf([p(5, null), p(4, null), p(3, null)]);
    expect(keepOrder([p(3, null), p(5, null), p(9, null), p(4, null)], order).map((x) => x.id)).toEqual([5, 4, 3, 9]);
  });

  it("matches part of a word, any case, across the fields", () => {
    const x = p(1, null, { building: "18 USJ 2/4P Service Residence", customer: "Ms Tan", code: "RN-2610-006", soDocNos: ["TC-SO-2610-002"], team: { "3": [{ id: 1, name: "Jia Xin" }], "2": [] } });
    for (const q of ["usj", "ms tan", "rn-2610", "so-2610-002", "JIA", "usj tan"]) expect(matchesSearch(x, q), q).toBe(true);
    expect(matchesSearch(x, "nara")).toBe(false);
  });
});

describe("photo cards", () => {
  const ph = (id: string, at: string, key: string, extra: Partial<ProjectPhoto> = {}): ProjectPhoto => ({
    id, path: "", kind: "image", name: id, at, area: null, category: "do", label: "POD", group: { key, title: `DO ${key}` }, note: null, ...extra,
  });
  it("groups photos of one event into one card under its day", () => {
    const days = photoTimeline([
      ph("a", "2026-10-24T07:42:00Z", "do:1"), ph("b", "2026-10-24T07:42:00Z", "do:1", { kind: "video" }),
      ph("c", "2026-10-24T03:00:00Z", "defect:2", { category: "defect", label: "Before", group: { key: "defect:2", title: "Defect: tile crack" } }),
      ph("d", "2026-10-24T02:00:00Z", "defect:2", { category: "defect", label: "After", group: { key: "defect:2", title: "Defect: tile crack" } }),
      ph("e", "2026-10-23T01:00:00Z", "do:9"),
    ]);
    expect(days.map((d) => d.day)).toEqual(["2026-10-24", "2026-10-23"]);
    expect(days[0].cards.map(cardLine)).toEqual(["3:42 pm · DO do:1 · POD · 1 photo, 1 video", "11:00 am · Defect: tile crack · Before / After · 2 photos"]);
    expect(dayTitle("2026-10-24", "2026-10-24")).toBe("Today · 24 Oct");
    expect(dayTitle("2026-10-23", "2026-10-24")).toBe("Yesterday · 23 Oct");
    expect(dayTitle("2025-12-03", "2026-10-24")).toBe("3 Dec 2025");
  });
});
