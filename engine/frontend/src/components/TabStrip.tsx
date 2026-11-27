import { cn } from "../lib/utils";

/**
 * Page-level tab strip — underlined, brass-accent on active.
 *
 * Matches the tab style used in the Trips page so every module that
 * splits its own surface into tabs (Projects: List/Calendar,
 * Service Cases: Cases/Quality Metrics, Trips: Queue/Drafts/…)
 * looks the same. Filter chips inside a page keep using
 * <FilterPills> — those are for value selection, not navigation.
 */

export interface TabOption<V extends string> {
  value: V;
  label: string;
  /** Hide this tab entirely when false. Omit to always show. */
  show?: boolean;
  /** Optional trailing count badge. */
  count?: number;
}

interface Props<V extends string> {
  value: V;
  onChange: (next: V) => void;
  options: TabOption<V>[];
  className?: string;
}

export function TabStrip<V extends string>({
  value,
  onChange,
  options,
  className,
}: Props<V>) {
  const visible = options.filter((o) => o.show !== false);
  return (
    <div
      className={cn(
        // A solid box behind the row so the tabs never sit straight on the page backdrop (27 Nov 2026).
        "mb-4 w-fit max-w-full rounded-lg border border-border bg-surface px-1",
        className
      )}
    >
      <div
        className={cn(
          // Hidden scrollbar keeps the brass aesthetic; the row scrolls inside the box on a phone.
          "no-scrollbar flex items-center gap-1 overflow-x-auto",
          // Stop the row from compressing children; let them keep
          // their natural width so long labels never get clipped.
          "[&>*]:shrink-0"
        )}
      >
        {visible.map((t) => {
          const active = t.value === value;
          return (
            <button
              key={t.value}
              onClick={() => onChange(t.value)}
              className={cn(
                "relative -mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-[12px] font-semibold transition-colors",
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-ink-secondary hover:text-ink"
              )}
            >
              {t.label}
              {t.count != null && t.count > 0 && (
                <span
                  className={cn(
                    "box-border inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full border px-[5px] text-[11px] font-semibold tabular-nums",
                    active
                      ? "border-primary bg-primary text-white"
                      : "border-ink-muted bg-transparent text-ink-secondary"
                  )}
                >
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
