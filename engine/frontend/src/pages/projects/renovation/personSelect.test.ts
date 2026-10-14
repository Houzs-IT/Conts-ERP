import { describe, expect, test } from "vitest";
import { isOffered, peopleOptions, personLabel, personPosition } from "./PersonSelect";
import type { Person } from "./simpleApi";

const p = (id: number, extra: Partial<Person> = {}): Person =>
  ({ id, name: `P${id}`, roles: [], active: true, user_id: null, phone: null, notes: null, source: "app", ...extra });

describe("people pickers read the user accounts", () => {
  test("the label is Name · Position · Department, skipping blanks", () => {
    expect(personLabel(p(1, { name: "Alex", position: "Project PIC", department: "Renovation" }))).toBe("Alex · Project PIC · Renovation");
    expect(personLabel(p(1, { name: "Alex", position: null, department: "Renovation" }))).toBe("Alex · Renovation");
    expect(personLabel(p(1, { name: "Alex" }))).toBe("Alex");
  });

  test("only people linked to an active account are offered; an old pick still shows on its record", () => {
    const all = [p(1, { offered: true }), p(2, { offered: false, source: "import" }), p(3, { offered: false, active: false })];
    expect(peopleOptions(all, undefined, []).map((x) => x.id)).toEqual([1]);
    expect(peopleOptions(all, undefined, [2]).map((x) => x.id)).toEqual([1, 2]);
  });

  test("accounts carry no project roles, so a role does not hide them", () => {
    expect(peopleOptions([p(1, { offered: true })], "site_crew", []).map((x) => x.id)).toEqual([1]);
  });

  test("before migration 0113 (no offered flag) the old rule holds: active, of the asked role", () => {
    expect(isOffered(p(1, { roles: ["sales"] }), "sales")).toBe(true);
    expect(isOffered(p(1, { roles: ["designer"] }), "sales")).toBe(false);
    expect(isOffered(p(1, { active: false }))).toBe(false);
  });
});

describe("position after the name", () => {
  test("is the Position on the user account", () => {
    expect(personPosition(p(1, { offered: true, position: " Project PIC ", roles: ["sales"] }))).toBe("Project PIC");
  });
  test("is empty for imported history and accounts with no position: project roles no longer stand in", () => {
    expect(personPosition(p(1, { offered: false, roles: ["designer"] }))).toBe("");
    expect(personPosition(p(1, { offered: true, position: null, roles: ["sales"] }))).toBe("");
  });
  test("before migration 0113 (no offered flag) the old roles still show", () => {
    expect(personPosition({ roles: ["sales", "designer"] })).toBe("Sales, Designer");
  });
});

describe("site crew without a login", () => {
  const crew = p(20, { name: "ZAINAL", roles: ["site_crew"], offered: false, crew: true, linked: false, source: "import" });
  const account = p(1, { name: "Alex", offered: true, linked: true, position: "Project PIC" });
  test("is offered as site task crew, next to the accounts", () => {
    expect(peopleOptions([account, crew], "site_crew", []).map((x) => x.id)).toEqual([1, 20]);
  });
  test("is not offered anywhere that needs an account", () => {
    expect(peopleOptions([account, crew], undefined, []).map((x) => x.id)).toEqual([1]);
  });
  test("is labelled as crew without a login", () => {
    expect(personLabel(crew)).toBe("ZAINAL · Crew (no login)");
  });
});
