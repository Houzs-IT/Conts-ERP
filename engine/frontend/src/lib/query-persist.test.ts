import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTH_TOKEN_KEY, clearAuthToken, writeAuthToken } from "./authToken";
import {
  ACTIVE_COMPANY_BY_USER_KEY,
  adoptActiveCompanyForUser,
  getActiveCompanyId,
  releaseActiveCompanyBinding,
  setActiveCompanyId,
} from "./activeCompany";
import { installQueryPersist, isBetaKey } from "./query-persist";

const originalRequestIdle = Object.getOwnPropertyDescriptor(window, "requestIdleCallback");
const originalCancelIdle = Object.getOwnPropertyDescriptor(window, "cancelIdleCallback");
const originalVisibilityState = Object.getOwnPropertyDescriptor(document, "visibilityState");
let disposePersist: (() => void) | undefined;

function install(qc: QueryClient): void {
  disposePersist = installQueryPersist(qc);
}

function snapshotKeys(): string[] {
  return Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
    .filter((key): key is string => key?.startsWith("houzs-rq-snapshot:") === true);
}

afterEach(() => {
  disposePersist?.();
  disposePersist = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  releaseActiveCompanyBinding();
  if (originalRequestIdle) Object.defineProperty(window, "requestIdleCallback", originalRequestIdle);
  else delete (window as { requestIdleCallback?: Window["requestIdleCallback"] }).requestIdleCallback;
  if (originalCancelIdle) Object.defineProperty(window, "cancelIdleCallback", originalCancelIdle);
  else delete (window as { cancelIdleCallback?: Window["cancelIdleCallback"] }).cancelIdleCallback;
  if (originalVisibilityState) Object.defineProperty(document, "visibilityState", originalVisibilityState);
});

describe("query snapshot scheduling", () => {
  it("defers the large stringify/write until the browser is idle", () => {
    vi.useFakeTimers();
    localStorage.setItem(AUTH_TOKEN_KEY, "session-token");
    setActiveCompanyId(7);
    const idleCallbacks: IdleRequestCallback[] = [];
    Object.defineProperty(window, "requestIdleCallback", {
      configurable: true,
      value: vi.fn((callback: IdleRequestCallback) => {
        idleCallbacks.push(callback);
        return idleCallbacks.length;
      }),
    });
    Object.defineProperty(window, "cancelIdleCallback", {
      configurable: true,
      value: vi.fn(),
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const qc = new QueryClient();
    install(qc);
    setItem.mockClear();

    qc.setQueryData(["mfg-sales-orders", "all"], [{ id: "SO-1" }]);
    vi.advanceTimersByTime(1_200);

    expect(idleCallbacks).toHaveLength(1);
    expect(setItem.mock.calls.some(([key]) => String(key).startsWith("houzs-rq-snapshot:"))).toBe(false);

    idleCallbacks[0]({ didTimeout: false, timeRemaining: () => 10 });
    expect(setItem.mock.calls.some(([key]) => String(key).startsWith("houzs-rq-snapshot:"))).toBe(true);
  });

  it.each(["pagehide", "visibilitychange"] as const)(
    "does not flush the old company cache into the new company on %s",
    (eventName) => {
      vi.useFakeTimers();
      localStorage.setItem(AUTH_TOKEN_KEY, "company-switch-session");
      setActiveCompanyId(7);
      const qc = new QueryClient();
      install(qc);
      qc.setQueryData(["mfg-sales-orders", "all"], [{ id: "OLD-COMPANY-SO" }]);

      // TopNavbar writes the next company immediately before reload. This old
      // page's flush must not relabel its cache as company 8 data.
      setActiveCompanyId(8);
      if (eventName === "visibilitychange") {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value: "hidden",
        });
      }
      window.dispatchEvent(new Event(eventName));

      expect(snapshotKeys().some((key) => key.endsWith(":8"))).toBe(false);
      expect(
        snapshotKeys().some((key) =>
          localStorage.getItem(key)?.includes("OLD-COMPANY-SO"),
        ),
      ).toBe(false);
    },
  );

  it("binds a QueryClient installed signed out to an explicit SPA login", () => {
    vi.useFakeTimers();
    const idleCallbacks: IdleRequestCallback[] = [];
    Object.defineProperty(window, "requestIdleCallback", {
      configurable: true,
      value: vi.fn((callback: IdleRequestCallback) => {
        idleCallbacks.push(callback);
        return idleCallbacks.length;
      }),
    });
    Object.defineProperty(window, "cancelIdleCallback", {
      configurable: true,
      value: vi.fn(),
    });
    const qc = new QueryClient();
    install(qc);

    writeAuthToken("fresh-spa-session", true);
    qc.setQueryData(["mfg-sales-orders", "all"], [{ id: "NEW-SESSION-SO" }]);
    vi.advanceTimersByTime(1_200);
    expect(idleCallbacks).toHaveLength(1);
    idleCallbacks[0]({ didTimeout: false, timeRemaining: () => 10 });

    const key = snapshotKeys().find((candidate) => candidate.endsWith(":0"));
    expect(key).toBeTruthy();
    expect(localStorage.getItem(key!)).toContain("NEW-SESSION-SO");
  });

  it("reinstalling disposes the old cache and global listener wiring", () => {
    vi.useFakeTimers();
    localStorage.setItem(AUTH_TOKEN_KEY, "session-token");
    setActiveCompanyId(7);
    const removeEventListener = vi.spyOn(window, "removeEventListener");
    const oldClient = new QueryClient();
    const oldDispose = installQueryPersist(oldClient);
    const nextClient = new QueryClient();
    disposePersist = installQueryPersist(nextClient);

    expect(removeEventListener.mock.calls.some(([type]) => type === "pagehide")).toBe(true);
    expect(removeEventListener.mock.calls.some(([type]) => type === "visibilitychange")).toBe(true);

    oldClient.setQueryData(["mfg-sales-orders", "all"], [{ id: "OLD-WIRING-SO" }]);
    nextClient.setQueryData(["mfg-sales-orders", "all"], [{ id: "CURRENT-WIRING-SO" }]);
    window.dispatchEvent(new Event("pagehide"));

    const values = snapshotKeys().map((key) => localStorage.getItem(key) ?? "").join("\n");
    expect(values).toContain("CURRENT-WIRING-SO");
    expect(values).not.toContain("OLD-WIRING-SO");
    expect(() => oldDispose()).not.toThrow();
  });

  it("waits for the tenant instead of hydrating another company's snapshot", () => {
    vi.useFakeTimers();
    localStorage.setItem(AUTH_TOKEN_KEY, "cold-open-session");

    // Step 1: this same session, with NO company selected, writes a snapshot
    // into the hostname-default bucket.
    const seed = new QueryClient();
    const disposeSeed = installQueryPersist(seed);
    seed.setQueryData(["mfg-sales-orders", "all"], [{ id: "DEFAULT-COMPANY-SO" }]);
    window.dispatchEvent(new Event("pagehide"));
    disposeSeed();
    const defaultKey = snapshotKeys().find((key) => key.endsWith(":0"));
    expect(defaultKey).toBeTruthy();

    // Step 2: a cold open in a NEW tab. Somebody on this browser has picked a
    // company, so a null active company means "not resolved yet", not
    // "single-company install" — the default bucket must not be painted in.
    localStorage.setItem(ACTIVE_COMPANY_BY_USER_KEY, JSON.stringify({ u42: 7 }));
    sessionStorage.clear();
    releaseActiveCompanyBinding();

    const qc = new QueryClient();
    install(qc);
    expect(qc.getQueryData(["mfg-sales-orders", "all"])).toBeUndefined();

    // Step 3: /auth/me lands, the tab adopts user 42's company, and everything
    // it now writes belongs to company 7.
    adoptActiveCompanyForUser(42);
    expect(getActiveCompanyId()).toBe(7);
    expect(qc.getQueryData(["mfg-sales-orders", "all"])).toBeUndefined();
    qc.setQueryData(["mfg-sales-orders", "all"], [{ id: "COMPANY-7-SO" }]);
    window.dispatchEvent(new Event("pagehide"));

    const companyKey = snapshotKeys().find((key) => key.endsWith(":7"));
    expect(companyKey).toBeTruthy();
    expect(localStorage.getItem(companyKey!)).toContain("COMPANY-7-SO");
    expect(localStorage.getItem(companyKey!)).not.toContain("DEFAULT-COMPANY-SO");
  });

  it("drops old list rows when another tab replaces the remembered session", () => {
    vi.useFakeTimers();
    localStorage.setItem(AUTH_TOKEN_KEY, "first-session");
    setActiveCompanyId(7);
    const qc = new QueryClient();
    install(qc);
    qc.setQueryData(["mfg-sales-orders", "all"], [{ id: "FIRST-USER-SO" }]);
    expect(qc.getQueryData(["mfg-sales-orders", "all"])).toBeTruthy();

    localStorage.setItem(AUTH_TOKEN_KEY, "second-session");
    window.dispatchEvent(new StorageEvent("storage", {
      key: AUTH_TOKEN_KEY,
      oldValue: "first-session",
      newValue: "second-session",
      storageArea: localStorage,
    }));

    expect(qc.getQueryData(["mfg-sales-orders", "all"])).toBeUndefined();
    qc.setQueryData(["mfg-sales-orders", "all"], [{ id: "SECOND-USER-SO" }]);
    window.dispatchEvent(new Event("pagehide"));
    const values = snapshotKeys().map((key) => localStorage.getItem(key) ?? "").join("\n");
    expect(values).toContain("SECOND-USER-SO");
    expect(values).not.toContain("FIRST-USER-SO");
  });
});

// Beta project pages live in their own ":beta" slot (lib/query-persist.ts).
const betaKey = (kind: string, id: number): unknown[] => ["uq", "renovation-beta", kind, id, id];

function betaSlot(): string | undefined {
  return snapshotKeys().find((key) => key.endsWith(":beta"));
}

function betaSaved(): Record<string, unknown> {
  const slot = betaSlot();
  return slot ? (JSON.parse(localStorage.getItem(slot) ?? "{}") as Record<string, unknown>) : {};
}

function signedInAt(company: number, token = "beta-session"): QueryClient {
  writeAuthToken(token, true);
  setActiveCompanyId(company);
  const qc = new QueryClient();
  install(qc);
  return qc;
}

describe("Beta snapshot slot", () => {
  it("saves a Beta project page and hydrates it stale after a reload", () => {
    const qc = signedInAt(7);
    qc.setQueryData(betaKey("workspace", 12), { defects: [{ id: 1 }] });
    qc.setQueryData(betaKey("detail", 12), { project: { id: 12 } });
    window.dispatchEvent(new Event("pagehide"));
    expect(betaSlot()?.endsWith(":7:beta")).toBe(true);

    const reloaded = new QueryClient();
    install(reloaded);
    expect(reloaded.getQueryData(betaKey("workspace", 12))).toEqual({ defects: [{ id: 1 }] });
    expect(reloaded.getQueryData(betaKey("detail", 12))).toEqual({ project: { id: 12 } });
    // Never trusted as fresh: stamped far in the past so the page refetches on mount.
    expect(reloaded.getQueryState(betaKey("detail", 12))?.dataUpdatedAt).toBe(1);
    expect(reloaded.getQueryState(betaKey("detail", 12))?.isInvalidated).toBe(false);
  });

  it("saves the board of one project and the all-project board", () => {
    const qc = signedInAt(7);
    qc.setQueryData(["uq", "renovation-beta", "board", "", "", 0], { projects: [{ id: 12 }, { id: 13 }] });
    qc.setQueryData(["uq", "renovation-beta", "board", "", "", 12, 12], { projects: [{ id: 12 }] });
    window.dispatchEvent(new Event("pagehide"));
    expect(Object.keys(betaSaved())).toHaveLength(2);
  });

  it("does not save a non-Beta uq key or the live timeline", () => {
    const qc = signedInAt(7);
    qc.setQueryData(["uq", "other-feature", 12], { secret: "NOT-BETA" });
    qc.setQueryData(betaKey("timeline", 12), { events: "LIVE-FEED" });
    qc.setQueryData(betaKey("detail", 12), { project: "KEPT" });
    window.dispatchEvent(new Event("pagehide"));

    const values = snapshotKeys().map((key) => localStorage.getItem(key) ?? "").join("\n");
    expect(values).toContain("KEPT");
    expect(values).not.toContain("NOT-BETA");
    expect(values).not.toContain("LIVE-FEED");
  });

  it("saves the tab data a project tab opens with, and restores it stale", () => {
    const qc = signedInAt(7);
    const kinds = ["site", "lines", "photos", "vo", "client-po", "defects", "sheets"];
    for (const kind of kinds) qc.setQueryData(betaKey(kind, 12), { kind });
    window.dispatchEvent(new Event("pagehide"));

    const reloaded = new QueryClient();
    install(reloaded);
    for (const kind of kinds) {
      expect(reloaded.getQueryData(betaKey(kind, 12))).toEqual({ kind });
      expect(reloaded.getQueryState(betaKey(kind, 12))?.dataUpdatedAt).toBe(1);
    }
  });

  it("the written Beta slot never goes over the cap, braces and commas included", () => {
    const qc = signedInAt(7);
    for (let id = 1; id <= 3; id++) qc.setQueryData(betaKey("workspace", id), { big: "x".repeat(340_000) }, { updatedAt: id * 1000 });
    window.dispatchEvent(new Event("pagehide"));
    expect((localStorage.getItem(betaSlot() ?? "") ?? "").length).toBeLessThanOrEqual(1_000_000);
  });

  it("keeps the newest five projects", () => {
    const qc = signedInAt(7);
    for (let id = 1; id <= 7; id++) qc.setQueryData(betaKey("detail", id), { id }, { updatedAt: id * 1000 });
    window.dispatchEvent(new Event("pagehide"));
    const ids = Object.keys(betaSaved()).map((k) => (JSON.parse(k) as unknown[])[3]);
    expect(ids.sort((a, b) => Number(a) - Number(b))).toEqual([3, 4, 5, 6, 7]);
  });

  it("over the cap drops the oldest project, still writes, and leaves the SCM slot alone", () => {
    const qc = signedInAt(7);
    const big = "x".repeat(450_000);
    qc.setQueryData(["mfg-sales-orders", "all"], [{ id: "SCM-ROW" }]);
    qc.setQueryData(betaKey("workspace", 1), { big, who: "OLDEST" }, { updatedAt: 1000 });
    qc.setQueryData(betaKey("workspace", 2), { big, who: "MIDDLE" }, { updatedAt: 2000 });
    qc.setQueryData(betaKey("workspace", 3), { big, who: "NEWEST" }, { updatedAt: 3000 });
    window.dispatchEvent(new Event("pagehide"));

    const slot = localStorage.getItem(betaSlot() ?? "") ?? "";
    expect(slot.length).toBeLessThanOrEqual(1_000_000);
    expect(slot).toContain("NEWEST");
    expect(slot).toContain("MIDDLE");
    expect(slot).not.toContain("OLDEST");
    const scm = snapshotKeys().find((key) => key.endsWith(":7"));
    expect(localStorage.getItem(scm ?? "")).toContain("SCM-ROW");
  });

  it("a Beta payload over the cap on its own does not stop the SCM lists from saving", () => {
    const qc = signedInAt(7);
    qc.setQueryData(["mfg-sales-orders", "all"], [{ id: "SCM-ROW" }]);
    qc.setQueryData(betaKey("workspace", 1), { big: "x".repeat(1_200_000) });
    window.dispatchEvent(new Event("pagehide"));
    expect(betaSlot()).toBeUndefined();
    const scm = snapshotKeys().find((key) => key.endsWith(":7"));
    expect(localStorage.getItem(scm ?? "")).toContain("SCM-ROW");
  });

  it("does not hydrate another session's Beta snapshot, and prunes it", () => {
    const first = signedInAt(7, "beta-first-user");
    first.setQueryData(betaKey("detail", 12), { project: "FIRST-USER-PROJECT" });
    window.dispatchEvent(new Event("pagehide"));
    expect(betaSlot()).toBeDefined();

    writeAuthToken("beta-second-user", true);
    const second = new QueryClient();
    install(second);
    expect(second.getQueryData(betaKey("detail", 12))).toBeUndefined();
    expect(betaSlot()).toBeUndefined();
  });

  it("does not hydrate another company's Beta snapshot", () => {
    const seven = signedInAt(7);
    seven.setQueryData(betaKey("detail", 12), { project: "COMPANY-7-PROJECT" });
    window.dispatchEvent(new Event("pagehide"));

    setActiveCompanyId(8);
    const eight = new QueryClient();
    install(eight);
    expect(eight.getQueryData(betaKey("detail", 12))).toBeUndefined();
  });

  it("sign-out removes Beta queries from memory and the snapshot from disk", () => {
    const qc = signedInAt(7, "beta-signout-user");
    qc.setQueryData(betaKey("detail", 12), { project: "SIGNED-OUT-PROJECT" });
    qc.setQueryData(["uq", "renovation-beta", "site", 12, 12], { photos: 1 });
    window.dispatchEvent(new Event("pagehide"));
    expect(betaSlot()).toBeDefined();

    clearAuthToken();
    expect(qc.getQueryData(betaKey("detail", 12))).toBeUndefined();
    expect(qc.getQueryData(["uq", "renovation-beta", "site", 12, 12])).toBeUndefined();
    expect(snapshotKeys()).toHaveLength(0);
  });

  it("isBetaKey matches only the renovation-beta namespace", () => {
    expect(isBetaKey(["uq", "renovation-beta", "board", "", "", 0])).toBe(true);
    expect(isBetaKey(["uq", "renovation-beta"])).toBe(true);
    expect(isBetaKey(["uq", "renovation-beta-other"])).toBe(false);
    expect(isBetaKey(["renovation-beta", "board"])).toBe(false);
    expect(isBetaKey(["mfg-sales-orders", "all"])).toBe(false);
  });
});
