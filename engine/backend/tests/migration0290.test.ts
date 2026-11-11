import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

/* Migration 0290 (stock take rounds + the stock adjustment document) is applied by hand, so its text is checked here:
   every table it creates is closed to the Supabase anon / authenticated roles the way 0210 / 0223 / 0237 close theirs,
   and the column the stock-take reverse reads (rack_moves) is there. */
const SQL = readFileSync(resolve(__dirname, "../../../migrations-pg/0290_stock_take_rounds_adjustment_docs.sql"), "utf8").replace(/\r\n/g, "\n");
const body = SQL.split("\n").filter(l => !l.trim().startsWith("--")).join("\n").toLowerCase();

describe("0290_stock_take_rounds_adjustment_docs", () => {
  const created = [...body.matchAll(/create table if not exists (scm\.[a-z_]+)/g)].map(m => m[1]!);

  test("creates the tables it says it does", () => {
    expect(created).toEqual(["scm.stock_adjustments", "scm.stock_adjustment_lines"]);
  });

  test.each(["scm.stock_adjustments", "scm.stock_adjustment_lines"])("revokes %s from anon and authenticated", t => {
    const revoke = body.match(/revoke all on ([^;]+) from anon, authenticated;/);
    expect(revoke).not.toBeNull();
    expect(revoke![1]!.split(",").map(s => s.trim())).toContain(t);
  });

  test("records the rack moves a post made, for the reverse", () => {
    expect(body).toContain("alter table scm.stock_takes add column if not exists rack_moves jsonb;");
  });
});
