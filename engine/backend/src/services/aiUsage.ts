// ---------------------------------------------------------------------------
// aiUsage.ts — one row per Anthropic call into public.ai_usage_events, and the
// monthly cost / read-rate report the "AI usage" screen reads
// (scm/routes/ai-usage.ts). Ported from Houzs services/aiUsage.ts (#4700),
// fitted to Conts: no agent_runs back-fill (Conts never ran the agents), and
// the report is the active company's, not IT-wide.
//
// Recording is fire-and-forget by contract: nothing here may throw into a call
// site or change what it returns. Each site records right after its fetch
// (recordAiResponse / recordAiError, or `await recordAi(tag, fetch(...))`). The
// body is read from a clone, so the caller's own read is untouched.
// ---------------------------------------------------------------------------
import type { Env } from "../types";
import { resolveDatabaseUrl } from "../db/pg";
import { activeCompanyId, type CompanyScopeCtx } from "../scm/lib/companyScope";
import { USD_TO_MYR_EST, mytDate, mytMonth, mytMonthRangeUtc } from "./agent-console";

// ── Prices ───────────────────────────────────────────────────────────────────
// USD per million tokens (Houzs's table, Anthropic's price list as of 2026-10).
// UPDATE THIS when a call site changes model; a model missing here is priced
// as DEFAULT_PRICE_MODEL, the dearer one, so an unknown model reads high, not
// low. cacheWrite is the 5-minute TTL price.
export interface ModelPrice { input: number; output: number; cacheRead: number; cacheWrite: number }
export const AI_PRICES_USD_PER_MTOK: Record<string, ModelPrice> = {
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
};
const DEFAULT_PRICE_MODEL = "claude-sonnet-4-6";

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** Anthropic reports input, cache-read and cache-write tokens as DISJOINT
 *  counts (input_tokens excludes both cache kinds), so each is priced once. */
export function costUsd(model: string, t: TokenCounts): number {
  const p = AI_PRICES_USD_PER_MTOK[model] ?? AI_PRICES_USD_PER_MTOK[DEFAULT_PRICE_MODEL];
  return (
    (t.inputTokens * p.input +
      t.outputTokens * p.output +
      t.cacheReadTokens * p.cacheRead +
      t.cacheWriteTokens * p.cacheWrite) /
    1_000_000
  );
}

export function usdToRm(usd: number): number {
  return usd * USD_TO_MYR_EST;
}

/** What each recorded feature is called on the screen. A feature missing here
 *  shows its stored name. */
export const AI_FEATURE_LABELS: Record<string, string> = {
  bill_extract: "Scan bills (payment vouchers, AP invoices)",
  claim_receipt: "Receipt read (My claims)",
  request_bill: "Bill read (payment requests)",
  utility_bill_read: "Utility bills",
};

// ── Recorder ─────────────────────────────────────────────────────────────────

export interface AiUsageTag {
  env: Env;
  feature: string;
  model: string;
  companyId: number | null;
  userId: number | null;
  /** The request's waitUntil (waitUntilOf(c)); null means the write is awaited
   *  by whoever awaits the record call. */
  waitUntil: ((p: Promise<unknown>) => void) | null;
}

/** Hono's executionCtx getter THROWS when there is no ExecutionContext (tests,
 *  some internal calls), so read it defensively. */
export function waitUntilOf(c: { readonly executionCtx: { waitUntil(p: Promise<unknown>): void } }): AiUsageTag["waitUntil"] {
  try {
    const ctx = c.executionCtx;
    return (p) => ctx.waitUntil(p);
  } catch {
    return null;
  }
}

/** Tag for a call made inside a request: the active company and the engine
 *  user behind it (houzsUser in /api/scm, where `user` is a shared system row).
 *  A Property OS staff member forwarded through claims has no numeric engine
 *  id, so userId is null there. */
export function requestAiTag(
  c: CompanyScopeCtx & { env: Env; readonly executionCtx: { waitUntil(p: Promise<unknown>): void } },
  feature: string,
  model: string,
): AiUsageTag {
  const idOf = (key: string): number | null => {
    const v = (c.get(key) as { id?: unknown } | undefined)?.id;
    return typeof v === "number" ? v : null;
  };
  let companyId: number | null = null;
  try { companyId = activeCompanyId(c) ?? null; } catch { companyId = null; }
  return {
    env: c.env,
    feature,
    model,
    companyId,
    userId: idOf("houzsUser") ?? idOf("user"),
    waitUntil: waitUntilOf(c),
  };
}

/** One public.ai_usage_events row, as written (id and created_at are defaults). */
export interface AiUsageRow {
  feature: string;
  company_id: number | null;
  user_id: number | null;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  ok: boolean;
  error: string | null;
  http_status: number | null;
}

const ERROR_MAX = 500;

/** Pure: what one call writes. `body` is the raw response text, an already
 *  parsed object, or the thrown error when `httpStatus` is null. */
export function aiUsageRow(
  tag: Pick<AiUsageTag, "feature" | "model" | "companyId" | "userId">,
  httpStatus: number | null,
  body: unknown,
): AiUsageRow {
  let json: Record<string, unknown> | null = null;
  if (typeof body === "string") {
    try {
      const v: unknown = JSON.parse(body);
      if (v && typeof v === "object") json = v as Record<string, unknown>;
    } catch {
      /* not JSON: recorded as the error text below */
    }
  } else if (body && typeof body === "object" && !(body instanceof Error)) {
    json = body as Record<string, unknown>;
  }
  const apiError = json?.error as { type?: string; message?: string } | undefined;
  const ok = httpStatus !== null && httpStatus >= 200 && httpStatus < 300 && json !== null && !apiError;
  const usage = (json?.usage ?? {}) as Record<string, unknown>;
  const n = (k: string) => Math.max(0, Math.round(Number(usage[k]) || 0));

  let error: string | null = null;
  if (!ok) {
    if (apiError) error = `${apiError.type ?? "error"}: ${apiError.message ?? ""}`;
    else if (body instanceof Error) error = `${body.name}: ${body.message}`;
    else if (typeof body === "string" && body.trim()) error = body.trim();
    else error = httpStatus === null ? "request failed" : `HTTP ${httpStatus}`;
    error = error.slice(0, ERROR_MAX);
  }

  return {
    feature: tag.feature,
    company_id: tag.companyId,
    user_id: tag.userId,
    model: typeof json?.model === "string" ? json.model : tag.model,
    input_tokens: n("input_tokens"),
    output_tokens: n("output_tokens"),
    cache_read_tokens: n("cache_read_input_tokens"),
    cache_write_tokens: n("cache_creation_input_tokens"),
    ok,
    error,
    http_status: httpStatus,
  };
}

async function insertRow(env: Env, row: AiUsageRow): Promise<void> {
  // No Postgres configured (vitest pins DATABASE_URL to ""): nothing to record to.
  if (!resolveDatabaseUrl(env as { HYPERDRIVE?: { connectionString: string }; DATABASE_URL?: string })) return;
  // Through the invocation's own env.DB, NOT a fresh client per row (one socket
  // per row would pass the Worker's open-connection cap on a 12-bill batch).
  await env.DB.prepare(
    `INSERT INTO public.ai_usage_events
       (feature, company_id, user_id, model, input_tokens, output_tokens,
        cache_read_tokens, cache_write_tokens, ok, error, http_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      row.feature, row.company_id, row.user_id, row.model,
      row.input_tokens, row.output_tokens, row.cache_read_tokens, row.cache_write_tokens,
      row.ok, row.error, row.http_status,
    )
    .run();
}

function schedule(tag: AiUsageTag, row: Promise<AiUsageRow>): Promise<void> {
  const work = row
    .then((r) => insertRow(tag.env, r))
    .catch((e: unknown) => {
      console.warn(`[ai-usage] ${tag.feature} not recorded:`, e instanceof Error ? e.message : e);
    });
  if (tag.waitUntil) {
    try {
      tag.waitUntil(work);
      return Promise.resolve();
    } catch {
      /* fall through: the caller's await covers it */
    }
  }
  return work;
}

/** Record one Anthropic response. Call right after the fetch, before the caller
 *  reads the body. Never rejects. A null tag (tests) records nothing. */
export function recordAiResponse(tag: AiUsageTag | null | undefined, resp: Response): Promise<void> {
  if (!tag) return Promise.resolve();
  try {
    const copy = resp.clone();
    return schedule(tag, copy.text().then(
      (t) => aiUsageRow(tag, resp.status, t),
      (e: unknown) => aiUsageRow(tag, resp.status, e),
    ));
  } catch (e) {
    return schedule(tag, Promise.resolve(aiUsageRow(tag, (resp as Response | undefined)?.status ?? null, e)));
  }
}

/** Record a call whose fetch threw (network error, timeout). Never rejects. */
export function recordAiError(tag: AiUsageTag | null | undefined, err: unknown): Promise<void> {
  if (!tag) return Promise.resolve();
  try {
    return schedule(tag, Promise.resolve(aiUsageRow(tag, null, err)));
  } catch {
    return Promise.resolve();
  }
}

/** Wrap a call site's fetch: `await recordAi(tag, fetch(...))`. Resolves to the
 *  same Response and rethrows the same error, recording exactly one row. */
export async function recordAi(tag: AiUsageTag | null | undefined, call: Promise<Response>): Promise<Response> {
  let resp: Response;
  try {
    resp = await call;
  } catch (e) {
    await recordAiError(tag, e);
    throw e;
  }
  await recordAiResponse(tag, resp);
  return resp;
}

// ── Report ───────────────────────────────────────────────────────────────────

/** The last `n` MYT calendar months, oldest first, ending with `now`'s month. */
export function lastMonths(now: Date, n: number): string[] {
  const [y, m] = mytMonth(now).split("-").map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

/** One grouped row of ai_usage_events (month, feature, model). */
export interface EventAggRow extends TokenCounts {
  month: string;
  feature: string;
  model: string;
  calls: number;
  failures: number;
}

export interface FeatureUsage extends TokenCounts {
  feature: string;
  label: string;
  calls: number;
  failures: number;
  /** Share of calls that came back with an answer, 0..100, one decimal; null with no calls. */
  readRatePct: number | null;
  rm: number;
}

export interface MonthUsage {
  month: string;
  totalRm: number;
  calls: number;
  failures: number;
  readRatePct: number | null;
  partial: boolean;
  note: string | null;
  features: FeatureUsage[];
}

export interface AiUsageReport {
  months: MonthUsage[];
  usdToRm: number;
  firstRecordedAt: string | null;
}

const round2 = (x: number) => Math.round(x * 100) / 100;
const ratePct = (calls: number, failures: number): number | null =>
  calls > 0 ? Math.round(((calls - failures) / calls) * 1000) / 10 : null;

/** Pure: build the per-month report from grouped rows. */
export function buildAiUsageReport(input: {
  months: string[];
  firstRecordedAt: string | null;
  events: EventAggRow[];
}): AiUsageReport {
  const firstMonth = input.firstRecordedAt ? mytMonth(new Date(input.firstRecordedAt)) : null;

  const months = input.months.map((month): MonthUsage => {
    const rows = input.events.filter((r) => r.month === month);
    const features = new Map<string, Omit<FeatureUsage, "readRatePct" | "label">>();
    let total = 0;
    let calls = 0;
    let failures = 0;
    for (const r of rows) {
      const rm = usdToRm(costUsd(r.model, r));
      total += rm;
      calls += r.calls;
      failures += r.failures;
      const f = features.get(r.feature) ?? {
        feature: r.feature, calls: 0, failures: 0, rm: 0,
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
      };
      f.calls += r.calls;
      f.failures += r.failures;
      f.inputTokens += r.inputTokens;
      f.outputTokens += r.outputTokens;
      f.cacheReadTokens += r.cacheReadTokens;
      f.cacheWriteTokens += r.cacheWriteTokens;
      f.rm += rm;
      features.set(r.feature, f);
    }

    let note: string | null = null;
    if (firstMonth === null || month < firstMonth) note = "Nothing was recorded yet this month.";
    else if (month === firstMonth && input.firstRecordedAt) {
      note = `Recording started on ${mytDate(new Date(input.firstRecordedAt))}; earlier calls this month are not counted.`;
    }

    return {
      month,
      totalRm: round2(total),
      calls,
      failures,
      readRatePct: ratePct(calls, failures),
      partial: firstMonth === null || month <= firstMonth,
      note,
      features: [...features.values()]
        .map((f) => ({ ...f, label: AI_FEATURE_LABELS[f.feature] ?? f.feature, rm: round2(f.rm), readRatePct: ratePct(f.calls, f.failures) }))
        .sort((a, b) => b.rm - a.rm || a.feature.localeCompare(b.feature)),
    };
  });

  return { months, usdToRm: USD_TO_MYR_EST, firstRecordedAt: input.firstRecordedAt };
}

const num = (v: unknown) => Number(v) || 0;

type Db = Env["DB"];

/** Read the window for one company from Postgres and build the report. */
export async function loadAiUsageReport(db: Db, companyId: number, monthCount: number, now: Date): Promise<AiUsageReport> {
  const months = lastMonths(now, monthCount);
  const { startIso } = mytMonthRangeUtc(months[0]);
  const { endIso } = mytMonthRangeUtc(months[months.length - 1]);

  const first = await db.prepare(
    "SELECT min(created_at) AS first FROM public.ai_usage_events WHERE company_id = ?",
  ).bind(companyId).first<{ first: string | Date | null }>();
  const firstRaw = first?.first ?? null;
  const firstRecordedAt = firstRaw === null ? null : new Date(firstRaw).toISOString();

  const res = await db.prepare(`
    SELECT to_char(e.created_at AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM') AS month,
           e.feature, e.model,
           count(*) AS calls,
           count(*) FILTER (WHERE NOT e.ok) AS failures,
           coalesce(sum(e.input_tokens), 0) AS input_tokens,
           coalesce(sum(e.output_tokens), 0) AS output_tokens,
           coalesce(sum(e.cache_read_tokens), 0) AS cache_read_tokens,
           coalesce(sum(e.cache_write_tokens), 0) AS cache_write_tokens
      FROM public.ai_usage_events e
     WHERE e.company_id = ? AND e.created_at >= ?::timestamptz AND e.created_at < ?::timestamptz
     GROUP BY 1, 2, 3`).bind(companyId, startIso, endIso).all<Record<string, unknown>>();

  return buildAiUsageReport({
    months,
    firstRecordedAt,
    events: (res.results ?? []).map((r) => ({
      month: String(r.month),
      feature: String(r.feature),
      model: String(r.model),
      calls: num(r.calls),
      failures: num(r.failures),
      inputTokens: num(r.input_tokens),
      outputTokens: num(r.output_tokens),
      cacheReadTokens: num(r.cache_read_tokens),
      cacheWriteTokens: num(r.cache_write_tokens),
    })),
  });
}

/** The latest failed calls of one company, newest first — what went wrong. */
export async function loadRecentAiFailures(db: Db, companyId: number, limit = 20): Promise<Array<{ at: string; feature: string; label: string; error: string | null; httpStatus: number | null }>> {
  const res = await db.prepare(`
    SELECT created_at, feature, error, http_status
      FROM public.ai_usage_events
     WHERE company_id = ? AND NOT ok
     ORDER BY created_at DESC
     LIMIT ?`).bind(companyId, limit).all<Record<string, unknown>>();
  return (res.results ?? []).map((r) => ({
    at: new Date(r.created_at as string).toISOString(),
    feature: String(r.feature),
    label: AI_FEATURE_LABELS[String(r.feature)] ?? String(r.feature),
    error: (r.error as string | null) ?? null,
    httpStatus: r.http_status == null ? null : num(r.http_status),
  }));
}
