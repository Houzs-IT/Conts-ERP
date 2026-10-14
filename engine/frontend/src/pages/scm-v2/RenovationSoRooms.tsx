/* Renovation mode (Conts, 14 Oct 2026; mig 0112): the line items of a sales order
   grouped into rooms, used by New SO and Edit SO. A room is a heading with its
   lines under it: rename, reorder, delete when empty, add a line into it.
   "Generate rooms from layout" adds Living hall, Bedroom 1..N, Bathroom 1..M and
   Common area from the order's layout (only the missing ones). Each line keeps its
   own card; a small Room picker above it moves it between rooms. Totals,
   payments and the line cards themselves are Houzs's, unchanged. */

import { useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, LayoutGrid, Plus, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { generateRooms, groupByRoom, moveRoom, nextRoomName, renameRoom } from '../renovation/roomSections';

export interface RoomRow { key: string; room: string; node: ReactNode }
export interface RoomLayout { label: string; bedrooms: number; bathrooms: number }

const btn = 'inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12px] font-semibold text-ink-secondary hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50';
const iconBtn = 'p-1 text-ink-secondary hover:text-ink disabled:opacity-30';

function RoomName({ name, disabled, onRename }: { name: string; disabled?: boolean; onRename: (to: string) => boolean }) {
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
      className={cn('h-8 min-w-0 flex-1 rounded-md border bg-transparent px-2 text-[13px] font-bold uppercase tracking-wide text-ink focus:bg-surface',
        bad ? 'border-err' : 'border-transparent hover:border-border focus:border-primary')}
      value={draft}
      disabled={disabled}
      onChange={(e) => { setDraft(e.target.value); setBad(false); }}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
    />
  );
}

export function RenovationSoRooms({ rooms, onRoomsChange, rows, onRowRoom, onAddLine, layout, disabled }: {
  rooms: string[];
  /** `rename` is set when one room was renamed, so the parent moves its lines too. */
  onRoomsChange: (next: string[], rename?: { from: string; to: string }) => void;
  rows: RoomRow[];
  onRowRoom: (key: string, room: string) => void;
  onAddLine: (room: string) => void;
  layout: RoomLayout | null;
  disabled?: boolean;
}) {
  const [note, setNote] = useState<string | null>(null);
  const { groups, unplaced } = groupByRoom(rooms, rows);

  const generate = () => {
    if (!layout) return;
    const r = generateRooms(rooms, layout.bedrooms, layout.bathrooms);
    setNote(r.added.length ? `Added ${r.added.join(', ')}.` : 'Every room of this layout is already here.');
    if (r.added.length) onRoomsChange(r.rooms);
  };

  const roomPicker = (row: RoomRow) => (
    <label className="mb-1 flex items-center justify-end gap-2 text-[11px] font-semibold uppercase tracking-wide text-ink-secondary">
      Room
      <select className="h-7 rounded-md border border-border bg-surface px-2 text-[12px] normal-case tracking-normal text-ink" value={rooms.some((r) => r === row.room) ? row.room : ''}
        disabled={disabled} onChange={(e) => onRowRoom(row.key, e.target.value)}>
        <option value="">Not in a room</option>
        {rooms.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
    </label>
  );

  const addLineBtn = (room: string, label: string) => !disabled && (
    <button type="button" onClick={() => onAddLine(room)}
      className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-2 text-[12.5px] font-semibold text-ink-secondary hover:border-primary hover:text-primary">
      <Plus size={14} /> {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {note && <span role="status" className="text-[12px] text-ink-secondary">{note}</span>}
        {!layout && <span className="text-[12px] text-ink-muted">Choose the layout under Order information to generate rooms.</span>}
        {!disabled && (
          <button type="button" className={btn} onClick={() => onRoomsChange([...rooms, nextRoomName(rooms)])}>
            <Plus size={14} /> Add room
          </button>
        )}
        <button type="button" className={btn} onClick={generate} disabled={disabled || !layout}
          title={layout ? `${layout.label}: Living hall, ${layout.bedrooms} bedroom(s), ${layout.bathrooms} bathroom(s), Common area` : undefined}>
          <LayoutGrid size={14} /> Generate rooms from layout
        </button>
      </div>

      {groups.map((g, i) => (
        <section key={g.room} className="rounded-lg border border-border bg-surface-dim/40">
          <header className="flex items-center gap-1 border-b border-border px-2 py-1.5">
            <RoomName name={g.room} disabled={disabled} onRename={(to) => {
              const next = renameRoom(rooms, g.room, to);
              if (!next) return false;
              onRoomsChange(next, { from: g.room, to: next[i]! });
              return true;
            }} />
            <span className="whitespace-nowrap px-1 text-[11px] text-ink-secondary">{g.rows.length} line{g.rows.length === 1 ? '' : 's'}</span>
            {!disabled && (
              <>
                <button type="button" aria-label={`Move ${g.room} up`} className={iconBtn} disabled={i === 0} onClick={() => onRoomsChange(moveRoom(rooms, i, -1))}><ArrowUp size={15} /></button>
                <button type="button" aria-label={`Move ${g.room} down`} className={iconBtn} disabled={i === groups.length - 1} onClick={() => onRoomsChange(moveRoom(rooms, i, 1))}><ArrowDown size={15} /></button>
                <button type="button" aria-label={`Delete ${g.room}`} className={iconBtn} disabled={g.rows.length > 0}
                  title={g.rows.length > 0 ? 'Move or remove its lines first' : 'Delete this room'}
                  onClick={() => onRoomsChange(rooms.filter((r) => r !== g.room))}><Trash2 size={15} /></button>
              </>
            )}
          </header>
          <div className="flex flex-col gap-3 p-2 sm:p-3">
            {g.rows.map((row) => <div key={row.key}>{roomPicker(row)}{row.node}</div>)}
            {g.rows.length === 0 && disabled && <p className="text-[12px] text-ink-muted">No lines in this room.</p>}
            {addLineBtn(g.room, `Add line to ${g.room}`)}
          </div>
        </section>
      ))}

      {(unplaced.length > 0 || rooms.length === 0) && (
        <section className="rounded-lg border border-dashed border-border">
          <header className="px-3 py-2 text-[12px] font-bold uppercase tracking-wide text-ink-secondary">
            {rooms.length === 0 ? 'Lines' : 'Not in a room'}
          </header>
          <div className="flex flex-col gap-3 p-2 sm:p-3">
            {unplaced.map((row) => <div key={row.key}>{rooms.length > 0 && roomPicker(row)}{row.node}</div>)}
            {addLineBtn('', 'Add line')}
          </div>
        </section>
      )}
    </div>
  );
}

/** The order's layout for "Generate rooms", from the Order information block (null when not chosen). */
export function roomLayoutOf(v: { layoutLabel: string; bedrooms: string; bathrooms: string }): RoomLayout | null {
  const b = Number(v.bedrooms);
  const t = Number(v.bathrooms);
  if (v.bedrooms === '' || v.bathrooms === '' || !Number.isInteger(b) || !Number.isInteger(t)) return null;
  return { label: v.layoutLabel || `${b} bed ${t} bath`, bedrooms: b, bathrooms: t };
}
