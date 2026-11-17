/** A mouse wheel over a focused number input steps its value: scrolling down a form with the cursor resting on an
 *  amount quietly changed it (Houzs d4d768e73). One listener for the whole page, installed from main.tsx: the focused
 *  number input loses focus before the browser applies the step, and the page scrolls as the person meant. */
export function blurFocusedNumberOnWheel(event: Event): void {
  const target = event.target;
  if (target instanceof HTMLInputElement && target.type === 'number' && target === target.ownerDocument.activeElement) target.blur();
}

export function installNumberWheelGuard(doc: Document = document): () => void {
  doc.addEventListener('wheel', blurFocusedNumberOnWheel, { capture: true, passive: true });
  return () => doc.removeEventListener('wheel', blurFocusedNumberOnWheel, { capture: true });
}
