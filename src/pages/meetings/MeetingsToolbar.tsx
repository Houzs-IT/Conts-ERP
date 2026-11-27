import { useState } from "react";
import { Bell, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { cx as cn } from "../../lib/design-tokens";
import type { CalView } from "../../lib/meetings";
import { BTN, ICON_BTN, SEG_ITEM, SEG_OFF, SEG_ON, SEG_TRACK } from "./ui";

export interface MeetingsToolbarProps {
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
}

/* Phone: date row with search and bell, then a full-width view switcher; search opens over the date row.
   md and up: one row, search always shown. */
export function MeetingsToolbar(p: MeetingsToolbarProps): JSX.Element {
  const [isSearchOpen, setIsSearchOpen] = useState(p.query !== "");
  const searchField = (
    <label className={cn("relative min-w-0 flex-1 md:block md:flex-none", !isSearchOpen && "hidden")}>
      <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
      <input aria-label="Search meetings" placeholder="Search meetings, people, rooms…" autoFocus={isSearchOpen && p.query === ""}
        className="h-11 w-full rounded-full border border-line bg-card pl-9 pr-3 text-[16px] md:h-9 md:w-64 md:text-[13px]"
        value={p.query} onChange={(e) => p.onQuery(e.target.value)} />
    </label>
  );
  const inboxButton = (className: string) => (
    <button type="button" aria-label={`My meetings, ${p.unread} unread`} className={cn(ICON_BTN, "relative", className)} onClick={p.onInbox}>
      <Bell size={18} aria-hidden="true" />
      {p.unread > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-line px-1 text-[10px] font-bold text-on-primary">{p.unread}</span>}
    </button>
  );
  return (
    <div className="flex flex-col gap-2 px-3 py-2 sm:px-4 md:flex-row md:items-center">
      <div className="flex min-w-0 items-center gap-1">
        {isSearchOpen ? (
          <span className="flex min-w-0 flex-1 items-center gap-1 md:hidden">
            {searchField}
            <button type="button" aria-label="Close search" className={ICON_BTN} onClick={() => { setIsSearchOpen(false); p.onQuery(""); }}><X size={18} aria-hidden="true" /></button>
          </span>
        ) : null}
        <span className={cn("flex min-w-0 flex-1 items-center gap-1", isSearchOpen && "hidden md:flex")}>
          <button type="button" className={cn(BTN, "h-11 md:h-9")} onClick={p.onToday}>Today</button>
          <button type="button" aria-label="Previous" className={ICON_BTN} onClick={() => p.onStep(-1)}><ChevronLeft size={18} aria-hidden="true" /></button>
          <button type="button" aria-label="Next" className={ICON_BTN} onClick={() => p.onStep(1)}><ChevronRight size={18} aria-hidden="true" /></button>
          <h2 className="ml-1 min-w-0 truncate text-[17px] font-medium text-ink md:text-[18px]">{p.title}</h2>
          <button type="button" aria-label="Search meetings" className={cn(ICON_BTN, "ml-auto md:hidden")} onClick={() => setIsSearchOpen(true)}><Search size={18} aria-hidden="true" /></button>
          {inboxButton("md:hidden")}
        </span>
      </div>
      <div className="flex items-center gap-2 md:ml-auto">
        <span className="hidden md:block">{searchField}</span>
        <div className={cn(SEG_TRACK, "flex-1 md:flex-none")} role="group" aria-label="View">
          {p.views.map((v) => (
            <button key={v} type="button" aria-pressed={p.view === v} onClick={() => p.onView(v)}
              className={cn(SEG_ITEM, "h-11 flex-1 px-3 capitalize md:h-8 md:flex-none", p.view === v ? SEG_ON : SEG_OFF)}>{v}</button>
          ))}
        </div>
        {inboxButton("hidden md:inline-flex")}
      </div>
    </div>
  );
}
