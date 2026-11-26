import { describe, expect, it } from "vitest";
import { mailWaitingCaller, verifyMailWaitingAssertion, type MailWaitingDb } from "./mail-waiting-route";
import { CONTS_AREAS } from "./access";

// AI Connector round 4 (27 Nov 2026): the daily brief's Mail Center count is read-only. A person with no engine account
// or no mailbox of their own is told "not opened yet"; nothing is created, and nothing is ever written.
const SECRET = "x".repeat(40);
const b64url = (b: ArrayBuffer | Uint8Array) => Buffer.from(b as Uint8Array).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function sign(payload: object, secret = SECRET) {
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `${body}.${b64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))}`;
}

/** A stand-in D1 that answers the two reads and records every statement, so a write would show. */
function fakeDb(user: { id: number; status: string } | null, hasMailbox: boolean) {
  const seen: string[] = [];
  const db: MailWaitingDb = {
    prepare(sql: string) {
      seen.push(sql);
      return {
        bind: () => ({
          first: async <T,>() => (/FROM users/.test(sql) ? (user as T | null) : /FROM email_addresses/.test(sql) ? ((hasMailbox ? { x: 1 } : null) as T | null) : null),
        }),
      };
    },
  };
  return { db, seen };
}

const MAIL = { scSales: "view" as const, mail: "view" as const };

describe("verifyMailWaitingAssertion", () => {
  it("accepts only aud 'mail-waiting', signed with the secret, within a minute", async () => {
    const exp = Date.now() + 30_000;
    // What Property OS sends: a level for every area (parseContsAccess refuses a partial chart).
    const sent = { ...Object.fromEntries(CONTS_AREAS.map((k) => [k, "view"])), mail: "view" };
    const ok = await verifyMailWaitingAssertion(SECRET, await sign({ aud: "mail-waiting", email: "A@x.com", exp, access: sent }));
    expect(ok?.email).toBe("a@x.com");
    expect(ok?.access.mail).toBe("view");
    expect(await verifyMailWaitingAssertion(SECRET, await sign({ aud: "search", email: "a@x.com", exp, access: sent }))).toBeNull();
    expect(await verifyMailWaitingAssertion(SECRET, await sign({ email: "a@x.com", name: "A", role: "operations_staff", exp, access: sent }))).toBeNull();
    expect(await verifyMailWaitingAssertion(SECRET, await sign({ aud: "mail-waiting", email: "a@x.com", exp, access: sent }, "y".repeat(40)))).toBeNull();
    expect(await verifyMailWaitingAssertion(SECRET, await sign({ aud: "mail-waiting", email: "a@x.com", exp: Date.now() - 1, access: MAIL }))).toBeNull();
  });
});

describe("mailWaitingCaller (read-only)", () => {
  it("no engine account yet: not opened, and no account is made", async () => {
    const { db, seen } = fakeDb(null, false);
    expect(await mailWaitingCaller(db, { email: "new@x.com", access: MAIL })).toEqual({ kind: "not_opened", reason: "no_engine_account" });
    expect(seen.every((s) => /^\s*SELECT/i.test(s))).toBe(true);
  });

  it("an account but no mailbox of their own: not opened, and no mailbox is made", async () => {
    const { db, seen } = fakeDb({ id: 7, status: "active" }, false);
    expect(await mailWaitingCaller(db, { email: "a@x.com", access: MAIL })).toEqual({ kind: "not_opened", reason: "no_mailbox" });
    expect(seen.every((s) => /^\s*SELECT/i.test(s))).toBe(true);
  });

  it("an account and a mailbox: counted for that engine user", async () => {
    const { db } = fakeDb({ id: 7, status: "active" }, true);
    expect(await mailWaitingCaller(db, { email: "a@x.com", access: MAIL })).toEqual({ kind: "ok", userId: 7 });
  });

  it("Mail at none is refused before anything is read; a switched-off account is refused", async () => {
    const none = fakeDb({ id: 7, status: "active" }, true);
    expect((await mailWaitingCaller(none.db, { email: "a@x.com", access: { scSales: "full", mail: "none" } })).kind).toBe("refused");
    expect(none.seen).toEqual([]);
    const off = fakeDb({ id: 7, status: "disabled" }, true);
    expect((await mailWaitingCaller(off.db, { email: "a@x.com", access: MAIL })).kind).toBe("refused");
  });
});
