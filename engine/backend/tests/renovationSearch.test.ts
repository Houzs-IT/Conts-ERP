/* The supply chain half of Property OS's one search box (routes/renovationGlobalSearch.ts,
   services/renovation/renovationSearch.ts): how typed words become SQL, which kinds a person's levels open, and that
   only a fresh statement signed for search is accepted. */
import { describe, expect, test } from "vitest";
import { day, kindsFor, matchSql, renovationSearch, searchTerms } from "../src/services/renovation/renovationSearch";
import { verifySearchAssertion } from "../src/routes/renovationGlobalSearch";
import type { Db } from "../src/services/renovation/load";

const SECRET = "x".repeat(40);
const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes as ArrayBuffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function sign(payload: Record<string, unknown>, secret = SECRET): Promise<string> {
  const enc = new TextEncoder();
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `${body}.${b64url(await crypto.subtle.sign("HMAC", key, enc.encode(body)))}`;
}
const NONE = { scSales: "none", scInvoices: "none", scConsignment: "none", scProcurement: "none", scTransportPlan: "none", scWarehouse: "none", serviceCases: "none", projects: "none" };

describe("search terms", () => {
  test("words are lower case, escaped, at most five", () => {
    expect(searchTerms("  Tan  50%_off a b c d ").words).toEqual(["%tan%", "%50\\%\\_off%", "%a%", "%b%", "%c%"]);
  });
  test("a document number or phone typed with spaces or dashes becomes one key", () => {
    expect(searchTerms("so 2610-001").key).toBe("%so2610001%");
    expect(searchTerms("012-345 6789").key).toBe("%0123456789%");
    expect(searchTerms("ab").key).toBe("");
  });
  test("a number typed with the 60 country code also looks for the local 0 number", () => {
    expect(searchTerms("+60 12-345 6789").localKey).toBe("%0123456789%");
    expect(searchTerms("0123456789").localKey).toBe("");
  });
  test("every word must match one text field, or the key one number field", () => {
    const m = matchSql(searchTerms("tan skyline"), ["a.name", "a.building"], ["a.phone"]);
    expect(m.sql).toBe(
      "(((a.name ILIKE ? OR a.building ILIKE ?) AND (a.name ILIKE ? OR a.building ILIKE ?)) OR "
      + "(regexp_replace(lower(coalesce(a.phone, '')), '[^a-z0-9]+', '', 'g') LIKE ?))",
    );
    expect(m.args).toEqual(["%tan%", "%tan%", "%skyline%", "%skyline%", "%tanskyline%"]);
    expect(m.sql).not.toContain("?1");
  });
});

describe("dates", () => {
  test("a timestamp column reads as its Malaysian day, whatever shape it arrives in", () => {
    expect(day(new Date("2026-11-03T17:00:00Z"))).toBe("2026-11-04");
    expect(day("2026-11-03T02:00:00+00:00")).toBe("2026-11-03");
    expect(day("2026-11-03")).toBe("2026-11-03");
    expect(day(null)).toBeNull();
    expect(day("not a date")).toBeNull();
  });
});

describe("kinds follow the levels", () => {
  test("no access opens nothing", () => {
    expect(kindsFor(NONE)).toEqual([]);
  });
  test("projects alone opens projects and customers, never orders or service cases", () => {
    expect(kindsFor({ ...NONE, projects: "view" })).toEqual(["project", "customer"]);
  });
  test("invoices need the invoices level", () => {
    const k = kindsFor({ ...NONE, scSales: "full", scProcurement: "edit" });
    expect(k).toContain("sales_order");
    expect(k).toContain("purchase_order");
    expect(k).not.toContain("sales_invoice");
    expect(k).not.toContain("purchase_invoice");
  });
});

describe("the search reads only the kinds opened, and names the ones it could not read", () => {
  test("a failing read is degraded, not empty; closed kinds are never queried", async () => {
    const seen: string[] = [];
    const db: Db = {
      prepare(sql: string) {
        const stmt = {
          bind: () => stmt,
          all: async () => {
            seen.push(sql);
            if (sql.includes("assr_cases")) throw new Error("boom");
            return { results: sql.includes("FROM projects p\n") || sql.includes("FROM projects p ") ? [{ id: 7, code: "RN-1", name: "Kitchen", customer_name: "Tan" }] : [] };
          },
          first: async () => null,
          run: async () => ({}),
        };
        return stmt;
      },
    };
    const r = await renovationSearch(db, "tan", { ...NONE, projects: "view", serviceCases: "view" }, { active: () => "", allowed: () => "" }, { limit: 6 });
    expect(r.degraded).toEqual(["service_case"]);
    expect(r.hits.find((h) => h.kind === "project")?.path).toBe("/beta/projects/7");
    expect(seen.some((s) => s.includes("mfg_sales_orders"))).toBe(false);
    expect(seen.some((s) => s.includes("scm.customers"))).toBe(true);
  });
  test("nothing typed reads nothing", async () => {
    const db = { prepare: () => { throw new Error("should not read"); } } as unknown as Db;
    expect(await renovationSearch(db, "   ", { ...NONE, projects: "full" }, { active: () => "", allowed: () => "" }, { limit: 6 })).toEqual({ hits: [], degraded: [] });
  });
});

describe("only a fresh statement signed for search is accepted", () => {
  const access = { ...NONE, projects: "view" };
  test("a good one names the person and their levels", async () => {
    const a = await verifySearchAssertion(SECRET, await sign({ aud: "search", email: "Ops@TheConts.com ", access, exp: Date.now() + 30_000 }));
    expect(a?.email).toBe("ops@theconts.com");
    expect(a?.access.projects).toBe("view");
    expect(a?.access.ledger).toBe("none");
  });
  test("a sign-on or claims statement does not open search", async () => {
    expect(await verifySearchAssertion(SECRET, await sign({ email: "a@b.c", access, exp: Date.now() + 30_000 }))).toBeNull();
    expect(await verifySearchAssertion(SECRET, await sign({ aud: "claims", email: "a@b.c", access, exp: Date.now() + 30_000 }))).toBeNull();
  });
  test("expired, too long-lived, wrong secret or unknown levels are refused", async () => {
    expect(await verifySearchAssertion(SECRET, await sign({ aud: "search", email: "a@b.c", access, exp: Date.now() - 1 }))).toBeNull();
    expect(await verifySearchAssertion(SECRET, await sign({ aud: "search", email: "a@b.c", access, exp: Date.now() + 3_600_000 }))).toBeNull();
    expect(await verifySearchAssertion(SECRET, await sign({ aud: "search", email: "a@b.c", access, exp: Date.now() + 30_000 }, "y".repeat(40)))).toBeNull();
    expect(await verifySearchAssertion(SECRET, await sign({ aud: "search", email: "a@b.c", access: { ...access, projects: "admin" }, exp: Date.now() + 30_000 }))).toBeNull();
  });
});
