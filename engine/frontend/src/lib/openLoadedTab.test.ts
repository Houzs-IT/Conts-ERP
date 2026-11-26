import { afterEach, describe, expect, it, vi } from "vitest";
import { openLoadedTab, POPUP_BLOCKED_MESSAGE } from "./openLoadedTab";

function fakeTab() {
  return { opener: {} as unknown, location: { href: "" }, close: vi.fn() };
}

describe("openLoadedTab", () => {
  afterEach(() => vi.restoreAllMocks());

  it("opens the tab before the file has loaded, then points it at the file", async () => {
    const tab = fakeTab();
    const open = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    let resolve!: (u: string) => void;
    const done = openLoadedTab(() => new Promise<string>((r) => { resolve = r; }), null);
    // Still inside the tap: the tab must already exist.
    expect(open).toHaveBeenCalledWith("", "_blank");
    expect(tab.location.href).toBe("");
    resolve("blob:x");
    await done;
    expect(tab.location.href).toBe("blob:x");
    expect(tab.opener).toBeNull();
  });

  it("closes the empty tab and rethrows when the file fails to load", async () => {
    const tab = fakeTab();
    vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    await expect(openLoadedTab(() => Promise.reject(new Error("404")), null)).rejects.toThrow("404");
    expect(tab.close).toHaveBeenCalled();
  });

  it("says the popup was blocked instead of doing nothing", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    const load = vi.fn(async () => "blob:x");
    await expect(openLoadedTab(load, null)).rejects.toThrow(POPUP_BLOCKED_MESSAGE);
    expect(load).not.toHaveBeenCalled();
  });
});

/* Houzs also scans its whole tree here so every other window.open is known to run
   synchronously in the click. Left out in Conts: this file came with the Mail
   Center re-sync (26 Nov 2026), and the engine's other window.open call sites were
   never audited against that rule, so the scan would gate unrelated screens. */
