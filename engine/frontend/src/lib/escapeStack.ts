// ----------------------------------------------------------------------------
// escapeStack — Esc closes only the layer on top.
//
// Every modal, drawer and dialog used to add its own window keydown listener,
// so one Esc reached all of them at once: a confirm box asked "Discard
// changes?" over a form, and Esc closed the confirm AND the form behind it
// (Hookka #680 fixed the same thing). The shared layers (Modal, Panel,
// ResizableDrawer, the confirm / notify / prompt dialogs) now join this stack
// instead: an open layer pushes its close, a closed one pops it, and Esc runs
// only the newest.
//
// The one listener sits on window in the CAPTURE phase and stops the event
// there, so the per-page Esc listeners that have not joined the stack (forms,
// drawers, menus under the top layer) never see an Esc the top layer took.
// With nothing on the stack it does nothing and every old listener behaves
// as before. An Esc typed mid-IME composition is left alone.
// ----------------------------------------------------------------------------
import { useEffect, useRef } from "react";

const stack: { run: () => void }[] = [];

function onKeyDown(e: KeyboardEvent) {
  if (e.key !== "Escape" || e.isComposing) return;
  const top = stack[stack.length - 1];
  if (!top) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  top.run();
}

/** Put a close handler on top of the stack; the returned function takes it off. */
export function pushEscape(run: () => void): () => void {
  if (stack.length === 0) window.addEventListener("keydown", onKeyDown, true);
  const entry = { run };
  stack.push(entry);
  return () => {
    const i = stack.indexOf(entry);
    if (i >= 0) stack.splice(i, 1);
    if (stack.length === 0) window.removeEventListener("keydown", onKeyDown, true);
  };
}

/** Esc runs `onEscape` while `active` and this layer is the newest one open. */
export function useEscapeLayer(onEscape: () => void, active = true): void {
  const latest = useRef(onEscape);
  latest.current = onEscape;
  useEffect(() => {
    if (!active) return;
    return pushEscape(() => latest.current());
  }, [active]);
}
