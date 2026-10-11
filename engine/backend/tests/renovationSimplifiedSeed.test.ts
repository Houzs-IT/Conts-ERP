// The simplified renovation project (owner decisions 11 Oct 2026): the code
// lists in renovation-stages.ts and the seed rows of migrations 0083 / 0084 must
// say the same thing, and every new migration follows the house rules.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { SUB_CATEGORIES } from "../src/scm/shared/renovation-catalog";
import {
  FLOW_STEP_DEFAULT_LABEL,
  FLOW_STEP_KEYS,
  INTERNAL_TASKS,
  PERSON_ROLES,
  RENO_STAGES,
  TASK_CATEGORIES,
  categoryOfTask,
  taskCodeOfCategory,
} from "../src/scm/shared/renovation-stages";

const MIG = resolve(__dirname, "../../../migrations-pg");
const read = (f: string) => readFileSync(resolve(MIG, f), "utf8").replace(/\r\n/g, "\n");

const NEW_MIGRATIONS = [
  "0083_renovation_people_steps_records.sql",
  "0084_renovation_task_categories_crew.sql",
  "0085_renovation_works_subs_notion.sql",
  "0086_reno_contract_project_optional.sql",
];

describe("house rules", () => {
  for (const f of NEW_MIGRATIONS) {
    test(`${f}: reversal first; new tables owned by scm_engine, RLS on, closed to anon/authenticated`, () => {
      const sql = read(f);
      expect(sql.split("\n")[0]).toMatch(/^-- REVERSAL: /);
      for (const [, t] of sql.matchAll(/create table ((?:public|scm)\.[a-z_]+)/g)) {
        expect(sql, t).toContain(`alter table ${t} owner to scm_engine;`);
        expect(sql, t).toContain(`alter table ${t} enable row level security;`);
        expect(sql, t).toContain(`revoke all on ${t} from anon, authenticated;`);
      }
    });
  }

  test("importable records carry source + source_ref with a unique (company_id, source_ref)", () => {
    const sql = read(NEW_MIGRATIONS[0]) + read(NEW_MIGRATIONS[1]);
    for (const t of ["project_people", "projects", "project_key_moves", "project_design_records", "project_design_files", "project_trade_tasks"]) {
      expect(sql, t).toMatch(new RegExp(`create unique index [a-z_]+ on public\\.${t} \\(company_id, source_ref\\) where source_ref is not null;`));
    }
  });
});

describe("migration 0083 seeds the six flow steps", () => {
  test("keys, labels and order match FLOW_STEP_KEYS", () => {
    const sql = read(NEW_MIGRATIONS[0]);
    const rows = [...sql.matchAll(/\('([a-z]+)', '([A-Za-z]+)', (\d+)\)/g)].map((m) => ({ key: m[1], label: m[2], sort: Number(m[3]) }));
    expect(rows.map((r) => r.key)).toEqual([...FLOW_STEP_KEYS]);
    for (const r of rows) expect(r.label).toBe(FLOW_STEP_DEFAULT_LABEL[r.key as keyof typeof FLOW_STEP_DEFAULT_LABEL]);
    expect(sql).toContain(`check (step_key in (${FLOW_STEP_KEYS.map((k) => `'${k}'`).join(", ")}))`);
  });

  test("the people roles check lists PERSON_ROLES", () => {
    expect(read(NEW_MIGRATIONS[0])).toContain(`roles <@ array[${PERSON_ROLES.map((r) => `'${r}'`).join(", ")}]::text[]`);
  });
});

describe("task categories (Notion vocabulary)", () => {
  const q = (x: string | null) => (x == null ? "null" : `'${x}'`);

  test("migration 0084 seeds exactly TASK_CATEGORIES", () => {
    const sql = read(NEW_MIGRATIONS[1]);
    const rows = [...sql.matchAll(/^ {4}\('([A-Z_]+)', '([^']+)', '([a-z_]+)', (null|'[A-Z_]+'), '([a-z]+)', (null|'[a-z_]+'), (true|false), (\d+), (true|false)\)[,]?$/gm)]
      .map((m) => m.slice(1).join("|"));
    expect(rows).toEqual(TASK_CATEGORIES.map((c) => [c.code, c.label, c.stage, q(c.trade), c.fix, q(c.internalKey), c.tradeDefault, c.sort, c.notion].join("|")));
  });

  test("all 34 Notion categories are present, codes unique, stages real", () => {
    expect(TASK_CATEGORIES.filter((c) => c.notion)).toHaveLength(34);
    const codes = TASK_CATEGORIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of TASK_CATEGORIES) expect(RENO_STAGES).toContain(c.stage);
  });

  test("every trade maps to a WORKS sub-category and every template task to an INTERNAL_TASKS key", () => {
    const works = new Set(SUB_CATEGORIES.filter((s) => s.group === "WORKS").map((s) => s.code));
    const keys = new Set(INTERNAL_TASKS.map((t) => t.key));
    for (const c of TASK_CATEGORIES) {
      expect(c.trade === null || c.internalKey === null, c.code).toBe(true);
      if (c.trade) expect(works.has(c.trade), c.code).toBe(true);
      if (c.internalKey) expect(keys.has(c.internalKey), c.code).toBe(true);
    }
    for (const k of keys) expect(TASK_CATEGORIES.some((c) => c.internalKey === k), k).toBe(true);
  });

  test("each (trade, fix) has exactly one default category, and every WORKS task trade has one", () => {
    const seen = new Map<string, number>();
    for (const c of TASK_CATEGORIES.filter((x) => x.tradeDefault)) seen.set(`${c.trade}|${c.fix}`, (seen.get(`${c.trade}|${c.fix}`) ?? 0) + 1);
    for (const [k, n] of seen) expect(n, k).toBe(1);
    for (const s of SUB_CATEGORIES.filter((x) => x.group === "WORKS" && !["CLEANING", "PROJECT_MGMT"].includes(x.code))) {
      expect(categoryOfTask(s.code, s.code === "ELECTRICAL" ? "first" : "single"), s.code).not.toBeNull();
    }
  });

  test("stored task codes map back to their category", () => {
    expect(categoryOfTask("ELECTRICAL", "first")?.code).toBe("WIRING_HACKING");
    expect(categoryOfTask("ELECTRICAL", "second")?.code).toBe("LIGHTING_FAN");
    expect(categoryOfTask("INTERNAL:qc", "single")?.code).toBe("QC");
    expect(categoryOfTask("CLEANING", "single")?.code).toBe("POST_RENO_CLEANING");
    expect(categoryOfTask("CAT:CURTAIN", "single")?.code).toBe("CURTAIN");
    for (const c of TASK_CATEGORIES.filter((x) => x.tradeDefault || x.internalKey || !x.trade)) {
      expect(categoryOfTask(taskCodeOfCategory(c), c.fix)?.code, c.code).toBe(c.code);
    }
  });
});
