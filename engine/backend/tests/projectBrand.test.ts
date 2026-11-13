// A renovation project's brand (chew, 10 Nov 2026): chosen when the project opens, or taken from the sales order a
// project is opened from; it brings its finance type. What is pinned:
//   • a New project names the brand by id; another company's brand, a switched-off one or a bad id is refused;
//   • an older caller that sends only a finance type gets that type's brand;
//   • a project opened from an SO takes the contract's brand id, else the SO's branding by name;
//   • the project is saved WITH the brand and finance type, in the one INSERT (placeholders and values line up).
import { describe, expect, test } from "vitest";
import type { Db } from "../src/services/renovation/load";
import { brandOfSo, projectBrandFrom, shareBrandWithProject } from "../src/services/renovation/projectBrand";
import { createRenovationProject } from "../src/services/renovation/create";

type BrandRow = { id: number; name: string; finance_kind: string | null; active: number; company_id: number };
const BRANDS: BrandRow[] = [
  { id: 1, name: "Dream Crafter", finance_kind: "RENOVATION", active: 1, company_id: 1 },
  { id: 2, name: "The Conts", finance_kind: "INHOUSE_RENOVATION", active: 1, company_id: 1 },
  { id: 3, name: "Old Brand", finance_kind: "RENOVATION", active: 0, company_id: 1 },
  { id: 9, name: "Elsewhere", finance_kind: "RENOVATION", active: 1, company_id: 2 },
];

/** Answers the brand lookups the way Postgres would, from BRANDS. */
function brandDb(): Db {
  const pick = (sql: string, args: unknown[]): BrandRow | null => {
    if (sql.includes("WHERE id = ? AND active = 1 AND company_id = ?")) return BRANDS.find((b) => b.id === args[0] && b.active === 1 && b.company_id === args[1]) ?? null;
    if (sql.includes("WHERE finance_kind = ? AND active = 1 AND company_id = ?"))
      return BRANDS.filter((b) => b.finance_kind === args[0] && b.active === 1 && b.company_id === args[1]).sort((a, b) => a.id - b.id)[0] ?? null;
    if (sql.includes("WHERE id = ? AND company_id = ?")) return BRANDS.find((b) => b.id === args[0] && b.company_id === args[1]) ?? null;
    if (sql.includes("WHERE lower(name) = lower(?) AND company_id = ?"))
      return BRANDS.filter((b) => b.name.toLowerCase() === String(args[0]).toLowerCase() && b.company_id === args[1]).sort((a, b) => b.active - a.active || a.id - b.id)[0] ?? null;
    throw new Error(`unexpected SQL: ${sql}`);
  };
  return {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({ first: async () => pick(sql, args), all: async () => ({ results: [] }), run: async () => ({}) }),
    }),
  } as unknown as Db;
}

describe("the brand a New project names", () => {
  test("by id: the brand and its finance type", async () => {
    expect(await projectBrandFrom(brandDb(), { brandId: 2 }, 1)).toEqual({ ok: true, brand: { id: 2, name: "The Conts", financeKind: "INHOUSE_RENOVATION" } });
    expect(await projectBrandFrom(brandDb(), { brandId: "1" }, 1)).toEqual({ ok: true, brand: { id: 1, name: "Dream Crafter", financeKind: "RENOVATION" } });
  });

  test("another company's brand, a switched-off one or a bad id is refused", async () => {
    for (const brandId of [9, 3, 0, -1, 1.5, "x"]) {
      expect(await projectBrandFrom(brandDb(), { brandId }, 1)).toMatchObject({ ok: false, error: "brand_not_found" });
    }
  });

  test("an older caller sending only a finance type gets that type's brand; nothing sent is no brand", async () => {
    expect(await projectBrandFrom(brandDb(), { financeKind: "INHOUSE_RENOVATION" }, 1)).toEqual({ ok: true, brand: { id: 2, name: "The Conts", financeKind: "INHOUSE_RENOVATION" } });
    expect(await projectBrandFrom(brandDb(), { financeKind: "RENOVATION" }, 1)).toEqual({ ok: true, brand: { id: 1, name: "Dream Crafter", financeKind: "RENOVATION" } });
    expect(await projectBrandFrom(brandDb(), {}, 1)).toEqual({ ok: true, brand: null });
    expect(await projectBrandFrom(brandDb(), { brandId: "", financeKind: "SOMETHING" }, 1)).toEqual({ ok: true, brand: null });
  });
});

describe("the brand of the SO a project is opened from", () => {
  test("the contract's brand id first", async () => {
    expect(await brandOfSo(brandDb(), { brandId: 2, branding: "Dream Crafter" }, 1)).toEqual({ id: 2, name: "The Conts", financeKind: "INHOUSE_RENOVATION" });
  });

  test("else the SO's branding, by name in any case", async () => {
    expect(await brandOfSo(brandDb(), { brandId: null, branding: "the conts" }, 1)).toEqual({ id: 2, name: "The Conts", financeKind: "INHOUSE_RENOVATION" });
    expect(await brandOfSo(brandDb(), { brandId: 9, branding: "Dream Crafter" }, 1)).toEqual({ id: 1, name: "Dream Crafter", financeKind: "RENOVATION" });
  });

  test("none when the SO has no brand, or names one this company does not keep", async () => {
    expect(await brandOfSo(brandDb(), { brandId: null, branding: null }, 1)).toBeNull();
    expect(await brandOfSo(brandDb(), { brandId: null, branding: "  " }, 1)).toBeNull();
    expect(await brandOfSo(brandDb(), { brandId: null, branding: "Elsewhere" }, 1)).toBeNull();
  });
});

describe("the project is saved with its brand", () => {
  test("brand and finance type go into the one INSERT, every placeholder with its value", async () => {
    const calls: Array<{ sql: string; args: unknown[] }> = [];
    const db = {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          first: async () => {
            calls.push({ sql, args });
            return sql.includes("SELECT to_json(stage_keys)") ? { stage_keys: ["design", "handover", "closed"] } : { id: 41, code: "RN-2611-003" };
          },
        }),
      }),
    } as unknown as Db;
    const created = await createRenovationProject(db, {
      name: "ASTRUM A-17-20", projectTypeId: 1, customerKind: "customer", customerName: "Tan", renoPicPersonId: 5,
      brand: "The Conts", financeKind: "INHOUSE_RENOVATION",
    }, 7, 1);
    expect(created).toEqual({ id: 41, code: "RN-2611-003" });
    const insert = calls.find((c) => c.sql.includes("INSERT INTO projects"))!;
    expect(insert.sql).toContain("reno_pic_person_id, brand, finance_kind)");
    expect((insert.sql.match(/\?/g) ?? []).length).toBe(insert.args.length);
    /* Right after the Project PIC's id and company: the brand, then its finance type. */
    const pic = insert.args.indexOf(5);
    expect(insert.args.slice(pic, pic + 4)).toEqual([5, 1, "The Conts", "INHOUSE_RENOVATION"]);
  });

  test("a project with no brand saves none", async () => {
    let args: unknown[] = [];
    const db = {
      prepare: (sql: string) => ({
        bind: (...a: unknown[]) => ({
          first: async () => {
            if (sql.includes("INSERT INTO projects")) args = a;
            return sql.includes("SELECT to_json(stage_keys)") ? { stage_keys: [] } : { id: 1, code: "RN-2611-001" };
          },
        }),
      }),
    } as unknown as Db;
    await createRenovationProject(db, { name: "X", projectTypeId: 1, customerKind: "customer", customerName: "Tan", renoPicPersonId: 6 }, 7, 1);
    const pic = args.indexOf(6);
    expect(args.slice(pic + 2, pic + 4)).toEqual([null, null]);
  });
});

describe("a sales order linked to a project shares one brand", () => {
  test("fills only the blank side, both ways, never overwriting", async () => {
    const statements: Array<{ sql: string; args: unknown[] }> = [];
    const db = {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({ run: async () => { statements.push({ sql, args }); return {}; } }),
      }),
    } as unknown as Db;
    await shareBrandWithProject(db, "TC-SO-2611-031", 330);
    expect(statements).toHaveLength(3);
    const [soFromProject, contractFromProject, projectFromSo] = statements;
    expect(soFromProject?.sql).toMatch(/UPDATE scm\.mfg_sales_orders s SET branding = p\.brand[\s\S]*nullif\(trim\(s\.branding\), ''\) IS NULL AND nullif\(trim\(p\.brand\), ''\) IS NOT NULL/);
    expect(soFromProject?.args).toEqual(["TC-SO-2611-031", 330]);
    expect(contractFromProject?.sql).toMatch(/UPDATE scm\.reno_so_contracts k SET brand_id = b\.id[\s\S]*k\.brand_id IS NULL/);
    expect(projectFromSo?.sql).toMatch(/UPDATE projects p SET brand = s\.branding[\s\S]*nullif\(trim\(p\.brand\), ''\) IS NULL AND nullif\(trim\(s\.branding\), ''\) IS NOT NULL/);
    expect(projectFromSo?.args).toEqual([330, "TC-SO-2611-031"]);
  });
});
