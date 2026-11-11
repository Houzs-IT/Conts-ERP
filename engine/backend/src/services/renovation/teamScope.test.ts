import { describe, expect, test } from "vitest";
import { teamPersonIds, teamProjectSql } from "./teamScope";
import type { Db } from "./load";

/** A Db answering each statement by the first matching rule; a rule may throw to stand for a missing view. */
function fakeDb(rules: Array<[RegExp, (binds: unknown[]) => unknown[]]>): Db {
  return {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const stmt = {
        bind: (...b: unknown[]) => { binds = b; return stmt; },
        all: async () => {
          const rule = rules.find(([re]) => re.test(sql));
          return { results: rule ? rule[1](binds) : [] };
        },
        first: async () => null,
        run: async () => ({}),
      };
      return stmt as never;
    },
  };
}

describe("teamProjectSql", () => {
  test("no people means no projects", () => {
    expect(teamProjectSql([])).toBe("FALSE");
  });

  test("every step's person counts: lead, Site PIC, 3D / 2D picks, appointments, the site measure", () => {
    const sql = teamProjectSql([4, 9]);
    expect(sql).toContain("p.designer_person_id IN (4,9)");
    expect(sql).toContain("p.reno_pic_person_id IN (4,9)");
    expect(sql).toContain("tsd.person_3d_ids && ARRAY[4,9]::bigint[]");
    expect(sql).toContain("tsd.person_2d_ids && ARRAY[4,9]::bigint[]");
    expect(sql).toContain("tsa.person_id IN (4,9)");
    expect(sql).toContain("tsp.person_id IN (4,9)");
  });

  test("only integers reach the SQL", () => {
    expect(teamProjectSql([NaN, 1.5, 7])).toContain("IN (7)");
    expect(teamProjectSql([NaN])).toBe("FALSE");
  });
});

describe("teamPersonIds", () => {
  test("the people of the caller and of everyone under them, once each", async () => {
    const db = fakeDb([[/WITH RECURSIVE team/, (b) => (b[0] === "jiaxin@x.com" ? [{ id: 3 }, { id: 5 }, { id: 3 }] : [])]]);
    expect(await teamPersonIds(db, 1, "jiaxin@x.com")).toEqual([3, 5]);
  });

  test("with no staff view, falls back to the caller's own people", async () => {
    const db = fakeDb([
      [/conts_staff/, () => { throw new Error('relation "conts_staff" does not exist'); }],
      [/FROM project_people pp WHERE pp\.user_id = \?/, () => [{ id: 8 }]],
    ]);
    expect(await teamPersonIds(db, 1, "a@x.com")).toEqual([8]);
  });
});
