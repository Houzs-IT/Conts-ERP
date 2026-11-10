// Conts only (not part of Houzs's code): the one frame every block of the Ledger setup page sits in (chew 10 Nov 2026:
// "ledger setup 很乱" — eight blocks in several widths and title styles). Same width, padding, border and title for
// every block; each block keeps its own content.
import type { ReactNode } from "react";

export function SetupCard({ title, description, aside, children }: {
  title: string;
  /** One or two plain sentences under the title: what the block is for. */
  description?: ReactNode;
  /** Something for the title's right side, e.g. a status badge. */
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="rounded-xl border border-border bg-surface p-4 shadow-sm"
      style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
      <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <h2 className="text-[15px] font-semibold text-ink" style={{ margin: 0 }}>{title}</h2>
          {description != null && <p className="text-[13px] text-ink-muted" style={{ margin: "4px 0 0", maxWidth: 820 }}>{description}</p>}
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}
