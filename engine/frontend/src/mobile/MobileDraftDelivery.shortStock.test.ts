/* Mark complete on short stock: the fetch layer every screen shares asks Ship anyway, and only a yes sends the flag. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authedFetch } from "../vendor/scm/lib/authed-fetch";
import { AUTH_TOKEN_KEY } from "../lib/authToken";

const h = vi.hoisted(() => ({ answer: true, asked: [] as string[] }));
vi.mock("../vendor/scm/lib/dialog-service", () => ({
  serviceConfirm: async (o: { title: string }) => { h.asked.push(o.title); return h.answer; },
  serviceNotify: async () => undefined,
}));

const SHORT = JSON.stringify({ error: "short_stock", message: "Stock not enough at the selected warehouse for 1 line. Confirm to ship anyway, or switch warehouse / reduce qty first.", shortages: [{ itemCode: "A", warehouseName: "BLK", needed: 2, available: 0, short: 2 }] });
const complete = () => authedFetch("/production-orders/draft-deliveries/d1/complete", { method: "POST", body: JSON.stringify({ podKeys: ["slips/1.jpg"], receivedBy: "Ali" }) });

describe("Mark complete on short stock", () => {
  const sent: Array<Record<string, unknown>> = [];
  beforeEach(() => {
    sent.length = 0; h.asked.length = 0; h.answer = true;
    localStorage.setItem(AUTH_TOKEN_KEY, "test-token");
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      sent.push(body);
      return body.confirmShortStock === true ? new Response('{"ok":true}', { status: 200 }) : new Response(SHORT, { status: 409, headers: { "content-type": "application/json" } });
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

  it("asks once, and a yes sends the same proof with confirmShortStock", async () => {
    await expect(complete()).resolves.toEqual({ ok: true });
    expect(h.asked).toEqual(["Stock not enough at the selected warehouse"]);
    expect(sent[1]).toEqual({ podKeys: ["slips/1.jpg"], receivedBy: "Ali", confirmShortStock: true });
  });

  it("a no ships nothing and says why", async () => {
    h.answer = false;
    await expect(complete()).rejects.toThrow(/Stock not enough/);
    expect(sent).toHaveLength(1);
  });
});
