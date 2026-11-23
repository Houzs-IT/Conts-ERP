import { describe, expect, it } from "vitest";
import { contentKeyFor, createContentBoundKey, outcomeOfError } from "./idempotency";

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

  it("releases the key after a refusal even when the content is unchanged, so the server judges it again", () => {
    const keys = createContentBoundKey(minter());
    keys.keyFor({ qty: 1 });
    keys.settle(outcomeOfError(refusal(409, { error: "insufficient_stock" })));
    expect(keys.keyFor({ qty: 1 })).toEqual({ key: "k2", needsConfirm: false });
    expect(keys.keyFor({ qty: 1 })).toEqual({ key: "k2", needsConfirm: false });
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

describe("snapshot / adopt", () => {
  it("hands a key kept with a draft back: the same content replays, changed content asks first", () => {
    const keys = createContentBoundKey(minter());
    keys.keyFor({ qty: 1 });
    const snap = keys.snapshot()!;
    const other = createContentBoundKey(() => "new");
    let calls = 0;
    other.subscribe(() => { calls++; });
    other.adopt(snap);
    expect(calls).toBe(1);
    expect(other.keyFor({ qty: 2 })).toEqual({ key: null, needsConfirm: true });
    expect(other.keyFor({ qty: 1 })).toEqual({ key: "k1", needsConfirm: false });
  });

  it("tells listeners when the key changes, not when a try settles", () => {
    const keys = createContentBoundKey(minter());
    let calls = 0;
    keys.subscribe(() => { calls++; });
    keys.keyFor({ qty: 1 });
    keys.settle("succeeded");
    keys.keyFor({ qty: 1 });
    expect(calls).toBe(1);
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

describe("contentKeyFor", () => {
  it("hands out the key without asking when nothing is in doubt", async () => {
    const keys = createContentBoundKey(minter());
    let asked = 0;
    expect(await contentKeyFor(keys, { a: 1 }, async () => { asked++; return true; })).toBe("k1");
    expect(asked).toBe(0);
  });

  it("asks after a save with no answer and the content changed; a no sends nothing, a yes mints a new key", async () => {
    const keys = createContentBoundKey(minter());
    await contentKeyFor(keys, { a: 1 }, async () => true);
    keys.settle("unknown");
    expect(await contentKeyFor(keys, { a: 2 }, async () => false)).toBeNull();
    expect(await contentKeyFor(keys, { a: 2 }, async () => true)).toBe("k2");
  });
});
