// D22 (save-integrity, 22 Nov 2026): a write through api.post/patch/put/del marks the hooks/useQuery reads stale and
// drops the read cache, including reads of another resource (project archive -> renovation board).
import { describe, expect, test } from "vitest";
import { queryClient } from "./queryClient";
import { getCached, invalidateForMutation, setCached } from "../api/cache";

describe("a plain api write refreshes the hooks/useQuery reads", () => {
  test("archiving a project marks the renovation board read stale and drops its cached copy", () => {
    queryClient.setQueryData(["uq", "renovation", "board-rows", "live"], { data: [] });
    queryClient.setQueryData(["grn-detail", "g-1"], { id: "g-1" });
    setCached("/api/renovation/board-rows", { data: [] });
    invalidateForMutation("/api/projects/7/archive");
    expect(queryClient.getQueryState(["uq", "renovation", "board-rows", "live"])?.isInvalidated).toBe(true);
    expect(getCached("/api/renovation/board-rows")).toBeUndefined();
    expect(queryClient.getQueryState(["grn-detail", "g-1"])?.isInvalidated).toBe(false);
  });

  test("a presence heartbeat refreshes nothing", () => {
    queryClient.setQueryData(["uq", "/api/users"], []);
    setCached("/api/users", []);
    invalidateForMutation("/api/presence/heartbeat");
    expect(queryClient.getQueryState(["uq", "/api/users"])?.isInvalidated).toBe(false);
    expect(getCached("/api/users")).toEqual([]);
  });
});
