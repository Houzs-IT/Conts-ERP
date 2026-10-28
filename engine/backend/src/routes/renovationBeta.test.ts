/* Beta answers are per user and per company, so every GET under /api/beta/* must say "private, no-cache" and vary on the
   headers that pick the user and the company. A shared cache holding one user's board would show it to the next user.
   index.ts puts the headers on the /api/beta/* PREFIX, so a route added later is covered without its author remembering.
   `app.request()` through the real app stops at the auth gate, so this drives the same two middlewares on a small app and
   then proves the real app mounts them behind the gate. */
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { etag } from "hono/etag";
import { app as realApp, betaCacheHeaders } from "../index";
import { auth } from "../middleware/auth";

function betaApp(): Hono {
  const app = new Hono();
  app.use("/api/beta/*", etag());
  app.use("/api/beta/*", betaCacheHeaders);
  app.get("/api/beta/board", (c) => c.json({ projects: [] }));
  app.get("/api/beta/projects/:id/workspace", (c) => c.json({ id: c.req.param("id") }));
  // A route added later, in a different file, with no cache code of its own.
  app.get("/api/beta/projects/:id/later", (c) => c.json({ later: true }));
  app.get("/api/beta/missing", (c) => c.json({ error: "not_found" }, 404));
  app.put("/api/beta/events/1", (c) => c.json({ ok: true }));
  return app;
}

function expectPrivate(res: Response): void {
  expect(res.headers.get("Cache-Control")).toBe("private, no-cache");
  const vary = (res.headers.get("Vary") ?? "").toLowerCase();
  expect(vary).toContain("authorization");
  expect(vary).toContain("x-company-id");
}

describe("Beta GET responses are private and revalidated", () => {
  it.each(["/api/beta/board", "/api/beta/projects/7/workspace", "/api/beta/projects/7/later"])("%s", async (path) => {
    const res = await betaApp().request(path);
    expect(res.status).toBe(200);
    expectPrivate(res);
    expect(res.headers.get("ETag")).toBeTruthy();
  });

  it("an unchanged answer comes back as a 304 that keeps Cache-Control and Vary", async () => {
    const app = betaApp();
    const first = await app.request("/api/beta/board");
    const tag = first.headers.get("ETag") ?? "";
    expect(tag).not.toBe("");

    const second = await app.request("/api/beta/board", { headers: { "If-None-Match": tag } });
    expect(second.status).toBe(304);
    expect(await second.text()).toBe("");
    expectPrivate(second);
  });

  it("a different answer does not match an old ETag", async () => {
    const app = betaApp();
    const tag = (await app.request("/api/beta/projects/7/workspace")).headers.get("ETag") ?? "";
    const other = await app.request("/api/beta/projects/8/workspace", { headers: { "If-None-Match": tag } });
    expect(other.status).toBe(200);
  });

  it("errors and writes get no cache headers", async () => {
    const app = betaApp();
    const missing = await app.request("/api/beta/missing");
    expect(missing.status).toBe(404);
    expect(missing.headers.get("Cache-Control")).toBeNull();
    const write = await app.request("/api/beta/events/1", { method: "PUT" });
    expect(write.headers.get("Cache-Control")).toBeNull();
  });
});

describe("index.ts mounts the Beta cache headers on the prefix, behind the auth gate", () => {
  it("etag() and betaCacheHeaders are both registered on /api/beta/* after auth", () => {
    const gate = realApp.routes.findIndex((r) => r.handler === auth);
    expect(gate, "app.use('/api/*', auth) not found in app.routes").toBeGreaterThan(-1);
    const onPrefix = realApp.routes
      .map((r, index) => ({ r, index }))
      .filter(({ r }) => r.path === "/api/beta/*");
    const headers = onPrefix.find(({ r }) => r.handler === betaCacheHeaders);
    const tagger = onPrefix.find(({ r }) => r.handler.name === "etag");
    expect(headers, "betaCacheHeaders is not mounted on /api/beta/*").toBeDefined();
    expect(tagger, "etag() is not mounted on /api/beta/*").toBeDefined();
    expect(headers?.index).toBeGreaterThan(gate);
    expect(tagger?.index).toBeGreaterThan(gate);
    // etag outermost, so its 304 is built after the headers are on the response.
    expect(tagger?.index).toBeLessThan(headers?.index ?? -1);
  });
});
