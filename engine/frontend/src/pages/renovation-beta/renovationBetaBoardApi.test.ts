import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { buildQueryKey } from "../../hooks/useQuery";
import { boardKey, invalidateBeta, projectBoardFromHome, type BetaBoard, type BetaBoardEvent, type BetaBoardProject } from "./renovationBetaBoardApi";

function project(id: number): BetaBoardProject {
  return {
    id, code: null, name: `P${id}`, building: null, unitNo: null, customerName: null, salesName: null, createdOn: null, handoverOn: null,
    lead: null, person3d: null, person2d: null, sitePic: null, measuredOn: null, start3dOn: null, start2dOn: null, poDoneOn: null,
    files: [], notes: [], reviews: [], appointments: [], payment: { state: "none" },
  };
}

function event(id: number, projectId: number | null): BetaBoardEvent {
  return { id, projectId, onDate: "2026-10-28", atTime: null, type: "client", note: null, personId: null, done: false };
}

const home: BetaBoard = {
  today: "2026-10-28",
  mePersonId: null,
  settings: { design3dDays: 7, design2dDays: 7, amendmentDays: 3 },
  people: [],
  projects: [project(1), project(2)],
  events: [event(10, 1), event(11, 2), event(12, null)],
};

const homeKey = buildQueryKey(boardKey());

describe("projectBoardFromHome", () => {
  it("is undefined when Home was never loaded", () => {
    expect(projectBoardFromHome(new QueryClient(), 1)).toBeUndefined();
  });

  it("is undefined when Home does not list the project, so the real fetch answers", () => {
    const qc = new QueryClient();
    qc.setQueryData(homeKey, home);
    expect(projectBoardFromHome(qc, 99)).toBeUndefined();
  });

  it("cuts Home to the one project and its own events, and takes the age from Home", () => {
    const qc = new QueryClient();
    qc.setQueryData(homeKey, home, { updatedAt: 123_456 });
    const seed = projectBoardFromHome(qc, 1);
    expect(seed?.data.projects.map((p) => p.id)).toEqual([1]);
    expect(seed?.data.events.map((e) => e.id)).toEqual([10]);
    expect(seed?.at).toBe(123_456);
  });

  it("seeds a Home answer that a write invalidated as stale, never as fresh", async () => {
    const qc = new QueryClient();
    qc.setQueryData(homeKey, home);
    await invalidateBeta(qc);
    expect(projectBoardFromHome(qc, 1)?.at).toBe(1);
  });
});
