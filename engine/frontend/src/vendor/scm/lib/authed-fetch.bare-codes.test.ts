// Refusals that send only a code (audit 20 Nov 2026, item 15) used to read "Some of the details weren't accepted".
import { describe, expect, test } from "vitest";
import { codeToWords, humanApiError } from "./authed-fetch";

const GENERIC_400 =
  "Some of the details weren't accepted. Please check what you entered and try again.";
const say = (code: string, status = 400) => humanApiError(status, JSON.stringify({ error: code }));

describe("bare refusal codes get a plain sentence", () => {
  test.each([
    ["debtor_name_required", /customer name/i],
    ["payee_required", /payee/i],
    ["credit_account_required", /paid from/i],
    ["allocations_exceed_total", /more than this voucher pays/i],
    ["draft_status_not_supported", /no longer have a draft/i],
    ["from_warehouse_required", /moves from/i],
    ["to_warehouse_required", /moves to/i],
    ["same_warehouse", /two different warehouses/i],
    ["items_required", /at least one line/i],
    ["customer_name_required", /customer name/i],
    ["missing_customer_name", /customer name/i],
    ["missing_cart", /at least one item/i],
    ["invalid_subtotal", /subtotal/i],
    ["invalid_total", /total/i],
  ])("%s", (code, expected) => {
    const msg = say(code);
    expect(msg).toMatch(expected);
    expect(msg).not.toBe(GENERIC_400);
    expect(msg).not.toContain("_");
  });

  test("allocations_exceed_total with its extra numbers still reads the sentence", () => {
    expect(humanApiError(400, JSON.stringify({ error: "allocations_exceed_total", allocated: 500, total: 400 })))
      .toMatch(/more than this voucher pays/);
  });
});

describe("an unknown code falls back to its own words", () => {
  test("an uncurated code reads as words, not the generic line", () => {
    expect(say("some_new_field_required")).toBe("Some new field required");
    expect(say("weird_thing", 422)).toBe("Weird thing");
  });

  test("a server sentence still wins over the code's words", () => {
    expect(humanApiError(400, JSON.stringify({ error: "x_failed", message: "The cheque date is in the future." })))
      .toBe("The cheque date is in the future.");
  });

  test("only refused inputs get the words: a 409 or 500 code keeps its status sentence", () => {
    expect(say("load_failed", 500)).toMatch(/system hit a problem/);
    expect(say("some_clash", 409)).toMatch(/clashes/);
  });

  test("codeToWords", () => {
    expect(codeToWords("payee_required")).toBe("Payee required");
    expect(codeToWords("__")).toBe("");
  });
});
