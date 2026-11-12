import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { requireAnyAccess } from "./auth";

const callAs = async (user: { permissions: string[]; page_access: Record<string, string> }, pages: string[], keys: string[] = []) => {
  const app = new Hono();
  app.use("*", async (c, next) => { c.set("user" as never, user as never); await next(); });
  app.get("/", requireAnyAccess(pages, keys) as never, (c) => c.text(String(c.get("access_level" as never))));
  const response = await app.request("/");
  return { status: response.status, level: await response.text() };
};

describe("requireAnyAccess", () => {
  it("lets any one of the pages through, at the best level reached", async () => {
    expect(await callAs({ permissions: [], page_access: { "projects.list": "none", "projects.handover": "view" } }, ["projects.list", "projects.handover"]))
      .toEqual({ status: 200, level: "view" });
    expect(await callAs({ permissions: [], page_access: { "projects.list": "edit", "projects.handover": "full" } }, ["projects.list", "projects.handover"]))
      .toEqual({ status: 200, level: "full" });
  });

  it("lets a permission key through when no page is open", async () => {
    expect(await callAs({ permissions: ["service_cases.read"], page_access: {} }, ["service_cases.metrics"], ["service_cases.read"]))
      .toEqual({ status: 200, level: "partial" });
  });

  it("refuses with no page and no key", async () => {
    expect((await callAs({ permissions: ["projects.read"], page_access: { "projects.list": "none" } }, ["projects.list"], ["service_cases.read"])).status)
      .toBe(403);
  });

  it("lets the * owner through at full", async () => {
    expect(await callAs({ permissions: ["*"], page_access: {} }, ["projects.list"])).toEqual({ status: 200, level: "full" });
  });
});
