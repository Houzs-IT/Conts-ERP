// A refusal that names a document whose number holds five digits (QT-TC-00148) was dropped as if the digits were a
// Postgres SQLSTATE, and the operator read "That clashes with something already in the system" instead of which bill it
// clashed with (chew, 25 Nov 2026: a deposit request whose quotation was already booked).
import { describe, expect, test } from "vitest";
import { humanApiError } from "./authed-fetch";

describe("a sentence naming a document number is shown", () => {
  test("the duplicate supplier bill refusal names the bill", () => {
    const message = "This supplier's bill QT-TC-00148 is already booked as TC-API-2611-062 (POSTED). Open that one, or cancel it first if it is wrong.";
    expect(humanApiError(409, JSON.stringify({ error: "duplicate_supplier_bill", message }))).toBe(message);
  });
  test("a bare SQLSTATE is still kept off the screen", () => {
    expect(humanApiError(409, JSON.stringify({ error: "x", message: "duplicate key 23505 on insert" })))
      .toBe("That clashes with something already in the system. Please refresh and check.");
  });
});
