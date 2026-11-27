// Shared class names and small helpers for the Meetings page files (kept apart from
// the component files so React fast refresh works).
import { cx as cn } from "../../lib/design-tokens";
import { ROOM_COLORS, type Closure, type Room } from "../../lib/meetings";

export const CONTROL =
  "w-full rounded-control border border-line bg-card px-3 py-2 text-[13px] text-ink placeholder:text-faint focus:border-primary focus:outline-none";
export const LABEL = "flex flex-col gap-1 text-[11.5px] font-semibold uppercase tracking-wide text-faint";
export const BTN = "inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-card px-3.5 text-[13px] font-medium text-ink hover:bg-muted disabled:opacity-50";
export const PRI = "inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full bg-primary px-4 text-[13px] font-semibold text-on-primary hover:opacity-90 disabled:opacity-50";
export const BOOK_CTA = "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-[var(--meet-accent)] text-[14px] font-semibold text-white shadow-sm transition-[transform,background-color,box-shadow] hover:-translate-y-px hover:bg-[var(--meet-accent-hover)] hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--meet-accent)] active:translate-y-0 active:shadow-sm motion-reduce:transition-none motion-reduce:hover:translate-y-0";
export const SEG_TRACK = "flex rounded-full bg-sunken p-0.5";
export const SEG_ITEM = "rounded-full text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary";
export const SEG_ON = "bg-card font-semibold text-ink shadow-sm";
export const SEG_OFF = "text-muted-ink hover:text-ink";
export const CHIP = "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium";
export const chip = (on: boolean) => cn(CHIP, on ? "border-primary bg-primary-soft text-primary-ink" : "border-line bg-card text-ink");

/** A small "copied" helper used by guest links; falls back to selecting the text. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export type RoomForm = {
  id: number | null; name: string; location: string; address: string; floor: string; seats: number; equipment: string[]; days: number[]; openFrom: number; openTo: number;
  color: string; bufferMin: number; maxHours: number; advanceDays: number; active: boolean; closures: Closure[];
};
export const roomForm = (r: Room | null, count: number): RoomForm =>
  r
    ? { id: r.id, name: r.name, location: r.location, address: r.address ?? "", floor: r.floor, seats: r.seats, equipment: r.equipment, days: r.open_days, openFrom: r.open_from, openTo: r.open_to, color: r.color, bufferMin: r.buffer_min, maxHours: r.max_hours, advanceDays: r.advance_days, active: r.active, closures: r.closures }
    : { id: null, name: "", location: "Head office", address: "", floor: "", seats: 6, equipment: [], days: [1, 2, 3, 4, 5], openFrom: 9, openTo: 18, color: ROOM_COLORS[count % ROOM_COLORS.length], bufferMin: 0, maxHours: 0, advanceDays: 0, active: true, closures: [] };

