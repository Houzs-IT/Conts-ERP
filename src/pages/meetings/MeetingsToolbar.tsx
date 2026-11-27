import { useState } from "react";
import { Bell, ChevronLeft, ChevronRight, Search, SlidersHorizontal, X } from "lucide-react";
import { cx as cn } from "../../lib/design-tokens";
import type { CalView } from "../../lib/meetings";
import { BTN, ICON_BTN, SEG_ITEM, SEG_OFF, SEG_ON, SEG_TRACK } from "./ui";

export interface MeetingsToolbarProps {
  isCompact: boolean;
  title: string;
  view: CalView;
  views: readonly CalView[];
  query: string;
  unread: number;
  onToday: () => void;
  onStep: (direction: -1 | 1) => void;
  onView: (view: CalView) => void;
  onQuery: (query: string) => void;
  onInbox: () => void;
  /** Rooms hidden plus colleagues added; shown on the Filters button. */
  activeFilterCount: number;
  onFilters: () => void;
}

/* Compact (phone, or a narrow window): a date row with a search button, then a full-width view switcher; search
   opens over the date row, and the unread count stays on the My meetings tab. Wide: one row with search and bell. */
export function MeetingsToolbar(p: MeetingsToolbarProps): JSX.Element {
  const [isSearchOpen, setIsSearchOpen] = useState(p.query !== "");
  const iconButton = cn(ICON_BTN, p.isCompact ? "h-11 w-11" : "h-9 w-9");
  const searchField = (
    <label className={cn("relative min-w-0", p.isCompact ? "flex-1" : "block")}>
      <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
      <input aria-label="Search meetings" placeholder="Search meetings, people, rooms…" autoFocus={p.isCompact && p.query === ""}
        className={cn("w-full rounded-full border border-line bg-card pl-9 pr-3", p.isCompact ? "h-11 text-[16px]" : "h-9 w-64 text-[13px]")}
        value={p.query} onChange={(e) => p.onQuery(e.target.value)} />
    </label>
  );
  const dateNav = (
    <span className="flex min-w-0 flex-1 items-center gap-1">
      <button type="button" className={cn(BTN, p.isCompact ? "h-11 px-3" : "h-9")} onClick={p.onToday}>Today</button>
      <button type="button" aria-label="Previous" className={iconButton} onClick={() => p.onStep(-1)}><ChevronLeft size={18} aria-hidden="true" /></button>
      <button type="button" aria-label="Next" className={iconButton} onClick={() => p.onStep(1)}><ChevronRight size={18} aria-hidden="true" /></button>
      <h2 className={cn("ml-1 min-w-0 truncate font-medium text-ink", p.isCompact ? "text-[17px]" : "text-[18px]")}>{p.title}</h2>
    </span>
  );
  // The sidebar holds the filters from lg up; below that this button opens them in a sheet.
  const filtersButton = (
    <button type="button" aria-label={p.activeFilterCount ? `Filters, ${p.activeFilterCount} on` : "Filters"} className={cn(iconButton, "relative lg:hidden")} onClick={p.onFilters}>
      <SlidersHorizontal size={18} aria-hidden="true" />
      {p.activeFilterCount > 0 && <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-on-primary">{p.activeFilterCount}</span>}
    </button>
  );
  const switcher = (
    <div className={cn(SEG_TRACK, p.isCompact && "w-full sm:w-auto sm:self-start")} role="group" aria-label="View">
      {p.views.map((v) => (
        <button key={v} type="button" aria-pressed={p.view === v} onClick={() => p.onView(v)}
          className={cn(SEG_ITEM, "px-3 capitalize", p.isCompact ? "h-11 flex-1" : "h-8", p.view === v ? SEG_ON : SEG_OFF)}>{v}</button>
      ))}
    </div>
  );

  if (p.isCompact) {
    return (
      <div className="flex flex-col gap-2 px-3 py-2">
        <div className="flex min-w-0 items-center gap-1">
          {isSearchOpen ? (
            <>
              {searchField}
              <button type="button" aria-label="Close search" className={iconButton} onClick={() => { setIsSearchOpen(false); p.onQuery(""); }}><X size={18} aria-hidden="true" /></button>
            </>
          ) : (
            <>
              {dateNav}
              <button type="button" aria-label="Search meetings" className={iconButton} onClick={() => setIsSearchOpen(true)}><Search size={18} aria-hidden="true" /></button>
              {filtersButton}
            </>
          )}
        </div>
        {switcher}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2">
      {dateNav}
      <div className="ml-auto flex items-center gap-2">
        {searchField}
        {switcher}
        {filtersButton}
        <button type="button" aria-label={`My meetings, ${p.unread} unread`} className={cn(iconButton, "relative")} onClick={p.onInbox}>
          <Bell size={18} aria-hidden="true" />
          {p.unread > 0 && <span className="absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-line px-1 text-[10px] font-bold text-on-primary">{p.unread}</span>}
        </button>
      </div>
    </div>
  );
}
