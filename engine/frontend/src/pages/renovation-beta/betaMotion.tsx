/* The motion of Beta, in one place: the springs and the variants the screens share. Built on Motion (motion.dev).
   Only transform and opacity move. BetaMotion makes every motion component honour the visitor's "reduce motion" setting
   (it drops the movement and keeps the fades), so wrap a page or a floating piece in it. */

import type { ReactElement, ReactNode } from "react";
import { MotionConfig, type Transition, type Variants } from "motion/react";

export const SPRING: Transition = { type: "spring", stiffness: 520, damping: 36 };
const SOFT: Transition = { type: "spring", stiffness: 380, damping: 34 };

/** A tab's content: it reveals its cards one after the other. */
export const STAGGER: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.055, delayChildren: 0.02 } } };
/** One card (or step, or row) of that reveal. */
export const RISE: Variants = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: SOFT } };

export function BetaMotion({ children }: { children: ReactNode }): ReactElement {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
