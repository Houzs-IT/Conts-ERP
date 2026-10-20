/* Renovation mode (Conts, 14 Oct 2026; migrations 0112, 0115): the line items of
   a sales order by room, used by New SO and Edit SO. Each room is a header row
   (name, line count, move up / down, delete when empty) with its lines straight
   under it and "Add line to <room>". Every line belongs to a room: before a layout
   is chosen the order has one room, Common area, and a line with no room shows
   there (placeRows). Rooms are made from the layout as soon as one is chosen;
   "Generate rooms from layout" adds the missing ones later, asking first. A line
   moves to another room from its small move button. Line numbers run in the order
   shown. Totals, payments and the line cards themselves are Houzs's, unchanged.
   With `card` (New SO, owner 20 Oct 2026) each room is a card of its own in place of
   the one "Line items" card: the rooms are the order's main sections. */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowRightLeft, ArrowUp, LayoutGrid, Plus, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useConfirm } from '../../vendor/scm/components/ConfirmDialog';
import { generateRooms, moveRoom, nextRoomName, placeRows, renameRoom } from '../renovation/roomSections';

/** One line: its key, its saved room, and how to draw it given its number in the order shown (0-based). */
export interface RoomRow { key: string; room: string; render: (displayIndex: number) => ReactNode }
export interface RoomLayout { label: string; bedrooms: number; bathrooms: number }
/** The page's own card classes, so a room looks like the page's other sections. */
export interface RoomCard { section: string; header: string; title: string; body: string }

const btn = 'inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12px] font-semibold text-ink-secondary hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50';
const iconBtn = 'rounded p-1 text-ink-secondary hover:bg-surface-dim hover:text-ink disabled:opacity-30';

function RoomName({ name, disabled, inTitle, onRename }: { name: string; disabled?: boolean; inTitle?: boolean; onRename: (to: string) => boolean }) {
  const [draft, setDraft] = useState(name);
  const [bad, setBad] = useState(false);
  const [seen, setSeen] = useState(name);
  if (seen !== name) { setSeen(name); setDraft(name); }
  const commit = () => {
    if (draft === name) return;
    if (onRename(draft)) setBad(false);
    else { setBad(true); setDraft(name); }
  };
  return (
    <input
      aria-label="Room name"
      title={bad ? 'That name is blank or another room has it' : undefined}
      className={cn('min-w-0 flex-1 rounded-md border bg-transparent focus:bg-surface',
        /* Inputs do not inherit the font, so in a card title it is passed down to match the other cards. */
        inTitle ? '-my-1 h-[22px] w-full px-1.5 [font:inherit] [letter-spacing:inherit] [text-transform:inherit] text-inherit' : 'h-8 px-2 text-[13px] font-bold uppercase tracking-wide text-ink',
        bad ? 'border-err' : 'border-transparent hover:border-border focus:border-primary')}
      value={draft}
      disabled={disabled}
      onChange={(e) => { setDraft(e.target.value); setBad(false); }}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
    />
  );
}

/** The small move button on a line: a short list of the other rooms. */
function MoveLine({ rooms, current, onMove }: { rooms: string[]; current: string; onMove: (room: string) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const others = rooms.filter((r) => r !== current);
  if (others.length === 0) return null;
  return (
    <div ref={box} className="absolute -top-2.5 right-10 z-10">
      <button type="button" aria-label="Move this line to another room" title="Move to another room" onClick={() => setOpen((x) => !x)}
        className="inline-flex h-6 items-center gap-1 rounded-full border border-border bg-surface px-2 text-[11px] font-semibold text-ink-secondary shadow-sm hover:border-primary hover:text-primary">
        <ArrowRightLeft size={12} /> Move
      </button>
      {open && (
        <ul role="menu" className="absolute right-0 mt-1 max-h-60 w-48 overflow-auto rounded-md border border-border bg-surface py-1 shadow-lg">
          {others.map((r) => (
            <li key={r}>
              <button type="button" role="menuitem" className="block w-full px-3 py-1.5 text-left text-[12.5px] hover:bg-primary-soft"
                onClick={() => { setOpen(false); onMove(r); }}>{r}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function RenovationSoRooms({ rooms, onRoomsChange, rows, onRowRoom, onAddLine, layout, disabled, card }: {
  rooms: string[];
  /** `rename` is set when one room was renamed, so the parent moves its lines too. */
  onRoomsChange: (next: string[], rename?: { from: string; to: string }) => void;
  rows: RoomRow[];
  onRowRoom: (key: string, room: string) => void;
  onAddLine: (room: string) => void;
  layout: RoomLayout | null;
  disabled?: boolean;
  /** Each room as its own card (the page's classes) instead of rows inside one card. */
  card?: RoomCard;
}) {
  const [note, setNote] = useState<string | null>(null);
  const confirm = useConfirm();
  const placed = placeRows(rooms, rows);
  const shown = placed.rooms;
  const groups = shown.map((room) => ({ room, rows: rows.filter((r) => placed.roomOf[r.key] === room) }));
  /* Line numbers in the order shown, across rooms. */
  const numberOf = new Map<string, number>();
  let n = 0;
  for (const g of groups) for (const r of g.rows) numberOf.set(r.key, n++);

  const generate = async () => {
    if (!layout) return;
    const r = generateRooms(shown, layout.bedrooms, layout.bathrooms);
    if (r.added.length === 0) { setNote('Every room of this layout is already here.'); return; }
    if (rows.length > 0 && !(await confirm({
      title: 'Add the rooms of this layout?',
      body: `${r.added.join(', ')} will be added. The rooms already here and their lines stay as they are.`,
      confirmLabel: 'Add rooms',
    }))) return;
    setNote(`Added ${r.added.join(', ')}.`);
    onRoomsChange(r.rooms);
  };

  const toolbar = (
    <div className={cn('flex flex-wrap items-center justify-end gap-2', !card && 'mb-2')}>
      {note && <span role="status" className="text-[12px] text-ink-secondary">{note}</span>}
      {!layout && <span className="text-[12px] text-ink-muted">Choose the layout under Order information to make the rooms.</span>}
      {!disabled && (
        <button type="button" className={btn} onClick={() => onRoomsChange([...shown, nextRoomName(shown)])}>
          <Plus size={14} /> Add room
        </button>
      )}
      <button type="button" className={btn} onClick={() => { void generate(); }} disabled={disabled || !layout}
        title={layout ? `${layout.label}: Living hall, ${layout.bedrooms} bedroom(s), ${layout.bathrooms} bathroom(s), Common area` : undefined}>
        <LayoutGrid size={14} /> Generate rooms from layout
      </button>
    </div>
  );

  const roomParts = (g: { room: string; rows: RoomRow[] }, i: number) => ({
    name: (
      <RoomName name={g.room} disabled={disabled} inTitle={!!card} onRename={(to) => {
        const next = renameRoom(shown, g.room, to);
        if (!next) return false;
        onRoomsChange(next, { from: g.room, to: next[i]! });
        /* Lines shown here without a saved room (Common area by default) follow the new name too. */
        for (const row of g.rows) if (row.room !== next[i]) onRowRoom(row.key, next[i]!);
        return true;
      }} />
    ),
    controls: (
      <>
        <span className="whitespace-nowrap px-1 text-[11px] text-ink-secondary">{g.rows.length} line{g.rows.length === 1 ? '' : 's'}</span>
        {!disabled && (
          <>
            <button type="button" aria-label={`Move ${g.room} up`} className={iconBtn} disabled={i === 0} onClick={() => onRoomsChange(moveRoom(shown, i, -1))}><ArrowUp size={15} /></button>
            <button type="button" aria-label={`Move ${g.room} down`} className={iconBtn} disabled={i === groups.length - 1} onClick={() => onRoomsChange(moveRoom(shown, i, 1))}><ArrowDown size={15} /></button>
            <button type="button" aria-label={`Delete ${g.room}`} className={iconBtn} disabled={g.rows.length > 0 || shown.length === 1}
              title={g.rows.length > 0 ? 'Move or remove its lines first' : shown.length === 1 ? 'An order keeps at least one room' : 'Delete this room'}
              onClick={() => onRoomsChange(shown.filter((r) => r !== g.room))}><Trash2 size={15} /></button>
          </>
        )}
      </>
    ),
    lines: (
      <div className="flex flex-col gap-3">
        {g.rows.map((row) => (
          <div key={row.key} className="relative">
            {!disabled && <MoveLine rooms={shown} current={g.room} onMove={(room) => onRowRoom(row.key, room)} />}
            {row.render(numberOf.get(row.key) ?? 0)}
          </div>
        ))}
        {g.rows.length === 0 && disabled && <p className="px-2 text-[12px] text-ink-muted">No lines in this room.</p>}
        {!disabled && (
          <button type="button" onClick={() => onAddLine(g.room)}
            className="inline-flex items-center gap-1.5 self-start rounded-md px-2 py-1 text-[12.5px] font-semibold text-primary hover:bg-primary-soft">
            <Plus size={14} /> Add line to {g.room}
          </button>
        )}
      </div>
    ),
  });

  if (card) {
    return (
      <>
        {toolbar}
        {groups.map((g, i) => {
          const p = roomParts(g, i);
          return (
            <section key={g.room} aria-label={g.room} className={card.section}>
              <header className={card.header}>
                <h2 className={cn(card.title, 'min-w-0 flex-1')}>{p.name}</h2>
                <div className="flex flex-none items-center gap-1">{p.controls}</div>
              </header>
              <div className={card.body}>{p.lines}</div>
            </section>
          );
        })}
      </>
    );
  }

  return (
    <div className="flex flex-col">
      {toolbar}
      {groups.map((g, i) => {
        const p = roomParts(g, i);
        return (
          <section key={g.room} className="border-t border-border pt-2 pb-3 first-of-type:border-t-0">
            <header className="mb-2 flex items-center gap-1">{p.name}{p.controls}</header>
            {p.lines}
          </section>
        );
      })}
    </div>
  );
}

/** The order's layout for the rooms, from the Order information block (null when not chosen). */
export function roomLayoutOf(v: { layoutLabel: string; bedrooms: string; bathrooms: string }): RoomLayout | null {
  const b = Number(v.bedrooms);
  const t = Number(v.bathrooms);
  if (v.bedrooms === '' || v.bathrooms === '' || !Number.isInteger(b) || !Number.isInteger(t)) return null;
  return { label: v.layoutLabel || `${b} bed ${t} bath`, bedrooms: b, bathrooms: t };
}
