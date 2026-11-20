import { describe, expect, it, vi } from "vitest";
import { createContentBoundKey, sendWithContentKey } from "./idempotency";

/* The phone VO submit (MobileNewSO) sends through sendWithContentKey. A VO the server refused, corrected and sent
   again must go out under a NEW key; with one key for the form's life the server answered the corrected VO with the
   refused one's claim until the page was reloaded (audit 20 Nov 2026, item 18). */

const minter = () => {
  let n = 0;
  return () => `k${++n}`;
};
const refusal = (status: number, body: unknown) => Object.assign(new Error("refused"), { status, body: JSON.stringify(body) });

describe("sendWithContentKey", () => {
  it("sends a corrected VO under a new key after the server refused the first one", async () => {
    const keys = createContentBoundKey(minter());
    const used: string[] = [];
    const ask = vi.fn(async () => true);
    await expect(sendWithContentKey(keys, { qty: 5 }, ask, async (k) => {
      used.push(k);
      throw refusal(400, { error: "reason_required" });
    })).rejects.toThrow("refused");
    const second = await sendWithContentKey(keys, { qty: 4 }, ask, async (k) => { used.push(k); return "VO-1"; });
    expect(second).toEqual({ sent: true, value: "VO-1" });
    expect(used).toEqual(["k1", "k2"]);
    expect(ask).not.toHaveBeenCalled();
  });

  it("re-sends the same VO under the same key after a timeout, so the server replays instead of filing twice", async () => {
    const keys = createContentBoundKey(minter());
    const used: string[] = [];
    await expect(sendWithContentKey(keys, { qty: 5 }, async () => true, async (k) => {
      used.push(k);
      throw new Error("That took too long");
    })).rejects.toThrow();
    await sendWithContentKey(keys, { qty: 5 }, async () => true, async (k) => { used.push(k); return null; });
    expect(used).toEqual(["k1", "k1"]);
  });

  it("asks before sending a changed VO after a try with no answer, and sends nothing on a no", async () => {
    const keys = createContentBoundKey(minter());
    await expect(sendWithContentKey(keys, { qty: 5 }, async () => true, async () => {
      throw new Error("network down");
    })).rejects.toThrow();
    const send = vi.fn(async () => "x");
    const ask = vi.fn(async () => false);
    expect(await sendWithContentKey(keys, { qty: 4 }, ask, send)).toEqual({ sent: false });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
    const yes = await sendWithContentKey(keys, { qty: 4 }, async () => true, async (k) => k);
    expect(yes).toEqual({ sent: true, value: "k2" });
  });
});
