// SoLineBinderSelect — the PO line's "Source Sales Order line" picker.
//
// It reads the outstanding-SO list only once it is opened, one page at a time, for this line's item code, with the
// typed search sent to the server. Opening a PO used to load the whole list (5,121 lines on production) and re-run the
// MRP plan just to fill this box, even when nobody edited a line.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPanel, anchoredPanelStyle } from "../../../lib/anchoredPanel";
import { useOutstandingSoItemsPaged, type OutstandingSoItem } from "../lib/suppliers-queries";

export const soBinderOptionLabel = (s: Pick<OutstandingSoItem, "soDocNo" | "debtorName" | "remainingQty">): string =>
  `${s.soDocNo}${s.debtorName ? ` · ${s.debtorName}` : ""} · ${s.remainingQty} short`;

const rowStyle = {
  padding: "6px 10px",
  borderRadius: 6,
  fontSize: "var(--fs-13, 13px)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
} as const;
const noteStyle = { ...rowStyle, color: "var(--fg-muted, #888)", fontSize: "var(--fs-12, 12px)" } as const;

export function SoLineBinderSelect({
  itemCode,
  value,
  linkedLabel,
  onChange,
  disabled = false,
  className,
}: {
  itemCode: string;
  /** The bound SO line id, or '' / null for none. */
  value: string | null;
  /** The label of the line already bound when the editor opened (it may no longer be short, so not in the list). */
  linkedLabel: string | null;
  onChange: (soItemId: string | null) => void;
  disabled?: boolean;
  className?: string;
}) {
  const code = itemCode.trim();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuPos = useAnchoredPanel(wrapRef, open && !disabled, 280);

  const filters = useMemo(
    () => ({ q, category: "all", dateField: "soDate" as const, dateFrom: "", dateTo: "", cols: { itemCode: [code] } }),
    [q, code],
  );
  const pagesQ = useOutstandingSoItemsPaged(filters, { enabled: open && !disabled && code !== "" });
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = pagesQ;
  const rows = useMemo(() => {
    const seen = new Set<string>();
    const out: OutstandingSoItem[] = [];
    for (const p of pagesQ.data?.pages ?? []) for (const r of p.items) {
      if (seen.has(r.soItemId)) continue;
      seen.add(r.soItemId);
      out.push(r);
    }
    return out;
  }, [pagesQ.data]);

  // A line picked in this session keeps its label when the list moves away from it (new search, closed menu).
  const [picked, setPicked] = useState<{ id: string; label: string } | null>(null);
  const noneLabel = code ? "— None (stock replenishment) —" : "— Pick an item code first —";
  const selectedLabel = !value
    ? noneLabel
    : picked?.id === value
      ? picked.label
      : rows.find((r) => r.soItemId === value)
        ? soBinderOptionLabel(rows.find((r) => r.soItemId === value)!)
        : linkedLabel ?? "Linked Sales Order";

  const nextPageFailed = pagesQ.isFetchNextPageError;
  const pick = (id: string | null, label: string) => {
    setPicked(id ? { id, label } : null);
    onChange(id);
    setSearch("");
    setOpen(false);
  };

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <input
        className={className}
        aria-label="Source Sales Order line"
        value={open ? search : selectedLabel}
        placeholder={open ? `Search ${code} SO lines (SO no., customer, project)` : undefined}
        disabled={disabled || !code}
        onFocus={() => { setOpen(true); setSearch(""); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
        title={selectedLabel}
      />
      {open && !disabled && code && menuPos &&
        createPortal(
          <ul
            data-testid="so-line-binder-menu"
            style={{
              ...anchoredPanelStyle(menuPos),
              overflowY: "auto",
              margin: 0,
              padding: 4,
              listStyle: "none",
              background: "var(--c-paper, #fff)",
              border: "1px solid var(--line, #dcdcd2)",
              borderRadius: 8,
              boxShadow: "0 10px 28px rgba(17, 20, 15, 0.14)",
            }}
            onScroll={(e) => {
              if (!hasNextPage || isFetchingNextPage || nextPageFailed) return;
              const el = e.currentTarget;
              if (el.scrollHeight - el.scrollTop - el.clientHeight < 160) void fetchNextPage();
            }}
          >
            <Option label={noneLabel} selected={!value} onPick={() => pick(null, noneLabel)} />
            {value && linkedLabel && !rows.some((r) => r.soItemId === value) && picked?.id !== value && (
              <Option label={linkedLabel} selected onPick={() => pick(value, linkedLabel)} />
            )}
            {rows.map((r) => {
              const label = soBinderOptionLabel(r);
              return <Option key={r.soItemId} label={label} selected={r.soItemId === value} onPick={() => pick(r.soItemId, label)} />;
            })}
            {pagesQ.isLoading && <li style={noteStyle}>Loading Sales Order lines still short of {code}…</li>}
            {pagesQ.isError && !nextPageFailed && (
              <li style={{ ...noteStyle, color: "var(--c-festive-b, #B8331F)", whiteSpace: "normal" }}>
                Could not load the Sales Order lines. Close and open this box to try again.
              </li>
            )}
            {!pagesQ.isLoading && !pagesQ.isError && rows.length === 0 && (
              <li style={{ ...noteStyle, whiteSpace: "normal" }}>
                No Sales Order line is still short of {code}{q ? ` for "${q}"` : ""}.
              </li>
            )}
            {hasNextPage && (
              <li
                style={{ ...noteStyle, cursor: "pointer", borderTop: "1px solid var(--line, #dcdcd2)", marginTop: 2 }}
                onMouseDown={(e) => { e.preventDefault(); if (!isFetchingNextPage) void fetchNextPage(); }}
              >
                {isFetchingNextPage ? "Loading more…" : nextPageFailed ? "Loading more failed — click to try again." : "More lines — scroll, or click to load more."}
              </li>
            )}
          </ul>,
          document.body,
        )}
    </div>
  );
}

function Option({ label, selected, onPick }: { label: string; selected: boolean; onPick: () => void }) {
  return (
    <li
      onMouseDown={(e) => { e.preventDefault(); onPick(); }}
      style={{
        ...rowStyle,
        cursor: "pointer",
        color: "var(--c-ink, #1a1a1a)",
        background: selected ? "var(--c-cream, #f3f0e9)" : "transparent",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--c-cream, #f3f0e9)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = selected ? "var(--c-cream, #f3f0e9)" : "transparent"; }}
    >
      {label}
    </li>
  );
}
