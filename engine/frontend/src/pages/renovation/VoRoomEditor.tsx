/* The VO room editor (owner, 23 Nov 2026): the contract by room, each line changed in place (qty, price, swap the SKU,
   remove) and new lines added inside a room. The VO keeps these edits; the server rebuilds its add and omit lines from
   them on save and again at approval (renovation-vo.ts). Model: voRoomModel.ts. */

import { useMemo, useState, type ReactElement } from 'react';
import { Minus, Plus, Trash2, Undo2 } from 'lucide-react';
import { qtyLabel } from '../../vendor/shared/renovation-money';
import type { DocSection, VoEdits } from '../../lib/renovation/api';
import { cn } from '../../lib/utils';
import { ProductPicker } from './DocEditor';
import { MoneyInput, rm } from './shared';
import {
  addLine, dropAdd, removeLine, roomsOf, setAddPrice, setAddQty, setLinePrice, setLineQty, swapLine, totalsOf, undoLine,
  type Room, type RoomRow,
} from './voRoomModel';

const ROW_TINT: Record<RoomRow['kind'], string> = { same: '', changed: 'bg-warning-bg/60', added: 'bg-synced-bg/60', removed: 'bg-err-bg/60', gone: 'bg-surface-2' };
const BADGE: Record<RoomRow['kind'], { text: string; cls: string } | null> = {
  same: null,
  gone: { text: 'Undo to save', cls: 'bg-err-bg text-err' },
  changed: { text: 'Changed', cls: 'bg-warning-bg text-warning-text' },
  added: { text: 'New', cls: 'bg-synced-bg text-synced' },
  removed: { text: 'Removed', cls: 'bg-err-bg text-err' },
};
const GRID = 'xl:grid xl:grid-cols-[130px_minmax(0,1fr)_150px_110px_120px_100px] xl:items-center xl:gap-3';
const STEP_BUTTON = 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-ink hover:bg-surface-2 disabled:opacity-50 xl:h-8 xl:w-8';
export const ACTION_BUTTON = 'inline-flex h-11 items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-medium text-ink hover:bg-surface-2 disabled:opacity-50 xl:h-8 xl:px-2 xl:text-[12px]';
const WRAP = 'min-w-0 [overflow-wrap:anywhere]';

/* Not inputCls: cn only joins classes, so its h-9 would beat a 44px phone height. */
const FIELD = 'w-full min-w-0 rounded-md border border-border bg-surface px-2.5 text-ink focus:border-primary disabled:bg-surface-2 disabled:text-ink-muted h-11 text-[16px] xl:h-8 xl:text-[12.5px]';

const signed = (sen: number): string => (sen > 0 ? `+${rm(sen)}` : rm(sen));

export function VoRoomEditor({ sections, edits, onChange, disabled, contractError, onRetry }: {
  /** null while the contract loads: no row is drawn until it is here, or every saved edit would read as gone. */
  sections: DocSection[] | null; edits: VoEdits; onChange: (next: VoEdits) => void; disabled: boolean;
  contractError: string | null; onRetry: () => void;
}): ReactElement {
  const [isChangesOnly, setIsChangesOnly] = useState(false);
  const [newRoom, setNewRoom] = useState('');
  const rooms = useMemo(() => (sections ? roomsOf(sections, edits) : []), [sections, edits]);
  const totals = totalsOf(rooms);
  const summary = [totals.changed && `${totals.changed} changed`, totals.added && `${totals.added} added`, totals.removed && `${totals.removed} removed`].filter(Boolean).join(' · ') || 'No changes yet';
  const shown = isChangesOnly ? rooms.map((room) => ({ ...room, rows: room.rows.filter((row) => row.kind !== 'same') })).filter((room) => room.rows.length > 0) : rooms;

  if (!sections) {
    return contractError ? (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-err/40 bg-err-bg px-4 py-3 text-[13px] text-err">
        <span className="min-w-0 flex-1">The contract lines could not be loaded: {contractError}</span>
        <button type="button" className={ACTION_BUTTON} onClick={onRetry}>Retry</button>
      </div>
    ) : (
      <div className="space-y-3" aria-busy="true" aria-label="Loading contract lines">
        {[0, 1].map((i) => <div key={i} className="h-40 animate-pulse rounded-xl border border-border bg-surface-2" />)}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex-1 text-[13.5px] font-semibold text-ink">Contract by room</h2>
        <span className="text-[12.5px] text-ink-secondary">{summary}</span>
        <button type="button" aria-pressed={isChangesOnly} onClick={() => setIsChangesOnly((on) => !on)}
          className={cn(ACTION_BUTTON, isChangesOnly && 'border-primary bg-primary-soft text-primary-ink')}>
          {isChangesOnly ? 'Showing changes only' : 'Show changes only'}
        </button>
      </div>

      {shown.length === 0 && (
        <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-[13px] text-ink-muted">
          {isChangesOnly ? 'Nothing changed yet.' : 'No contract line can be changed. Add a line in a new room below.'}
        </div>
      )}

      {shown.map((room) => <RoomCard key={room.name} room={room} edits={edits} onChange={onChange} disabled={disabled} />)}

      {!disabled && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2">
          <label className="flex min-w-0 flex-1 items-center gap-2 text-[12.5px] text-ink-secondary">
            New room
            <input className={cn(FIELD, 'flex-1')} value={newRoom} onChange={(e) => setNewRoom(e.target.value)} placeholder="Kitchen" />
          </label>
          <div className="w-full sm:w-56" aria-label="Pick the first product for the new room">
            <ProductPicker value={null} tall disabled={!newRoom.trim()} onPick={(p) => { onChange(addLine(edits, newRoom, p)); setNewRoom(''); }} />
          </div>
        </div>
      )}
    </div>
  );
}

function RoomCard({ room, edits, onChange, disabled }: { room: Room; edits: VoEdits; onChange: (e: VoEdits) => void; disabled: boolean }): ReactElement {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface" aria-label={room.name}>
      <div className="flex items-center gap-2 border-b border-border bg-surface-2 px-3 py-2">
        <h3 className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ink">{room.name}</h3>
        {room.deltaSen !== 0 && <span className={cn('text-[12.5px] font-semibold tabular-nums', room.deltaSen < 0 ? 'text-err' : 'text-synced')}>{signed(room.deltaSen)}</span>}
      </div>
      <div className={cn('hidden border-b border-border-subtle px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-ink-muted', GRID)}>
        <span>SKU</span><span>Item</span><span>Qty</span><span className="text-right">Unit price</span><span className="text-right">Amount</span><span />
      </div>
      <ul>
        {room.rows.map((r) => <RowView key={r.key} r={r} edits={edits} onChange={onChange} disabled={disabled} />)}
      </ul>
      {!disabled && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle px-3 py-2">
          <span className={cn('text-[12.5px] text-ink-secondary', WRAP)}>Add line in {room.name}</span>
          <div className="w-full sm:w-56"><ProductPicker value={null} tall onPick={(p) => onChange(addLine(edits, room.name, p))} /></div>
        </div>
      )}
    </section>
  );
}

function RowView({ r, edits, onChange, disabled }: { r: RoomRow; edits: VoEdits; onChange: (e: VoEdits) => void; disabled: boolean }): ReactElement {
  const badge = BADGE[r.kind];
  if (r.kind === 'gone') {
    return (
      <li className={cn('flex flex-wrap items-center gap-2 border-b border-border-subtle px-3 py-2.5 last:border-b-0', ROW_TINT.gone)}>
        <span className={cn('flex-1 text-[13px] text-ink-secondary', WRAP)}>{r.name}{r.sku ? ` (${r.sku})` : ''}: another VO changed this line, so this edit cannot be saved.</span>
        {badge && <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold', badge.cls)}>{badge.text}</span>}
        {!disabled && r.soItemId && <button type="button" className={ACTION_BUTTON} aria-label={`Undo the edit to ${r.name}`} onClick={() => onChange(undoLine(edits, r.soItemId ?? ''))}><Undo2 size={15} />Undo</button>}
      </li>
    );
  }
  const isRemoved = r.kind === 'removed';
  const { line, addIndex, soItemId } = r;
  const setQty = (qty: number): void => {
    if (line) onChange(setLineQty(edits, line, qty));
    else if (addIndex !== null) onChange(setAddQty(edits, addIndex, qty));
  };
  const setPrice = (sen: number): void => {
    if (line) onChange(setLinePrice(edits, line, sen));
    else if (addIndex !== null) onChange(setAddPrice(edits, addIndex, sen));
  };
  /* Phone: name, SKU, then qty with the amount, then price with the action. Wide screens: the wrappers dissolve
     (xl:contents) and xl:order puts each cell in its grid column. */
  return (
    <li className={cn('flex flex-col gap-2 border-b border-border-subtle px-3 py-2.5 last:border-b-0', GRID, ROW_TINT[r.kind])}>
      <div className="flex min-w-0 items-start gap-2 xl:order-2">
        <div className={cn('flex-1', WRAP)}>
          {r.oldName && <span className="block text-[12px] text-ink-muted line-through">{r.oldName}</span>}
          <span className={cn('block text-[14px] font-medium text-ink xl:text-[13px]', isRemoved && 'text-err line-through')}>{r.name}</span>
        </div>
        {badge && <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold', badge.cls)}>{badge.text}</span>}
      </div>

      <div className="min-w-0 xl:order-1">
        {line && !isRemoved && !disabled ? (
          <ProductPicker value={r.sku} tall onPick={(p) => onChange(swapLine(edits, line, p))} />
        ) : (
          <span className={cn('block truncate font-mono text-[11.5px]', isRemoved && 'text-err line-through')}>{r.sku ?? '-'}</span>
        )}
        {r.oldSku && <span className="mt-0.5 block truncate font-mono text-[11px] text-ink-muted line-through">{r.oldSku}</span>}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 xl:contents">
        <div className="flex items-center gap-2 xl:order-3">
          {isRemoved ? (
            <span className="text-[12.5px] font-semibold text-err">Removed ({r.qty})</span>
          ) : r.measured ? (
            <span className="text-[12.5px] tabular-nums">{line ? qtyLabel({ qty: line.qty, measureMilli: line.measureMilli ?? null, measureUom: line.measureUom, uom: line.uom }) : r.qty}</span>
          ) : (
            <>
              {/* An added line stops at 1: taking it out is the Take out button, never a mis-tap on minus. */}
              <button type="button" className={STEP_BUTTON} disabled={disabled || (r.kind === 'added' && r.qty <= 1)} aria-label={`One less ${r.name}`} onClick={() => setQty(r.qty - 1)}><Minus size={15} /></button>
              <span className="min-w-[44px] text-center tabular-nums">
                <span className="block text-[15px] font-semibold xl:text-[13px]">{r.qty}</span>
                {r.oldQty !== null && <span className="block text-[11px] text-ink-muted">was {r.oldQty}</span>}
              </span>
              <button type="button" className={STEP_BUTTON} disabled={disabled} aria-label={`One more ${r.name}`} onClick={() => setQty(r.qty + 1)}><Plus size={15} /></button>
            </>
          )}
        </div>
        <div className="min-w-0 text-right tabular-nums xl:order-5">
          <span className={cn('block text-[14px] font-semibold xl:text-[13px] xl:font-normal', isRemoved && 'text-ink-muted line-through')}>{rm(r.amountSen)}</span>
          {r.deltaSen !== 0 && <span className={cn('block text-[12px] font-semibold', r.deltaSen < 0 ? 'text-err' : 'text-synced')}>{signed(r.deltaSen)}</span>}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 xl:contents">
        <label className="flex items-center gap-2 xl:order-4 xl:block">
          <span className="text-[12px] text-ink-secondary xl:sr-only">Unit price</span>
          <span className="block w-28 xl:w-full">
            <MoneyInput value={r.unitPriceSen} onChange={(sen) => setPrice(sen ?? 0)} disabled={disabled || isRemoved || r.measured}
              ariaLabel={`Unit price of ${r.name}`} className={FIELD} />
            {r.oldPriceSen !== null && <span className="mt-0.5 block text-right text-[11px] text-ink-muted line-through">{rm(r.oldPriceSen)}</span>}
          </span>
        </label>
        <div className="flex justify-end gap-1.5 xl:order-6">
          {!disabled && r.kind === 'same' && line && (
            <button type="button" className={cn(ACTION_BUTTON, 'text-err')} aria-label={`Remove ${r.name}`} title="Remove" onClick={() => onChange(removeLine(edits, line))}><Trash2 size={15} /><span className="xl:sr-only">Remove</span></button>
          )}
          {!disabled && (r.kind === 'changed' || isRemoved) && soItemId && (
            <button type="button" className={ACTION_BUTTON} aria-label={`Undo the changes to ${r.name}`} onClick={() => onChange(undoLine(edits, soItemId))}><Undo2 size={15} />Undo</button>
          )}
          {!disabled && r.kind === 'added' && addIndex !== null && (
            <button type="button" className={cn(ACTION_BUTTON, 'text-err')} aria-label={`Take out ${r.name}`} title="Take out" onClick={() => onChange(dropAdd(edits, addIndex))}><Trash2 size={15} /><span className="xl:sr-only">Take out</span></button>
          )}
        </div>
      </div>
    </li>
  );
}
