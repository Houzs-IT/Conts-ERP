/* Small pieces the Beta Home and Calendar share, with the mockup's own sizes and colours (app.js: BTN, badge,
   condPill, the toast, the 720px phone switch). */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { BetaMotion } from "./betaMotion";
import { errorText } from "../projects/renovation/renovationModel";
import { BETA, GLASS, PILL_CONFIRM, PILL_GLASS, PILL_MAIN, TONES, betaConditionTone } from "./renovationBetaTheme";
import { invalidateBeta, markPoDone } from "./renovationBetaBoardApi";
import { initials } from "./renovationBetaBoard";

/** The glass pill: every button that is not the main action. */
export const BTN: CSSProperties = {
  ...PILL_GLASS, minHeight: 34, padding: "0 14px", font: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
};
/** The blue pill of the main action ("Book time"). */
export const BTN_MAIN: CSSProperties = { ...BTN, ...PILL_MAIN };
/** Also the blue pill ("Assign"): the designs draw every main action the same, so the old teal outline and teal fill merged. */
export const BTN_FILL: CSSProperties = BTN_MAIN;
/** The red-edged pill of "+ Amendment": a change request, not a plain action. */
export const BTN_AMEND: CSSProperties = { ...BTN, border: `1px solid ${TONES.red.line}`, color: TONES.red.ink };
/** The green pill of a confirming action ("Client approved", "PO done"). */
export const BTN_CONFIRM: CSSProperties = { ...BTN, ...PILL_CONFIRM };

/** A glass card with the design's big corners. */
export const CARD: CSSProperties = { ...GLASS, borderRadius: 26 };

export const MUTED = BETA.muted;
export const INK_SOFT = BETA.text2;

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
        background: inverted ? "#FFFFFF" : BETA.avatar, color: inverted ? "#A12622" : "#FFFFFF",
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
  return <div style={{ padding: 18, textAlign: "center", color: MUTED, border: `1px dashed ${BETA.border}`, borderRadius: 16 }}>{children}</div>;
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
  const toast = (
    <BetaMotion>
      <AnimatePresence>
        {text && (
          <motion.div
            key={text}
            role="status"
            initial={{ opacity: 0, y: 18, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 460, damping: 32 }}
            style={{
        x: "-50%", position: "fixed", left: "50%", bottom: "calc(24px + env(safe-area-inset-bottom, 0px))",
        background: BETA.avatar, color: "#FFFFFF", padding: "10px 16px", borderRadius: 999, fontSize: 14, fontWeight: 600, zIndex: 100, backdropFilter: BETA.blurSm, WebkitBackdropFilter: BETA.blurSm, maxWidth: "calc(100vw - 32px)",
      }}
    >
      {text}
          </motion.div>
        )}
      </AnimatePresence>
    </BetaMotion>
  );
  return { toast, show };
}

/** A failed load or save: shown, never hidden. */
export function ErrorBanner({ text, onRetry }: { text: string; onRetry?: () => void }): ReactElement {
  return (
    <div role="alert" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 10, background: TONES.red.soft, border: `1px solid ${TONES.red.line}`, color: TONES.red.ink, fontSize: 14 }}>
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
  return <button type="button" disabled={busy} onClick={() => void click()} style={BTN_CONFIRM}>PO done</button>;
}
