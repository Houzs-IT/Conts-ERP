import { describe, expect, test } from "vitest";
import { validateCreate } from "../src/services/renovation/create";

const ok = { name: "Skyline A-12-3", projectTypeId: 1, customerKind: "customer" as const, customerName: "Tan" };

describe("New project: People = Project PIC + Attending (owner, 14 Oct 2026)", () => {
  test("a list of attending people is accepted", () => {
    expect(validateCreate({ ...ok, attendingPersonIds: [3, 7], renoPicPersonId: 2 })).toBeNull();
    expect(validateCreate({ ...ok, attendingPersonIds: [] })).toBeNull();
  });
  test("a bad id or a non-list is refused", () => {
    expect(validateCreate({ ...ok, attendingPersonIds: [0] })).toBe("person_invalid");
    expect(validateCreate({ ...ok, attendingPersonIds: [1.5] })).toBe("person_invalid");
    expect(validateCreate({ ...ok, attendingPersonIds: "3" as unknown as number[] })).toBe("person_invalid");
  });
});
