import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  grnBooksStock,
  isMissingColumnError,
  readGrnSiteFlag,
  siteReceivedGrnIds,
} from "../src/scm/lib/renovation-site-receipt";

/* A site receipt (renovation, migration 0079) books NO stock. These tests slice
   the source of the two files that write stock for receipts, so a new stock
   write added later without the guard fails here instead of on a customer's
   inventory. */

const src = (rel: string) => readFileSync(path.resolve(__dirname, "../src/scm/routes", rel), "utf8").replace(/\r\n/g, "\n");

const FN_START = /^(export\s+)?(async\s+function\s+\w+|const\s+\w+\s*=\s*async\b|(grns|purchaseReturns)\.(get|post|patch|put|delete)\()/;

function callSites(code: string, needle: RegExp): number[] {
  const lines = code.split("\n");
  const out: number[] = [];
  lines.forEach((l, i) => {
    const t = l.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("import ")) return;
    if (needle.test(l) && !/Parameters<typeof writeMovements>/.test(l.replace(needle, "")) && !/^\s*\w+:/.test(l)) out.push(i);
  });
  return out;
}

function enclosingSlice(code: string, lineIdx: number): { start: number; text: string } {
  const lines = code.split("\n");
  for (let i = lineIdx; i >= 0; i--) {
    if (FN_START.test(lines[i]!)) return { start: i, text: lines.slice(i, lineIdx + 1).join("\n") };
  }
  return { start: 0, text: lines.slice(0, lineIdx + 1).join("\n") };
}

describe("every stock write for a receipt asks whether it was taken on site", () => {
  test("grns.ts: each writeMovements call sits in a function that read the site flag", () => {
    const code = src("grns.ts");
    const sites = callSites(code, /\bwriteMovements\(/);
    expect(sites.length).toBeGreaterThanOrEqual(6);
    for (const i of sites) {
      const { start, text } = enclosingSlice(code, i);
      expect(/grnBooksStock\(/.test(text), `grns.ts:${i + 1} (function at line ${start + 1}) writes stock without grnBooksStock`).toBe(true);
    }
  });

  test("purchase-returns.ts: each writeMovements call sits in a function that read the site flag", () => {
    const code = src("purchase-returns.ts");
    const sites = callSites(code, /\bwriteMovements\(/);
    expect(sites.length).toBeGreaterThanOrEqual(2);
    for (const i of sites) {
      const { start, text } = enclosingSlice(code, i);
      expect(/siteReceivedGrnIds\(|readGrnSiteFlag\(/.test(text), `purchase-returns.ts:${i + 1} (function at line ${start + 1}) writes stock without the site guard`).toBe(true);
    }
  });

  test("no file writes inventory_movements directly", () => {
    for (const f of ["grns.ts", "purchase-returns.ts"]) {
      expect(/from\(['"]inventory_movements['"]\)\s*\.(insert|upsert|update|delete)\(/.test(src(f)), f).toBe(false);
    }
  });

  test("post: the flag is read before the POSTED flip and gates zero-cost, movements, racks and allocation", () => {
    const code = src("grns.ts");
    const start = code.indexOf("export async function postGrnAndRollup(");
    expect(start).toBeGreaterThan(0);
    const body = code.slice(start, code.indexOf("\nexport async function recomputeGrnTotals", start));
    const flagAt = body.indexOf("readGrnSiteFlag(sb, grnId)");
    const flipAt = body.indexOf("status: 'POSTED'");
    expect(flagAt).toBeGreaterThan(0);
    expect(flagAt).toBeLessThan(flipAt);
    expect(body).toContain("if (siteFlag === 'unknown') return");
    expect(body).toContain("booksStock ? await checkGrnZeroCost(");
    expect(body).toContain("if (warehouseId && items && booksStock)");
    expect(body).toContain("if (booksStock) try {\n    const { placeGrnLinesOnRacks }");
    expect(body).toContain("if (booksStock) try {\n    const { recomputeSoStockAllocation }");
  });

  test("cancel and every line edit refuse when the flag cannot be read", () => {
    const code = src("grns.ts");
    const reads = code.match(/const siteFlag = await readGrnSiteFlag\(sb, \w+\);\n\s+if \(siteFlag === 'unknown'\) return/g) ?? [];
    expect(reads.length).toBe(6); // post, cancel, PATCH, line add, line edit, line delete
  });

  test("purchase return stock check skips site-received lines", () => {
    const code = src("purchase-returns.ts");
    const start = code.indexOf("async function checkPrStockAvailability(");
    expect(code.slice(start, start + 2000)).toContain("siteReceivedGrnIds(");
  });
});

function fakeSb(result: { data?: unknown; error?: { message: string; code?: string } | null; throws?: unknown }) {
  const terminal = () => (result.throws ? Promise.reject(result.throws) : Promise.resolve({ data: result.data ?? null, error: result.error ?? null }));
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: terminal }),
        in: terminal,
      }),
    }),
  };
}

describe("site flag reads", () => {
  test("site / warehouse / unknown", async () => {
    expect(await readGrnSiteFlag(fakeSb({ data: { received_at_site: true } }), "g")).toBe("site");
    expect(await readGrnSiteFlag(fakeSb({ data: { received_at_site: false } }), "g")).toBe("warehouse");
    expect(await readGrnSiteFlag(fakeSb({ data: null }), "g")).toBe("warehouse");
    expect(await readGrnSiteFlag(fakeSb({ error: { message: "connection reset" } }), "g")).toBe("unknown");
    expect(await readGrnSiteFlag(fakeSb({ throws: new Error("socket closed") }), "g")).toBe("unknown");
  });

  test("a database without migration 0079 reads as warehouse (no site receipt can exist)", async () => {
    expect(await readGrnSiteFlag(fakeSb({ error: { code: "42703", message: 'column "received_at_site" does not exist' } }), "g")).toBe("warehouse");
    expect(await readGrnSiteFlag(fakeSb({ throws: Object.assign(new Error('column grns.received_at_site does not exist'), { code: "42703" }) }), "g")).toBe("warehouse");
    expect(isMissingColumnError({ code: "PGRST204", message: "x" })).toBe(true);
  });

  test("siteReceivedGrnIds", async () => {
    const s = await siteReceivedGrnIds(fakeSb({ data: [{ id: "a", received_at_site: true }, { id: "b", received_at_site: false }] }), ["a", "b"]);
    expect([...s!]).toEqual(["a"]);
    expect(await siteReceivedGrnIds(fakeSb({ error: { message: "boom" } }), ["a"])).toBeNull();
    expect(await siteReceivedGrnIds(fakeSb({}), [])).toEqual(new Set());
  });

  test("grnBooksStock", () => {
    expect(grnBooksStock("warehouse")).toBe(true);
    expect(grnBooksStock("warehouse", true)).toBe(false);
    expect(grnBooksStock("site")).toBe(false);
    expect(grnBooksStock("unknown")).toBe(false);
  });
});
