import { describe, expect, it } from "vitest";
import { createContentBoundKey, outcomeOfError } from "./idempotency";

/* The owner's case, 19 Nov 2026: a PO save refused, a line moved, Save again -> "an earlier submission with different
   details already finished under this request key". A changed form after a REFUSAL is a new request; the same form
   re-pressed, or a changed form after a save that got NO answer, must not silently become a second document. */

const minter = () => {
  let n = 0;
  return () => `k${++n}`;
};
const refusal = (status: number, body: unknown) => Object.assign(new Error("refused"), { status, body: JSON.stringify(body) });

describe("createContentBoundKey", () => {
  it("keeps one key for the same content: a double press replays", () => {
    const keys = createContentBoundKey(minter());
    expect(keys.keyFor({ qty: 1 })).toEqual({ key: "k1", needsConfirm: false });
    expect(keys.keyFor({ qty: 1 })).toEqual({ key: "k1", needsConfirm: false });
  });

  it("keeps the key for the same content after a failure too: a retry replays", () => {
    const keys = createContentBoundKey(minter());
    keys.keyFor({ qty: 1 });
    keys.settle("unknown");
    expect(keys.keyFor({ qty: 1 })).toEqual({ key: "k1", needsConfirm: false });
  });

  it("mints a new key when the content changed after a refusal", () => {
    const keys = createContentBoundKey(minter());
    keys.keyFor({ line: "CUR-GEN-DOUBLE", category: "SOFT" });
    keys.settle(outcomeOfError(refusal(409, { error: "items_insert_failed", reason: "A renovation purchase order holds one category" })));
    expect(keys.keyFor({ line: "CUR-GEN-DOUBLE", category: "BUILTIN" })).toEqual({ key: "k2", needsConfirm: false });
  });

  it("asks before a new key when the content changed after a save with no answer", () => {
    const keys = createContentBoundKey(minter());
    keys.keyFor({ qty: 1 });
    keys.settle(outcomeOfError(new Error("That took too long")));
    expect(keys.keyFor({ qty: 2 })).toEqual({ key: null, needsConfirm: true });
    expect(keys.confirmNewKey({ qty: 2 })).toBe("k2");
    expect(keys.keyFor({ qty: 2 })).toEqual({ key: "k2", needsConfirm: false });
  });

  it("keeps the key while a save is still running", () => {
    const keys = createContentBoundKey(minter());
    keys.keyFor({ qty: 1 });
    expect(keys.keyFor({ qty: 2 })).toEqual({ key: "k1", needsConfirm: false });
  });
});

describe("outcomeOfError", () => {
  it("reads a plain 4xx from the route as a refusal", () => {
    expect(outcomeOfError(refusal(400, { error: "supplier_id_required" }))).toBe("refused");
    expect(outcomeOfError(refusal(409, { error: "qty_exceeds_remaining" }))).toBe("refused");
  });

  it("never reads key_reused or in_flight as a refusal: either may follow a committed save", () => {
    expect(outcomeOfError(refusal(409, { error: "idempotency_key_reused", completed_status: 201 }))).toBe("unknown");
    expect(outcomeOfError(refusal(409, { error: "idempotency_in_flight" }))).toBe("unknown");
  });

  it("treats a 5xx, a gateway error and a dropped request as unknown", () => {
    expect(outcomeOfError(refusal(500, { error: "items_insert_failed" }))).toBe("unknown");
    expect(outcomeOfError(refusal(504, {}))).toBe("unknown");
    expect(outcomeOfError(new TypeError("Failed to fetch"))).toBe("unknown");
  });
});
