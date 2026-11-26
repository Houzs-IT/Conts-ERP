import { describe, expect, test } from "vitest";
import { appendUniqueById } from "./appendUniqueById";

describe("appendUniqueById", () => {
  test("appends rows whose id is not loaded yet", () => {
    expect(appendUniqueById([{ id: "a" }], [{ id: "b" }])).toEqual([{ id: "a" }, { id: "b" }]);
  });

  test("skips incoming rows already loaded", () => {
    expect(appendUniqueById([{ id: "a" }, { id: "b" }], [{ id: "b" }, { id: "c" }])).toEqual([
      { id: "a" },
      { id: "b" },
      { id: "c" },
    ]);
  });

  test("skips duplicates inside the incoming rows", () => {
    expect(appendUniqueById([], [{ id: "a" }, { id: "a" }])).toEqual([{ id: "a" }]);
  });
});
