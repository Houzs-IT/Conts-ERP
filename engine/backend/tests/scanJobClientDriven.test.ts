// @vitest-project light
// Conts: scan jobs run inside a request the screen holds open (POST .../jobs/:id/work), never in ctx.waitUntil, which
// Cloudflare cancels ~30 s after the reply (Hookka #485 / 87fc435a9). The engine has no Queue and no cron, so this is
// the only way a 60-110 s OCR run can finish. These tests pin the stall rule, the claim / retry behaviour and the
// no-waitUntil rule in the three scan routes.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  SCAN_JOB_STALE_MS,
  isStalledScanJob,
  claimScanJobForWork,
  requeueScanJob,
  workScanJob,
} from "../src/scm/lib/scan-job-drive";

type Row = Record<string, unknown>;

/** A tiny in-memory stand-in for the PostgREST builder: eq / in / or(status...) filters, update / select / delete. */
function fakeSvc(rows: Row[]) {
  const calls: string[] = [];
  const from = (_table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let patch: Row | null = null;
    const q: Record<string, unknown> = {};
    const matching = () => rows.filter((r) => filters.every((f) => f(r)));
    Object.assign(q, {
      update(p: Row) { patch = p; calls.push("update"); return q; },
      select() { return q; },
      eq(col: string, v: unknown) { filters.push((r) => r[col] === v); return q; },
      in(col: string, vs: unknown[]) { filters.push((r) => vs.includes(r[col])); return q; },
      or(expr: string) {
        // Only the claim's shape: status.eq.queued,and(status.eq.running,updated_at.lt.<iso>)
        const cutoff = /updated_at\.lt\.([^)]+)\)/.exec(expr)?.[1] ?? "";
        filters.push((r) => r.status === "queued" || (r.status === "running" && String(r.updated_at) < cutoff));
        return q;
      },
      limit() { return q; },
      async maybeSingle() { return { data: matching()[0] ?? null, error: null }; },
      then(resolve: (v: { data: Row[]; error: null }) => unknown) {
        const hit = matching();
        if (patch) for (const r of hit) Object.assign(r, patch);
        return Promise.resolve({ data: hit.map((r) => ({ id: r.id })), error: null }).then(resolve);
      },
    });
    return q;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test double
  return { svc: { from } as any, calls };
}

const NOW = Date.parse("2026-11-08T10:00:00Z");
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe("stall rule", () => {
  it("a queued or running job untouched past the window is stalled; a fresh one, done or error is not", () => {
    expect(isStalledScanJob("running", iso(SCAN_JOB_STALE_MS + 1000), NOW)).toBe(true);
    expect(isStalledScanJob("queued", iso(SCAN_JOB_STALE_MS + 1000), NOW)).toBe(true);
    expect(isStalledScanJob("running", iso(60_000), NOW)).toBe(false);
    expect(isStalledScanJob("done", iso(SCAN_JOB_STALE_MS * 10), NOW)).toBe(false);
    expect(isStalledScanJob("error", iso(SCAN_JOB_STALE_MS * 10), NOW)).toBe(false);
  });
});

describe("claim for /work", () => {
  it("claims a queued job once: a second screen driving the same job gets nothing", async () => {
    const rows = [{ id: "j1", status: "queued", document_type: "PI", company_id: 1, updated_at: iso(1000) }];
    const { svc } = fakeSvc(rows);
    expect(await claimScanJobForWork(svc, "j1", 1, "PI", NOW)).toBe(true);
    expect(rows[0].status).toBe("running");
    expect(await claimScanJobForWork(svc, "j1", 1, "PI", NOW)).toBe(false);
  });

  it("takes over a running job only once it has stalled", async () => {
    const live = [{ id: "j2", status: "running", document_type: "SO", company_id: 1, updated_at: iso(30_000) }];
    expect(await claimScanJobForWork(fakeSvc(live).svc, "j2", 1, "SO", NOW)).toBe(false);
    const dead = [{ id: "j3", status: "running", document_type: "SO", company_id: 1, updated_at: iso(SCAN_JOB_STALE_MS + 5000) }];
    expect(await claimScanJobForWork(fakeSvc(dead).svc, "j3", 1, "SO", NOW)).toBe(true);
  });

  it("never claims another company's job or another document type", async () => {
    const rows = [{ id: "j4", status: "queued", document_type: "GR", company_id: 2, updated_at: iso(1000) }];
    expect(await claimScanJobForWork(fakeSvc(rows).svc, "j4", 1, "GR", NOW)).toBe(false);
    expect(await claimScanJobForWork(fakeSvc(rows).svc, "j4", 2, "SO", NOW)).toBe(false);
  });
});

describe("workScanJob", () => {
  it("runs the job inside the request and answers with the row afterwards", async () => {
    const rows: Row[] = [{ id: "j5", status: "queued", document_type: "GR", company_id: 1, updated_at: iso(1000) }];
    const { svc } = fakeSvc(rows);
    const { ran, job } = await workScanJob({}, svc, "j5", 1, "GR", async () => { rows[0].status = "done"; });
    expect(ran).toBe(true);
    expect(job?.status).toBe("done");
  });

  it("does not run when a queue is bound (the queue consumer owns every attempt)", async () => {
    const rows: Row[] = [{ id: "j6", status: "queued", document_type: "SO", company_id: 1, updated_at: iso(1000) }];
    let runs = 0;
    const { ran } = await workScanJob({ SCAN_QUEUE: {} }, fakeSvc(rows).svc, "j6", 1, "SO", async () => { runs += 1; });
    expect(ran).toBe(false);
    expect(runs).toBe(0);
  });

  it("a run that throws leaves the job in error with a plain sentence, never stuck running", async () => {
    const rows: Row[] = [{ id: "j7", status: "queued", document_type: "PI", company_id: 1, updated_at: iso(1000) }];
    const { job } = await workScanJob({}, fakeSvc(rows).svc, "j7", 1, "PI", async () => { throw new Error("boom"); });
    expect(job?.status).toBe("error");
    expect(String(job?.error)).toMatch(/Retry/);
  });
});

describe("retry from the screen", () => {
  it("puts a failed job with kept photos back in the queue", async () => {
    const rows: Row[] = [{ id: "r1", status: "error", document_type: "SO", company_id: 1, image_keys: ["scan-jobs/r1/0"], retry_count: 1, error: "x", updated_at: iso(1000) }];
    expect(await requeueScanJob(fakeSvc(rows).svc, "r1", 1, "SO", NOW)).toBe("requeued");
    expect(rows[0]).toMatchObject({ status: "queued", retry_count: 0, error: null });
  });

  it("puts a stalled job back; refuses a live one and one without photos", async () => {
    const stalled: Row[] = [{ id: "r2", status: "running", document_type: "GR", company_id: 1, image_keys: ["k"], updated_at: iso(SCAN_JOB_STALE_MS + 1) }];
    expect(await requeueScanJob(fakeSvc(stalled).svc, "r2", 1, "GR", NOW)).toBe("requeued");
    const live: Row[] = [{ id: "r3", status: "running", document_type: "GR", company_id: 1, image_keys: ["k"], updated_at: iso(1000) }];
    expect(await requeueScanJob(fakeSvc(live).svc, "r3", 1, "GR", NOW)).toBe("busy");
    const noPhotos: Row[] = [{ id: "r4", status: "error", document_type: "PI", company_id: 1, image_keys: [], updated_at: iso(1000) }];
    expect(await requeueScanJob(fakeSvc(noPhotos).svc, "r4", 1, "PI", NOW)).toBe("not_replayable");
  });
});

describe("no waitUntil in the scan routes' job paths", () => {
  const read = (f: string) => readFileSync(path.join(__dirname, "../src/scm/routes", f), "utf8");
  for (const f of ["scan-pi.ts", "scan-gr.ts"]) {
    it(`${f} never hands a pipeline to waitUntil and offers /work and /retry`, () => {
      const src = read(f);
      expect(src).not.toMatch(/executionCtx\.waitUntil\(/);
      expect(src).toMatch(/\.post\('\/jobs\/:id\/work'/);
      expect(src).toMatch(/\.post\('\/jobs\/:id\/retry'/);
    });
  }
  it("scan-so.ts keeps waitUntil only for the best-effort rule distillation", () => {
    const src = read("scan-so.ts");
    const uses = src.match(/executionCtx\.waitUntil\(([a-zA-Z]+)\)/g) ?? [];
    expect(uses).toEqual(["executionCtx.waitUntil(distillPromise)"]);
    expect(src).toMatch(/scanSo\.post\('\/jobs\/:id\/work'/);
    expect(src).toMatch(/scanSo\.post\('\/jobs\/:id\/retry'/);
  });
});
