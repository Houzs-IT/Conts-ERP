import type { ReactNode } from "react";
import { cn } from "../lib/utils";

interface Props {
  label: string;
  value: ReactNode;
  subtitle?: ReactNode;
  tone?: "default" | "success" | "warning" | "error";
  /** When set, the card renders as a button — focusable, keyboard-activatable. */
  onClick?: () => void;
  /** Highlight the card as the currently-selected drill-down (brass border + tint). */
  active?: boolean;
  /** Optional left colour rail (a Tailwind bg-* class, e.g. "bg-primary").
   *  When set, a thin vertical bar runs down the card's left edge to colour-
   *  code the metric. Omitted by default so existing callers are unchanged. */
  rail?: string;
  /**
   * The number is NOT KNOWN YET (first load, or a search/filter whose results
   * have not come back). Renders an explicit unknown marker instead of `value`.
   *
   * This exists because an aggregate computed from an empty-because-unloaded row
   * set is a real-looking zero: "Inventory Value RM 0.00" mid-search reads as a
   * fact, and an operator will act on it. A figure the app cannot vouch for must
   * never be rendered as a figure — least of all a money one.
   */
  pending?: boolean;
  /** Conts: the figure's data failed to load. The card says so, with Retry when `onRetry` is given, instead of
   *  staying on "Loading…" for ever (QA sweep, 15 Oct 2026, finding 13). Implies `pending`. */
  failed?: boolean;
  onRetry?: () => void;
}

/**
 * Atelier stat card — a slab on the cream canvas with a thin brass
 * top hairline that turns full-brass on hover. The number takes the
 * display weight; the label is a small uppercase eyebrow.
 *
 * Pass `onClick` to make the card a drill-down affordance. The element
 * type switches to <button> so it's keyboard-accessible; we also bump
 * hover affordance to make it read as clickable.
 */
export function StatCard({ label, value, subtitle, tone = "default", onClick, active, rail, pending: pendingProp, failed, onRetry }: Props) {
  const pending = pendingProp || failed;
  // A failed card holds its own Retry button, and a button cannot sit inside another.
  const clickable = failed ? undefined : onClick;
  const Tag = clickable ? "button" : "div";
  return (
    <Tag
      onClick={clickable}
      type={clickable ? "button" : undefined}
      aria-pressed={clickable ? !!active : undefined}
      className={cn(
        "group relative h-full overflow-hidden rounded-lg border border-border bg-surface px-4 py-4 text-left shadow-stone transition-all duration-200 hover:-translate-y-px hover:shadow-slab sm:px-5 sm:py-5",
        clickable &&
          "cursor-pointer hover:border-primary/40 focus:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30",
        active && "border-primary/60 bg-primary-soft/50 ring-1 ring-primary/30"
      )}
    >
      {/* Left colour rail — colour-codes the metric when `rail` is set. */}
      {rail && (
        <span className={cn("pointer-events-none absolute left-0 top-0 h-full w-1 rounded-l-lg", rail)} />
      )}

      {/* Brass top edge — thin by default, glows on hover (full when active) */}
      <span
        className={cn(
          "pointer-events-none absolute left-0 top-0 h-px w-full bg-gradient-to-r from-transparent to-transparent transition-opacity duration-300 group-hover:via-accent",
          active ? "via-accent" : "via-accent/40"
        )}
      />

      <div className="text-[10px] font-semibold uppercase tracking-brand text-ink-muted">
        {label}
      </div>
      <div
        className={cn(
          "mt-2 font-display text-[22px] font-extrabold leading-none tracking-tight sm:mt-3 sm:text-[26px]",
          pending && "text-ink-muted",
          !pending && tone === "default" && "text-ink",
          !pending && tone === "success" && "text-synced",
          !pending && tone === "warning" && "text-warning-text",
          !pending && tone === "error" && "text-err"
        )}
        aria-busy={pending || undefined}
        data-pending={pending ? "true" : undefined}
      >
        {pending ? <span title={failed ? "Could not load" : "Not loaded yet"}>&mdash;</span> : value}
      </div>
      {failed ? (
        <div role="alert" className="mt-2 flex flex-wrap items-center gap-x-2 text-[11px] font-medium text-err">
          <span>Couldn't load</span>
          {onRetry && (
            <button type="button" onClick={onRetry} className="font-semibold text-primary underline-offset-2 hover:underline">
              Retry
            </button>
          )}
        </div>
      ) : subtitle && (
        <div className="mt-2 text-[11px] font-medium text-ink-secondary">
          {pending ? "Loading…" : subtitle}
        </div>
      )}
    </Tag>
  );
}
