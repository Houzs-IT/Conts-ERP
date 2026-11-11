// The AI usage recorder and report (Houzs aiUsage.test.ts, fitted to Conts: no agent back-fill, a read rate per
// feature, one company per report). No real Anthropic call: responses are built by hand.
import { describe, expect, it, vi } from "vitest";
import {
  aiUsageRow,
  buildAiUsageReport,
  costUsd,
  lastMonths,
  loadAiUsageReport,
  recordAi,
  recordAiError,
  recordAiResponse,
  requestAiTag,
  usdToRm,
  type AiUsageTag,
  type EventAggRow,
} from "./aiUsage";
import { USD_TO_MYR_EST } from "./agent-console";
import { extractOneBill } from "../acc/bill-extract";
import type { Env } from "../types";

const zero = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
const tag = { feature: "bill_extract", model: "claude-sonnet-5-5", companyId: 1, userId: 7 };

describe("AI usage cost maths", () => {
  it("prices each token kind once at the Sonnet 5.5 rates", () => {
    expect(costUsd("claude-sonnet-5-5", { ...zero, inputTokens: 1_000_000 })).toBe(2);
    expect(costUsd("claude-sonnet-5-5", { ...zero, outputTokens: 1_000_000 })).toBe(10);
    expect(costUsd("claude-sonnet-5-5", { ...zero, cacheReadTokens: 1_000_000 })).toBeCloseTo(0.2);
    expect(costUsd("claude-sonnet-5-5", { ...zero, cacheWriteTokens: 1_000_000 })).toBe(2.5);
  });

  it("prices an unknown model at the dearer default (Sonnet 4.6), so it reads high, not low", () => {
    expect(costUsd("some-future-model", { ...zero, inputTokens: 1_000_000 })).toBe(3);
  });

  it("converts with agent-console's rate", () => {
    expect(usdToRm(10)).toBeCloseTo(10 * USD_TO_MYR_EST);
  });
});

describe("aiUsageRow", () => {
  it("reads the usage block of a success", () => {
    const body = JSON.stringify({
      model: "claude-sonnet-5-5",
      content: [],
      usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 40 },
    });
    expect(aiUsageRow(tag, 200, body)).toEqual({
      feature: "bill_extract", company_id: 1, user_id: 7, model: "claude-sonnet-5-5",
      input_tokens: 10, output_tokens: 20, cache_read_tokens: 30, cache_write_tokens: 40,
      ok: true, error: null, http_status: 200,
    });
  });

  it("records an HTTP error with its Anthropic error text", () => {
    const row = aiUsageRow(tag, 529, JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }));
    expect(row.ok).toBe(false);
    expect(row.error).toBe("overloaded_error: Overloaded");
    expect(row.http_status).toBe(529);
    expect(row.input_tokens).toBe(0);
  });

  it("records a thrown fetch with no status and a trimmed message", () => {
    const row = aiUsageRow(tag, null, new Error("x".repeat(900)));
    expect(row.ok).toBe(false);
    expect(row.http_status).toBeNull();
    expect(row.error!.length).toBe(500);
  });

  it("treats a non-JSON 200 as a failure", () => {
    const row = aiUsageRow(tag, 200, "<html>gateway</html>");
    expect(row.ok).toBe(false);
    expect(row.error).toBe("<html>gateway</html>");
  });
});

describe("recorder never throws into the caller", () => {
  const env = { DATABASE_URL: "" } as unknown as Env;
  const full: AiUsageTag = { env, ...tag, waitUntil: null };

  it("leaves the caller's body readable and resolves", async () => {
    const resp = new Response(JSON.stringify({ usage: { input_tokens: 1 } }), { status: 200 });
    await expect(recordAiResponse(full, resp)).resolves.toBeUndefined();
    expect(await resp.json()).toEqual({ usage: { input_tokens: 1 } });
  });

  it("survives a response-like mock with no clone() and a throwing waitUntil", async () => {
    const waitUntil = vi.fn(() => { throw new Error("no ctx"); });
    await expect(recordAiResponse({ ...full, waitUntil }, { status: 200 } as Response)).resolves.toBeUndefined();
    await expect(recordAiError({ ...full, waitUntil }, new Error("boom"))).resolves.toBeUndefined();
  });

  it("hands the write to waitUntil when there is one", async () => {
    const waitUntil = vi.fn();
    await recordAiError({ ...full, waitUntil }, new Error("boom"));
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });

  it("a null tag records nothing", async () => {
    await expect(recordAiResponse(null, new Response("{}"))).resolves.toBeUndefined();
  });
});

// A stub env.DB: the recorder writes through the invocation's own client, never its own.
function stubEnv() {
  const run = vi.fn(async () => ({}));
  const bind = vi.fn((..._args: unknown[]) => ({ run }));
  const prepare = vi.fn((_sql: string) => ({ bind }));
  const env = { DATABASE_URL: "postgres://stub", DB: { prepare } } as unknown as Env;
  return { env, prepare, bind };
}

describe("recordAi", () => {
  it("returns the caller's response untouched and writes one row through the invocation's DB", async () => {
    const { env, prepare, bind } = stubEnv();
    const resp = new Response(JSON.stringify({ model: "claude-sonnet-5-5", usage: { input_tokens: 5, output_tokens: 7 } }), { status: 200 });
    const out = await recordAi({ env, ...tag, waitUntil: null }, Promise.resolve(resp));
    expect(out).toBe(resp);
    expect(await out.json()).toMatchObject({ usage: { input_tokens: 5 } });
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare.mock.calls[0][0]).toMatch(/INSERT INTO public\.ai_usage_events/);
    expect(bind).toHaveBeenCalledWith("bill_extract", 1, 7, "claude-sonnet-5-5", 5, 7, 0, 0, true, null, 200);
  });

  it("rethrows a failed fetch after recording it once", async () => {
    const { env, prepare, bind } = stubEnv();
    const boom = new TypeError("network down");
    await expect(recordAi({ env, ...tag, waitUntil: null }, Promise.reject(boom))).rejects.toBe(boom);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(bind.mock.calls[0]).toEqual(["bill_extract", 1, 7, "claude-sonnet-5-5", 0, 0, 0, 0, false, "TypeError: network down", null]);
  });

  it("a failed insert is swallowed, not thrown", async () => {
    const env = { DATABASE_URL: "postgres://stub", DB: { prepare: () => { throw new Error("db down"); } } } as unknown as Env;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const resp = new Response("{}", { status: 200 });
    await expect(recordAi({ env, ...tag, waitUntil: null }, Promise.resolve(resp))).resolves.toBe(resp);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("the bill reader records its call", () => {
  it("one bill read = one bill_extract row with the response's tokens; the extraction is unchanged", async () => {
    const { env, bind } = stubEnv();
    const fakeFetch = vi.fn(async () => new Response(JSON.stringify({
      model: "claude-sonnet-5-5",
      content: [{ type: "text", text: '{"vendorName":"TNB","totalRm":12.5}' }],
      usage: { input_tokens: 1200, output_tokens: 80 },
    }), { status: 200 })) as unknown as typeof fetch;
    const r = await extractOneBill("k", [{ name: "a.png", mime: "image/png", dataBase64: "AAAA" }], { env, ...tag, waitUntil: null }, fakeFetch);
    expect(r).toMatchObject({ ok: true, extraction: { vendorName: "TNB", totalSen: 1250 } });
    expect(bind).toHaveBeenCalledWith("bill_extract", 1, 7, "claude-sonnet-5-5", 1200, 80, 0, 0, true, null, 200);
    const sent = JSON.parse(String((fakeFetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0][1].body));
    expect(sent.model).toBe("claude-sonnet-5-5");
  });

  it("a refused read is recorded as a failure", async () => {
    const { env, bind } = stubEnv();
    const fakeFetch = vi.fn(async () => new Response(JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "slow down" } }), { status: 429 })) as unknown as typeof fetch;
    const r = await extractOneBill("k", [{ name: "a.png", mime: "image/png", dataBase64: "AAAA" }], { env, ...tag, waitUntil: null }, fakeFetch);
    expect(r.ok).toBe(false);
    expect(bind.mock.calls[0]).toEqual(["bill_extract", 1, 7, "claude-sonnet-5-5", 0, 0, 0, 0, false, "rate_limit_error: slow down", 429]);
  });
});

describe("requestAiTag", () => {
  it("takes the active company and the engine user; a forwarded claims caller has no numeric id", () => {
    const vars: Record<string, unknown> = { companyId: 3, houzsUser: { id: 11 }, user: { id: "system" } };
    const c = { env: {} as Env, get: (k: string) => vars[k], get executionCtx(): never { throw new Error("no ctx"); } };
    const t = requestAiTag(c as never, "request_bill", "claude-sonnet-5-5");
    expect(t).toMatchObject({ feature: "request_bill", model: "claude-sonnet-5-5", companyId: 3, userId: 11, waitUntil: null });
    const anon = requestAiTag({ env: {} as Env, get: (k: string) => (k === "staff" ? { userId: "u-1" } : undefined), executionCtx: { waitUntil: () => {} } } as never, "claim_receipt", "m");
    expect(anon.userId).toBeNull();
  });
});

describe("month bucketing", () => {
  it("lists MYT months oldest first", () => {
    expect(lastMonths(new Date("2026-10-05T00:00:00Z"), 3)).toEqual(["2026-08", "2026-09", "2026-10"]);
  });

  it("uses the MYT month, not UTC, across the year end", () => {
    expect(lastMonths(new Date("2026-12-31T16:30:00Z"), 2)).toEqual(["2026-12", "2027-01"]);
  });
});

describe("buildAiUsageReport", () => {
  const ev = (month: string, feature: string, calls: number, failures: number, inputTokens: number): EventAggRow => ({
    month, feature, model: "claude-sonnet-5-5", calls, failures, ...zero, inputTokens,
  });

  it("the first recorded month is partial with its start date; a later month is whole", () => {
    const report = buildAiUsageReport({
      months: ["2026-10", "2026-11", "2026-12"],
      // 2026-10-31 17:00 UTC = 1 Nov MYT, so November is the first recorded month.
      firstRecordedAt: "2026-10-31T17:00:00.000Z",
      events: [ev("2026-11", "bill_extract", 10, 1, 1_000_000), ev("2026-12", "bill_extract", 4, 0, 1_000_000), ev("2026-12", "utility_bill_read", 2, 1, 0)],
    });
    const [oct, nov, dec] = report.months;
    expect(oct).toMatchObject({ partial: true, totalRm: 0, calls: 0, readRatePct: null, note: "Nothing was recorded yet this month." });
    expect(nov).toMatchObject({ partial: true, calls: 10, failures: 1, readRatePct: 90, totalRm: 9.4 });
    expect(nov.note).toBe("Recording started on 2026-11-01; earlier calls this month are not counted.");
    expect(dec).toMatchObject({ partial: false, note: null, calls: 6, failures: 1, readRatePct: 83.3 });
    expect(dec.features.map((f) => [f.feature, f.label, f.readRatePct])).toEqual([
      ["bill_extract", "Scan bills (payment vouchers, AP invoices)", 100],
      ["utility_bill_read", "Utility bills", 50],
    ]);
  });

  it("sums one feature across models", () => {
    const report = buildAiUsageReport({
      months: ["2026-11"],
      firstRecordedAt: "2026-10-02T00:00:00.000Z",
      events: [ev("2026-11", "bill_extract", 2, 1, 1_000_000), { ...ev("2026-11", "bill_extract", 2, 1, 1_000_000), model: "claude-sonnet-4-6" }],
    });
    const [nov] = report.months;
    expect(nov.features).toHaveLength(1);
    expect(nov.features[0]).toMatchObject({ calls: 4, failures: 2, readRatePct: 50, rm: 23.5 });
  });
});

describe("loadAiUsageReport", () => {
  it("reads one company's window and builds the report", async () => {
    const calls: Array<{ sql: string; args: unknown[] }> = [];
    const db = {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => {
          calls.push({ sql, args });
          return {
            first: async () => ({ first: "2026-11-02T01:00:00.000Z" }),
            all: async () => ({ results: [{ month: "2026-11", feature: "bill_extract", model: "claude-sonnet-5-5", calls: "3", failures: "0", input_tokens: "3000", output_tokens: "300", cache_read_tokens: "0", cache_write_tokens: "0" }] }),
          };
        },
      }),
    } as unknown as Env["DB"];
    const r = await loadAiUsageReport(db, 1, 2, new Date("2026-11-10T00:00:00Z"));
    expect(calls.every((c) => c.args[0] === 1)).toBe(true);
    expect(calls[1].args.slice(1)).toEqual(["2026-09-30T16:00:00.000Z", "2026-11-30T16:00:00.000Z"]);
    expect(r.months.map((m) => m.month)).toEqual(["2026-10", "2026-11"]);
    expect(r.months[1]).toMatchObject({ calls: 3, readRatePct: 100 });
  });
});
