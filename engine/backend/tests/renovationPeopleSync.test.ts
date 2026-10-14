import { describe, expect, test } from "vitest";
import { personLabelOf, planPeopleSync, syncPeopleFromUsers, type StaffRow, type SyncPersonRow } from "../src/services/renovation/peopleSync";
import type { Db, DbStmt } from "../src/services/renovation/load";

const staff = (id: string, name: string, active = true, extra: Partial<StaffRow> = {}): StaffRow =>
  ({ id, name, email: `${id}@theconts.com`, department: null, position: null, active, ...extra });
const person = (id: number, name: string, posUserId: string | null = null, active = true): SyncPersonRow =>
  ({ id, name, active, pos_user_id: posUserId });

describe("people from user accounts", () => {
  test("a user account with no person yet gets one", () => {
    expect(planPeopleSync([staff("u1", "Lim Wei Siang")], [])).toEqual([
      { kind: "insert", userId: "u1", name: "Lim Wei Siang", active: true },
    ]);
  });

  test("an imported person with exactly the same name (any case, extra spaces) is linked, not duplicated", () => {
    expect(planPeopleSync([staff("u1", "Jia  Xin ")], [person(7, "JIA XIN")])).toEqual([
      { kind: "link", personId: 7, userId: "u1", name: "Jia Xin", active: true },
    ]);
  });

  test("a near name is not a match: the imported person stays history and the user gets a new person", () => {
    expect(planPeopleSync([staff("u1", "JIAXIN"), staff("u2", "ALEX GOH")], [person(7, "JIA XIN"), person(8, "Alex")])).toEqual([
      { kind: "insert", userId: "u1", name: "JIAXIN", active: true },
      { kind: "insert", userId: "u2", name: "ALEX GOH", active: true },
    ]);
  });

  test("an ambiguous name links nobody", () => {
    // two imported people of that name
    expect(planPeopleSync([staff("u1", "Alex")], [person(1, "Alex"), person(2, "ALEX")])).toEqual([
      { kind: "insert", userId: "u1", name: "Alex", active: true },
    ]);
    // two accounts of that name
    expect(planPeopleSync([staff("u1", "Alex"), staff("u2", "alex")], [person(1, "Alex")])).toEqual([
      { kind: "insert", userId: "u1", name: "Alex", active: true },
      { kind: "insert", userId: "u2", name: "alex", active: true },
    ]);
  });

  test("a person already linked to another account is never re-linked by name", () => {
    expect(planPeopleSync([staff("u2", "Alex")], [person(1, "Alex", "u1")])).toEqual([
      { kind: "insert", userId: "u2", name: "Alex", active: true },
      { kind: "refresh", personId: 1, name: "Alex", active: false },
    ]);
  });

  test("a linked person follows the account's name and active state; nothing to do when they agree", () => {
    expect(planPeopleSync([staff("u1", "Wei Siang Lim", false)], [person(3, "Lim Wei Siang", "u1")])).toEqual([
      { kind: "refresh", personId: 3, name: "Wei Siang Lim", active: false },
    ]);
    expect(planPeopleSync([staff("u1", "Lim Wei Siang")], [person(3, "Lim Wei Siang", "u1")])).toEqual([]);
  });

  test("a person whose account is gone (deleted, or now an owner login) is switched off, never deleted", () => {
    expect(planPeopleSync([], [person(3, "Samuel", "u9"), person(4, "ZAINAL")])).toEqual([
      { kind: "refresh", personId: 3, name: "Samuel", active: false },
    ]);
  });

  test("an account with a blank name is listed by its email", () => {
    expect(planPeopleSync([staff("u1", "  ")], [])).toEqual([{ kind: "insert", userId: "u1", name: "u1@theconts.com", active: true }]);
  });

  test("the picker label is Name · Position · Department, skipping what is not set", () => {
    expect(personLabelOf({ name: "Chloe", position: "Sales Executive", department: "Sales" })).toBe("Chloe · Sales Executive · Sales");
    expect(personLabelOf({ name: "Chloe", position: null, department: "Sales" })).toBe("Chloe · Sales");
    expect(personLabelOf({ name: "Chloe", position: " ", department: null })).toBe("Chloe");
  });
});

/** A fake database that answers the three reads and records the writes. */
function fakeDb(opts: { ready: boolean; staff: StaffRow[]; people: SyncPersonRow[] }) {
  const writes: Array<{ sql: string; args: unknown[] }> = [];
  const db: Db = {
    prepare(sql: string): DbStmt {
      let args: unknown[] = [];
      const stmt: DbStmt = {
        bind(...a: unknown[]) { args = a; return stmt; },
        async first<T>() { return (/to_regclass/.test(sql) ? { ready: opts.ready } : null) as T | null; },
        async all<T>() {
          if (/FROM conts_staff/.test(sql)) return { results: opts.staff as unknown as T[] };
          if (/FROM project_people/.test(sql)) return { results: opts.people as unknown as T[] };
          return { results: [] };
        },
        async run() { writes.push({ sql, args }); return {}; },
      };
      return stmt;
    },
  };
  return { db, writes };
}

describe("syncPeopleFromUsers", () => {
  test("does nothing and says so before migration 0113 has run", async () => {
    const { db, writes } = fakeDb({ ready: false, staff: [staff("u1", "A")], people: [] });
    expect(await syncPeopleFromUsers(db, 1)).toBe(false);
    expect(writes).toEqual([]);
  });

  test("writes one statement per planned change, scoped to the company", async () => {
    const { db, writes } = fakeDb({ ready: true, staff: [staff("u1", "Jia Xin"), staff("u2", "New Person")], people: [person(7, "JIA XIN")] });
    expect(await syncPeopleFromUsers(db, 1)).toBe(true);
    expect(writes).toHaveLength(2);
    expect(writes[0].sql).toMatch(/UPDATE project_people SET pos_user_id/);
    expect(writes[0].args).toEqual(["u1", "Jia Xin", true, 7, 1]);
    expect(writes[1].sql).toMatch(/INSERT INTO project_people .*ON CONFLICT/s);
    expect(writes[1].args).toEqual([1, "New Person", true, "u2"]);
  });
});
