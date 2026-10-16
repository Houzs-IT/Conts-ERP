import { useEffect, useState } from "react";

/**
 * One device decision for the whole app, replacing the engine's two-way
 * useIsMobile() (touch && width < 1024 → phone UI, else desktop).
 *
 * The two-way split is why tablets and foldables look wrong today:
 *   iPad 820 portrait      → phone UI stretched to 820px
 *   Galaxy Z Fold inner    → phone UI stretched to ~884px
 *   iPad landscape 1180    → desktop with a 244px sidebar eating the width
 *   Surface Duo spanned    → desktop laid straight across the hinge
 *
 * Classes
 *   phone   < 600px            iPhone SE–Pro Max, Fold cover (344–390), Duo single pane (540)
 *   tablet  600–1199, touch    iPad mini/Air/Pro portrait + landscape, Fold inner screen
 *   dual    2 viewport segments Surface Duo spanned, Fold in book posture with the hinge API
 *   desktop fine pointer at 600px or wider, or ≥ 1200
 *
 * A desktop browser stays desktop at 600px and wider, however it is resized; below 600px it gets the phone
 * layout like any phone (owner, 16 Oct 2026). `?device=phone|tablet|dual|desktop` forces a class
 * for preview and lives in sessionStorage, same as the old `?mobile=1`.
 */
export type DeviceClass = "phone" | "tablet" | "dual" | "desktop";

export interface DeviceInfo {
  cls: DeviceClass;
  /** Pixel rects of each screen segment. One entry unless `cls === "dual"`. */
  segments: { x: number; y: number; width: number; height: number }[];
  /** "row" = side-by-side (Duo held like a book), "column" = stacked (laptop posture). */
  fold: "none" | "row" | "column";
}

const KEY = "tc_force_device";

function forced(): DeviceClass | null {
  try {
    const q = new URLSearchParams(window.location.search).get("device");
    if (q && ["phone", "tablet", "dual", "desktop"].includes(q)) sessionStorage.setItem(KEY, q);
    if (q === "auto") sessionStorage.removeItem(KEY);
    return (sessionStorage.getItem(KEY) as DeviceClass | null) ?? null;
  } catch {
    return null;
  }
}

function touch(): boolean {
  try {
    return matchMedia("(pointer: coarse)").matches || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  } catch {
    return false;
  }
}

/** Viewport Segments API (Chromium on Duo / Fold). Absent elsewhere → one segment. */
function segments(): DeviceInfo["segments"] {
  const v = (window as unknown as { viewport?: { segments?: DOMRect[] } }).viewport;
  const s = v?.segments;
  if (s && s.length > 1) return s.map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height }));
  return [{ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }];
}

export function readDevice(): DeviceInfo {
  const segs = segments();
  const fold: DeviceInfo["fold"] = segs.length < 2 ? "none" : segs[0].y === segs[1].y ? "row" : "column";
  const f = forced();
  if (f) return { cls: f, segments: segs, fold };
  if (segs.length > 1) return { cls: "dual", segments: segs, fold };
  const w = window.innerWidth;
  // Under 600px the desk layout cannot fit beside its sidebar, so even a computer window gets the phone layout
  // (owner, 16 Oct 2026). Wider computer windows stay desktop however they are resized.
  if (w < 600) return { cls: "phone", segments: segs, fold };
  if (!touch()) return { cls: "desktop", segments: segs, fold };
  return { cls: w < 600 ? "phone" : w < 1200 ? "tablet" : "desktop", segments: segs, fold };
}

export function useDevice(): DeviceInfo {
  const [d, setD] = useState<DeviceInfo>(() =>
    typeof window === "undefined" ? { cls: "desktop", segments: [], fold: "none" } : readDevice(),
  );
  useEffect(() => {
    const update = () => setD(readDevice());
    // resize fires on rotate and on fold/unfold; orientationchange covers older iOS.
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    const v = (window as unknown as { viewport?: EventTarget }).viewport;
    v?.addEventListener?.("segmentschange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      v?.removeEventListener?.("segmentschange", update);
    };
  }, []);
  return d;
}

/** Drop-in for the old hook so existing call sites keep compiling during migration. */
export function useIsMobile(): boolean {
  return useDevice().cls === "phone";
}
