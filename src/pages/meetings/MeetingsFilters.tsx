import type { ReactNode } from "react";
import { Link2, Users, X } from "lucide-react";
import { cx as cn } from "../../lib/design-tokens";
import { companyColor, INVITED_COLOR, OTHERS_COLOR, type ColorBy, type Person, type Room } from "../../lib/meetings";
import { DialogFrame } from "./kit";
import { PersonSearch } from "./MeetingsDialogs";
import { BTN, ICON_BTN, PRI, SEG_ITEM, SEG_OFF, SEG_ON, SEG_TRACK } from "./ui";

export interface MeetingsFiltersProps {
  /** "rail" is the desktop sidebar; "sheet" is the phone sheet, with 44px rows and 16px text. */
  density: "rail" | "sheet";
  rooms: Room[];
  roomFilter: Record<number, boolean>;
  onRoomFilter: (next: Record<number, boolean>) => void;
  colorBy: ColorBy;
  onColorBy: (next: ColorBy) => void;
  companies: string[];
  onlyMine: boolean;
  onOnlyMine: (next: boolean) => void;
  overlay: string[];
  onOverlay: (next: string[]) => void;
  me: string;
  people: Map<string, Person>;
  peopleList: Person[];
  onGuestLinks: () => void;
}

const COLOR_OPTIONS = [["room", "Room"], ["company", "Company"], ["me", "Me"]] as const;
const HEADING = "mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-faint";

export function MeetingsFilters(p: MeetingsFiltersProps): JSX.Element {
  const isSheet = p.density === "sheet";
  const row = cn("flex cursor-pointer items-center gap-2.5", isSheet ? "min-h-11 text-[15px]" : "min-h-[30px] text-[13px]");
  const box = isSheet ? "h-5 w-5" : undefined;
  const dot = "mr-2 inline-block h-2.5 w-2.5 rounded-full";
  const activeRooms = p.rooms.filter((r) => r.active);
  return (
    <>
      <div>
        <div className={HEADING}>Rooms</div>
        {activeRooms.map((r) => (
          <label key={r.id} className={row}>
            <input type="checkbox" className={box} checked={p.roomFilter[r.id] !== false} onChange={(e) => p.onRoomFilter({ ...p.roomFilter, [r.id]: e.target.checked })} style={{ accentColor: r.color }} />
            <span className="min-w-0 flex-1 truncate">{r.name}</span>
            <span title={`${r.seats} seats`} className="inline-flex flex-none items-center gap-1 text-[12px] tabular-nums text-faint">
              <Users size={13} aria-hidden="true" />{r.seats}<span className="sr-only"> seats</span>
            </span>
          </label>
        ))}
        {activeRooms.length === 0 && <p className="text-[12.5px] text-faint">No rooms yet.</p>}
      </div>
      <div>
        <div className={cn(HEADING, "mb-1.5")}>Colours show</div>
        <div className={SEG_TRACK} role="group" aria-label="Colours show">
          {COLOR_OPTIONS.map(([key, label]) => (
            <button key={key} type="button" aria-pressed={p.colorBy === key} onClick={() => p.onColorBy(key)}
              className={cn(SEG_ITEM, "flex-1", isSheet ? "h-11 text-[15px]" : "h-7 text-[12.5px]", p.colorBy === key ? SEG_ON : SEG_OFF)}>{label}</button>
          ))}
        </div>
        {p.colorBy === "me" && (
          <div className="mt-1.5 flex flex-col gap-0.5 text-[12.5px]">
            <span><span className={cn(dot, "bg-primary")} />I organise</span>
            <span><span className={dot} style={{ background: INVITED_COLOR }} />I'm invited</span>
            <span><span className={dot} style={{ background: OTHERS_COLOR }} />Others (room taken)</span>
          </div>
        )}
        {p.colorBy === "company" && (
          <div className="mt-1.5 flex flex-col gap-0.5 text-[12.5px]">
            {p.companies.map((c) => <span key={c}><span className={dot} style={{ background: companyColor(c, p.companies) }} />{c}</span>)}
          </div>
        )}
      </div>
      <div>
        <div className={HEADING}>Show</div>
        <label className={row}><input type="checkbox" className={box} checked={p.onlyMine} onChange={(e) => p.onOnlyMine(e.target.checked)} />Only my meetings</label>
        {p.overlay.map((o) => (
          <label key={o} className={row}><input type="checkbox" className={box} checked onChange={() => p.onOverlay(p.overlay.filter((x) => x !== o))} />{p.people.get(o)?.name ?? o}'s meetings</label>
        ))}
        <PersonSearch people={p.peopleList} exclude={[p.me, ...p.overlay]} placeholder="Add a colleague's calendar" inputClassName={isSheet ? "h-11 text-[16px]" : undefined}
          onPick={(k) => { p.onOverlay([...p.overlay, k]); p.onOnlyMine(true); }} />
      </div>
      <button type="button" className={cn(BTN, "justify-center", isSheet && "h-11")} onClick={p.onGuestLinks}><Link2 size={15} aria-hidden="true" />Make a guest booking link</button>
    </>
  );
}

/** The phone and tablet home of the sidebar: a bottom sheet with the month picker and the filters. */
export function MeetingsFilterSheet({ onClose, monthPicker, ...filters }: Omit<MeetingsFiltersProps, "density"> & { onClose: () => void; monthPicker: ReactNode }): JSX.Element {
  return (
    <DialogFrame label="Calendar filters" onClose={onClose} dirty={false} initialFocus="panel"
      className="fixed inset-0 z-[60] flex items-end justify-center bg-[var(--color-surface-scrim)]"
      panelClassName="relative flex max-h-[85dvh] w-full max-w-[560px] flex-col rounded-t-2xl bg-card shadow-xl">
      <div className="flex flex-none items-center justify-between border-b border-line-soft px-4 py-2">
        <h2 className="text-[17px] font-semibold text-ink">Filters</h2>
        <button type="button" aria-label="Close filters" className={cn(ICON_BTN, "h-11 w-11")} onClick={onClose}><X size={18} aria-hidden="true" /></button>
      </div>
      <div className="meet-scroll flex min-h-0 flex-col gap-5 overflow-y-auto px-4 pb-4 pt-3">
        {monthPicker}
        <MeetingsFilters density="sheet" {...filters} />
      </div>
      <div className="flex-none border-t border-line-soft px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
        <button type="button" className={cn(PRI, "h-11 w-full justify-center")} onClick={onClose}>Done</button>
      </div>
    </DialogFrame>
  );
}
