// The catalog lives in two places: renovation-catalog.ts (code) and the seed rows
// of migrations 0061 / 0064 (database). This pins them to each other so neither
// can drift: a sub-category added in code without a migration (or the reverse)
// fails here.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { RENOVATION_GROUPS, SUB_CATEGORIES, UOMS, genericSkus } from "../src/scm/shared/renovation-catalog";
import { RENO_STAGES } from "../src/scm/shared/renovation-stages";

const MIG = resolve(__dirname, "../../../migrations-pg");
const read = (f: string) => readFileSync(resolve(MIG, f), "utf8").replace(/\r\n/g, "\n");
const tuples = (sql: string, re: RegExp) => [...sql.matchAll(re)].map((m) => m.slice(1));

describe("migration 0061 seeds the same tree as renovation-catalog.ts", () => {
  const sql = read("0061_renovation_category_tree.sql");

  test("groups: code, label, lower-case stage key, photo rule", () => {
    const rows = tuples(sql, /^\s+\('([A-Z]+)', '([^']+)', '([a-z_]+)', (true|false), (\d+)\)[,;]$/gm);
    expect(rows.map(([code, label, stage, photo]) => ({ code, label, stage, photo: photo === "true" }))).toEqual(
      RENOVATION_GROUPS.map((g) => ({ code: g.code, label: g.label, stage: g.stage, photo: g.photoRequired })),
    );
    for (const [, , stage] of rows) expect(RENO_STAGES as readonly string[]).toContain(stage);
  });

  test("default stages are exactly the four lower-case keys the contract names", () => {
    const stages = new Set(tuples(sql, /^\s+\('[A-Z]+', '[^']+', '([a-z_]+)', (?:true|false), \d+\)/gm).map(([s]) => s));
    expect([...stages].sort()).toEqual(["appliances", "furniture", "hardware", "soft_furnishing"]);
  });

  test("sub-categories: group, code, label, sort, legacy list (0061 plus the Notion trades of 0085)", () => {
    const byCode = (a: { code: string }, b: { code: string }) => a.code.localeCompare(b.code);
    const both = sql + "\n" + read("0085_renovation_works_subs_notion.sql");
    const rows = tuples(both, /^\s+\('([A-Z]+)', '([A-Z_]+)', '([^']+)', (\d+), (?:'\{\}'|array\[([^\]]*)\])::text\[\]\)[,;]?$/gm);
    expect(
      rows.map(([group, code, label, sort, legacy]) => ({
        group, code, label, sort: Number(sort),
        legacy: legacy ? legacy.split(",").map((s) => s.trim().replace(/'/g, "")) : [],
      })).sort(byCode),
    ).toEqual(SUB_CATEGORIES.map((s) => ({ group: s.group, code: s.code, label: s.label, sort: s.sort, legacy: [...(s.legacy ?? [])] })).sort(byCode));
  });

  test("the UOM check lists the same eight codes", () => {
    const m = sql.match(/check \(uom in \(([^)]+)\)\)/);
    expect(m?.[1].split(",").map((s) => s.trim().replace(/'/g, ""))).toEqual(UOMS.map((u) => u.code));
  });

  test("first line is the reversal", () => {
    expect(sql.split("\n")[0]).toMatch(/^-- REVERSAL: /);
  });
});

describe("migration 0118 seeds the same eight units as UOMS", () => {
  const sql = read("0118_renovation_units.sql");

  test("code, label, print label, measure flag, in order", () => {
    const rows = tuples(sql, /^\s+\('([A-Z]+)', '([^']+)', '([^']+)', (true|false), true, \d+\)[,;]$/gm);
    expect(rows.map(([code, label, printLabel, measure]) => ({ code, label, printLabel, measure: measure === "true" }))).toEqual(
      UOMS.map((u) => ({ code: u.code, label: u.label, printLabel: u.printLabel, measure: u.measure })),
    );
  });

  test("first line is the reversal", () => {
    expect(sql.split("\n")[0]).toMatch(/^-- REVERSAL: /);
  });
});

describe("migrations 0064 and 0085 seed the generic SKUs", () => {
  test("RN-<SUB> rows match genericSkus()", () => {
    const byCode = (a: { code: string }, b: { code: string }) => a.code.localeCompare(b.code);
    const sql = read("0064_renovation_generic_skus.sql") + "\n" + read("0085_renovation_works_subs_notion.sql");
    const rows = tuples(sql, /^\s+\('(RN-[A-Z_]+)', '([^']+)', '([A-Z]+)', '([A-Z_]+)', '([A-Z]+)'\)[,)]?$/gm);
    expect(rows.map(([code, name, group, sub, uom]) => ({ code, name, group, sub, uom })).sort(byCode)).toEqual([...genericSkus()].sort(byCode));
  });

  test("every WORKS sub-category has its RN- SKU in 0064 or 0085", () => {
    const sql = read("0064_renovation_generic_skus.sql") + "\n" + read("0085_renovation_works_subs_notion.sql");
    for (const s of SUB_CATEGORIES.filter((x) => x.group === "WORKS")) expect(sql, s.code).toContain(`'RN-${s.code}'`);
  });
});

describe("every phase 1 migration follows the house rules", () => {
  for (const f of [
    "0060_renovation_category_enum.sql",
    "0061_renovation_category_tree.sql",
    "0062_mfg_product_photos.sql",
    "0063_supplier_binding_one_main.sql",
    "0064_renovation_generic_skus.sql",
  ]) {
    test(`${f}: reversal first, new tables owned by scm_engine with RLS on`, () => {
      const sql = read(f);
      expect(sql.split("\n")[0]).toMatch(/^-- REVERSAL: /);
      for (const [, t] of sql.matchAll(/create table (scm\.[a-z_]+)/g)) {
        expect(sql, t).toContain(`alter table ${t} owner to scm_engine;`);
        expect(sql, t).toContain(`alter table ${t} enable row level security;`);
        expect(sql, t).toMatch(new RegExp(`revoke all on [^;]*${t.replace(".", "\\.")}[^;]* from anon, authenticated;`));
      }
    });
  }

  test("0060 only adds enum values (they cannot be used in the transaction that adds them)", () => {
    const body = read("0060_renovation_category_enum.sql").split("\n").filter((l) => l.trim() && !l.startsWith("--"));
    for (const l of body) expect(l).toMatch(/^alter type (scm|public)\.mfg_product_category add value if not exists '[A-Z]+';$/);
    expect(body.length).toBe(12);
  });
});
