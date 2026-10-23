/* Small pieces the Beta Home and Calendar share, with the mockup's own sizes and colours (app.js: BTN, badge,
   condPill, the toast, the 720px phone switch). */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { errorText } from "../projects/renovation/renovationModel";
import { BETA, betaConditionTone } from "./renovationBetaTheme";
import { invalidateBeta, markPoDone } from "./renovationBetaBoardApi";
import { initials } from "./renovationBetaBoard";

/** The mockup's button: white, 1px border, 8px corners. */
export const BTN: CSSProperties = {
  minHeight: 34, padding: "0 12px", border: `1px solid ${BETA.border}`, borderRadius: 8, background: BETA.surface,
  font: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", color: BETA.ink,
};
/** The outlined teal button ("Book time", "Client approved"). */
export const BTN_MAIN: CSSProperties = { ...BTN, borderColor: BETA.accent, color: BETA.accentInk };
/** The filled teal button ("Assign"). */
export const BTN_FILL: CSSProperties = { ...BTN, background: BETA.accent, borderColor: BETA.accent, color: "#FFFFFF" };

export const CARD: CSSProperties = { background: BETA.surface, border: `1px solid ${BETA.line}`, borderRadius: 12 };

export const MUTED = BETA.muted;
export const INK_SOFT = "#3F4947";

/** Below 720px the mockup swaps tables for cards and stacks the calendar. */
export function useIsPhone(): boolean {
  const query = "(max-width: 719px)";
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export function Badge({ name, inverted = false }: { name: string; inverted?: boolean }): ReactElement {
  return (
    <span
      title={name}
      aria-label={name}
      style={{
        flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 22, height: 17, padding: "0 3px",
        borderRadius: 4, fontSize: 10, fontWeight: 700, letterSpacing: ".02em",
        background: inverted ? "#FFFFFF" : BETA.ink, color: inverted ? "#A12622" : "#FFFFFF",
      }}
    >
      {initials(name)}
    </span>
  );
}

/** The condition pill ("B - 3D amendment"). */
export function CondPill({ text, words }: { text: string; words: string }): ReactElement {
  const [ink, bg, dot] = betaConditionTone(words);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999, background: bg, color: ink, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>
      <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 4, background: dot }} />
      {text}
    </span>
  );
}

/** A line of text on a dashed box, for empty lists. */
export function EmptyBox({ children }: { children: ReactNode }): ReactElement {
  return <div style={{ padding: 18, textAlign: "center", color: MUTED, border: `1px dashed ${BETA.border}`, borderRadius: 10 }}>{children}</div>;
}

/** One short message at the bottom of the screen, as the mockup's toast. */
export function useToast(): { toast: ReactElement | null; show: (text: string) => void } {
  const [text, setText] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const show = useCallback((t: string): void => {
    setText(t);
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setText(null), 3500);
  }, []);
  useEffect(() => () => { if (timer.current != null) window.clearTimeout(timer.current); }, []);
  const toast = text ? (
    <div
      role="status"
      style={{
        position: "fixed", left: "50%", bottom: "calc(24px + env(safe-area-inset-bottom, 0px))", transform: "translateX(-50%)",
        background: BETA.ink, color: "#FFFFFF", padding: "10px 16px", borderRadius: 10, fontSize: 14, fontWeight: 600, zIndex: 100, maxWidth: "calc(100vw - 32px)",
      }}
    >
      {text}
    </div>
  ) : null;
  return { toast, show };
}

/** A failed load or save: shown, never hidden. */
export function ErrorBanner({ text, onRetry }: { text: string; onRetry?: () => void }): ReactElement {
  return (
    <div role="alert" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 10, background: "#FDF1F0", border: "1px solid #E8A5A2", color: "#A12622", fontSize: 14 }}>
      <span style={{ flex: "1 1 240px", minWidth: 0 }}>{text}</span>
      {onRetry && <button type="button" onClick={onRetry} style={BTN}>Try again</button>}
    </div>
  );
}

/** The mockup's "PO done" button. Shown only to people who may write; it sets the PO date to today and refreshes Beta. */
export function PoDoneButton({ projectId, today, onDone, onError }: { projectId: number; today: string; onDone: (text: string) => void; onError: (text: string) => void }): ReactElement {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  async function click(): Promise<void> {
    setBusy(true);
    try {
      await markPoDone(projectId, today);
      await invalidateBeta(queryClient);
      onDone("PO done");
    } catch (e) {
      onError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return <button type="button" disabled={busy} onClick={() => void click()} style={BTN_MAIN}>PO done</button>;
}
