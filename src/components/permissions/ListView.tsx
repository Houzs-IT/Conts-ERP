import { useRef, useState, type CSSProperties, type DragEvent, type FormEvent } from 'react';
import { Button } from '../Button';
import { Field } from '../Field';
import { Select } from '../Select';
import { Modal } from '../Modal';
import { ConfirmDialog, type ConfirmSpec } from '../ConfirmDialog';
import Icon from '../Icon';
import { useToast } from '../Toast';
import { api, ApiFailure, errorMessage } from '../../lib/api';
import { plural } from '../../lib/format';
import type { Department, DepartmentKind, Position, UserSide } from '../../lib/types';
import { KIND_NOTE, KIND_OPTIONS, SIDE_OPTIONS, isFieldKind, sideLabel, useDepartments } from './shared';

/** What a delete is waiting on: people are still in the department or position, and need somewhere to go. */
interface MovePrompt { kind: 'department' | 'position'; id: string; name: string; departmentId: string; count: number }

const GROUPS: { side: UserSide; label: string }[] = [
  { side: 'conts', label: 'The Conts' }, { side: 'dream_crafter', label: 'Dream Crafter' }, { side: 'both', label: 'Both' },
];

/** The people count the server sends with a 409 HAS_PEOPLE, read without a cast. */
function peopleCount(e: unknown): number | null {
  if (!(e instanceof ApiFailure) || e.code !== 'HAS_PEOPLE' || typeof e.body !== 'object' || e.body === null) return null;
  const { error } = e.body as { error?: unknown };
  if (typeof error !== 'object' || error === null) return 0;
  const { count } = error as { count?: unknown };
  return typeof count === 'number' ? count : 0;
}

/** A drag in progress: what is held, and the scope it may be dropped in (the departments of one side, the positions of one department). */
interface Held { id: string; scope: string }
interface DropAt { id: string; after: boolean }

/**
 * Native drag and drop for a short list. The grip starts the drag and only a row of the same scope takes the drop, so a
 * position cannot land in another department and a department cannot leave its side. The drop is told which row it
 * landed on and whether above or below its middle.
 */
function useReorderDrag(onDrop: (id: string, targetId: string, after: boolean) => void) {
  // What is held lives in a ref so the drag handlers always see it; the state beside it only dims the row. The state is
  // set after the drag has started: re-rendering inside dragstart makes Chrome end the drag at once.
  const heldRef = useRef<Held | null>(null);
  const [held, setHeld] = useState<Held | null>(null);
  const [at, setAt] = useState<DropAt | null>(null);
  const end = () => { heldRef.current = null; setHeld(null); setAt(null); };
  const isAfter = (e: DragEvent<HTMLElement>): boolean => {
    const box = e.currentTarget.getBoundingClientRect();
    return e.clientY > box.top + box.height / 2;
  };
  return {
    handle: (id: string, scope: string) => ({
      draggable: true,
      onDragStart: (e: DragEvent<HTMLElement>) => {
        e.stopPropagation();
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', id);
        const image = e.currentTarget.closest('[data-reorder-row]');
        if (image) e.dataTransfer.setDragImage(image, 16, 16);
        heldRef.current = { id, scope };
        window.setTimeout(() => setHeld(heldRef.current), 0);
      },
      onDragEnd: end,
    }),
    row: (id: string, scope: string) => ({
      onDragOver: (e: DragEvent<HTMLElement>) => {
        const h = heldRef.current;
        if (!h || h.scope !== scope || h.id === id) return;
        e.preventDefault(); e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        const after = isAfter(e);
        if (at?.id !== id || at.after !== after) setAt({ id, after });
      },
      onDrop: (e: DragEvent<HTMLElement>) => {
        const h = heldRef.current;
        if (!h || h.scope !== scope || h.id === id) return;
        e.preventDefault(); e.stopPropagation();
        onDrop(h.id, id, isAfter(e));
        end();
      },
    }),
    /** Dimmed while held; a line above or below the row it would land next to. */
    style: (id: string): CSSProperties => ({
      opacity: held?.id === id ? 0.45 : undefined,
      boxShadow: at?.id === id ? `inset 0 ${at.after ? '-' : ''}2px 0 var(--color-info)` : undefined,
    }),
  };
}
type DragApi = ReturnType<typeof useReorderDrag>;

/**
 * View 3 of the Permissions tab: the managed list that the invite and edit forms pick from. Departments are grouped by
 * the side they work on; each one lists its positions. Only management can change it.
 */
export default function ListView({ onGoToDepartments }: { onGoToDepartments: () => void }) {
  const { data, error, reload } = useDepartments();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [move, setMove] = useState<MovePrompt | null>(null);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<DepartmentKind>('staff');
  const [newSide, setNewSide] = useState<UserSide>('conts');
  const [addError, setAddError] = useState<string | null>(null);
  // Both read `departments` and `reorderTo` below; they only run on a drop, after the list has rendered.
  const deptDrag = useReorderDrag((id, target, after) => void reorderTo(departments, id, target, after, i => `/departments/${i}`));
  const posDrag = useReorderDrag((id, target, after) => {
    const d = departments.find(x => x.positions.some(p => p.id === id));
    if (d) void reorderTo(d.positions, id, target, after, i => `/departments/positions/${i}`);
  });

  if (error && !data) return <div className="p-5 text-copy text-muted-ink">{error}</div>;
  // Only the first read blanks the page: after a change the list stays, so a drag or an arrow press does not flash it away.
  if (!data) return <div className="p-5 text-copy text-muted-ink">Loading departments…</div>;

  const { canEdit } = data;
  const departments = data.departments.filter(d => !isFieldKind(d.kind));
  const usedName = (name: string) => departments.some(d => d.name.trim().toLowerCase() === name.trim().toLowerCase());

  /** Runs one change, then reloads the list. Returns false when it failed (a toast has said why). */
  async function run(call: () => Promise<unknown>, failTitle: string): Promise<boolean> {
    setBusy(true);
    try { await call(); reload(); return true; }
    catch (e) { toast({ tone: 'critical', title: failTitle, body: errorMessage(e, 'Try again in a moment.') }); return false; }
    finally { setBusy(false); }
  }

  async function addDepartment(e: FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) { setAddError('Enter a name.'); return; }
    if (usedName(name)) { setAddError('A department with that name already exists.'); return; }
    setAddError(null);
    if (await run(() => api.post('/departments', { name, kind: newKind, side: newSide }), 'The department was not added.')) {
      setJustAdded(name); setNewName('');
    }
  }

  /** Saves a new order by renumbering: only the items whose place changed are sent. */
  async function saveOrder<T extends { id: string; sort: number }>(list: T[], order: string[], path: (id: string) => string) {
    const changed = order.map((oid, i) => ({ oid, sort: i + 1 })).filter(({ oid, sort }) => list.find(x => x.id === oid)?.sort !== sort);
    if (changed.length === 0) return;
    await run(() => Promise.all(changed.map(({ oid, sort }) => api.patch(path(oid), { sort }))), 'The order was not saved.');
  }
  /** The arrow keys: swap an item with its neighbour. */
  async function reorder<T extends { id: string; sort: number }>(list: T[], id: string, delta: -1 | 1, path: (id: string) => string) {
    const order = list.map(x => x.id);
    const at = order.indexOf(id);
    const to = at + delta;
    if (at < 0 || to < 0 || to >= order.length) return;
    [order[at], order[to]] = [order[to], order[at]];
    await saveOrder(list, order, path);
  }
  /** A drop: take the item out and put it next to the row it was dropped on. */
  async function reorderTo<T extends { id: string; sort: number }>(list: T[], id: string, targetId: string, after: boolean, path: (id: string) => string) {
    const order = list.map(x => x.id).filter(x => x !== id);
    const target = order.indexOf(targetId);
    if (target < 0) return;
    order.splice(after ? target + 1 : target, 0, id);
    await saveOrder(list, order, path);
  }
  const moveDepartment = (id: string, delta: -1 | 1) => reorder(departments, id, delta, i => `/departments/${i}`);
  const movePosition = (d: Department, id: string, delta: -1 | 1) => reorder(d.positions, id, delta, i => `/departments/positions/${i}`);

  /** Deletes; a 409 HAS_PEOPLE opens the move dialog instead of failing. */
  async function remove(prompt: Omit<MovePrompt, 'count'>, moveTo?: unknown): Promise<boolean> {
    const path = prompt.kind === 'department' ? `/departments/${prompt.id}` : `/departments/positions/${prompt.id}`;
    setBusy(true);
    try {
      const res = await api.del<{ ok: true; moved: number }>(path, moveTo === undefined ? undefined : { moveTo });
      toast({ tone: 'success', title: `${prompt.name} was deleted.`, body: res.moved > 0 ? `${plural(res.moved, 'person', 'people')} moved first.` : undefined });
      setMove(null); reload();
      return true;
    } catch (e) {
      const count = peopleCount(e);
      if (count !== null) setMove({ ...prompt, count });
      else toast({ tone: 'critical', title: `${prompt.name} was not deleted.`, body: errorMessage(e, 'Try again in a moment.') });
      return false;
    } finally { setBusy(false); }
  }
  /** Changing a kind changes what every person in the department can reach, so it asks first. */
  const askKindChange = (d: Department, kind: DepartmentKind) => {
    if (kind === d.kind) return;
    const people = plural(d.headCount, 'person', 'people');
    const effect = kind === 'management'
      ? `Management means Full access to everything. ${people} in ${d.name} will get it.`
      : `Staff get the access their department, position and own settings give. ${people} in ${d.name} will follow those rules instead of Full access.`;
    setConfirm({
      title: `Change ${d.name} to ${KIND_OPTIONS.find(o => o.value === kind)?.label ?? kind}?`,
      body: effect,
      confirmLabel: 'Change kind', busyLabel: 'Changing…', danger: kind === 'management',
      onConfirm: async () => { setConfirm(null); await run(() => api.patch(`/departments/${d.id}`, { kind }), 'The kind was not changed.'); },
    });
  };
  const askDelete = (kind: MovePrompt['kind'], id: string, name: string, departmentId: string) => setConfirm({
    title: `Delete ${name}?`,
    body: kind === 'department'
      ? 'Its positions and every permission rule set for them are deleted too. If people are in it, you choose where they move next.'
      : 'Its permission rules are deleted too. If people hold it, you choose where they move next.',
    confirmLabel: 'Delete', busyLabel: 'Deleting…', danger: true,
    onConfirm: async () => { setConfirm(null); await remove({ kind, id, name, departmentId }); },
  });

  return (
    <>
      <div className="py-[13px] px-5 [border-bottom:1px_solid_var(--color-line)] text-meta text-muted-ink leading-[1.5]">
        The departments and positions that the invite and edit forms pick from. A department’s side decides which side of the business its people work on.
        {canEdit ? '' : ' Only management can change this.'}
      </div>

      {canEdit && (
        <form onSubmit={addDepartment} className="py-3 px-5 [border-bottom:1px_solid_var(--color-line-soft)] flex items-start gap-3 flex-wrap">
          <div className="min-w-[200px]"><Field label="New department" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Procurement" error={addError ?? undefined} /></div>
          <Select label="Kind" showLabel size="md" className="min-w-[190px]" value={newKind} onChange={v => setNewKind(v as DepartmentKind)} options={KIND_OPTIONS} />
          <Select label="Side" showLabel size="md" className="min-w-[150px]" value={newSide} onChange={v => setNewSide(v as UserSide)} options={SIDE_OPTIONS} />
          <div className="pt-[22px]"><Button type="submit" variant="primary" loading={busy}>Add department</Button></div>
        </form>
      )}
      {justAdded && (
        <div className="py-3 px-5 [border-bottom:1px_solid_var(--color-line-soft)] flex items-center gap-3 flex-wrap bg-page">
          <span className="text-meta text-ink">{justAdded} starts with No access everywhere until you set its rules.</span>
          <Button size="sm" onClick={onGoToDepartments}>Set its access</Button>
          <Button size="sm" variant="tertiary" onClick={() => setJustAdded(null)}>Dismiss</Button>
        </div>
      )}

      {GROUPS.map(g => {
        const list = departments.filter(d => d.side === g.side);
        if (list.length === 0) return null;
        return (
          <section key={g.side} aria-label={g.label}>
            <div className="py-2 px-5 bg-muted [border-bottom:1px_solid_var(--color-line)] text-caption font-semibold tracking-[0.06em] uppercase text-muted-ink">{g.label}</div>
            {list.map(d => (
              <DepartmentCard key={d.id} d={d} canEdit={canEdit} busy={busy} deptDrag={deptDrag} posDrag={posDrag}
                canUp={departments.indexOf(d) > 0} canDown={departments.indexOf(d) < departments.length - 1}
                onMove={delta => moveDepartment(d.id, delta)}
                onPatch={(patch, fail) => run(() => api.patch(`/departments/${d.id}`, patch), fail)}
                onKindChange={kind => askKindChange(d, kind)}
                onDelete={() => askDelete('department', d.id, d.name, d.id)}
                onAddPosition={name => run(() => api.post(`/departments/${d.id}/positions`, { name }), 'The position was not added.')}
                onRenamePosition={(p, name) => run(() => api.patch(`/departments/positions/${p.id}`, { name }), 'The position was not renamed.')}
                onMovePosition={(p, delta) => movePosition(d, p.id, delta)}
                onDeletePosition={p => askDelete('position', p.id, p.name, d.id)} />
            ))}
          </section>
        );
      })}
      {departments.length === 0 && <div className="p-5 text-copy text-muted-ink">No departments yet.</div>}

      <ConfirmDialog spec={confirm} busy={busy} onClose={() => setConfirm(null)} />
      {move && <MoveDialog prompt={move} departments={departments} busy={busy} onClose={() => setMove(null)}
        onMove={moveTo => remove(move, moveTo)} />}
    </>
  );
}

function DepartmentCard({ d, canEdit, busy, deptDrag, posDrag, canUp, canDown, onMove, onPatch, onKindChange, onDelete, onAddPosition, onRenamePosition, onMovePosition, onDeletePosition }: {
  d: Department; canEdit: boolean; busy: boolean; deptDrag: DragApi; posDrag: DragApi; canUp: boolean; canDown: boolean;
  onMove: (delta: -1 | 1) => void;
  onPatch: (patch: { name?: string; side?: UserSide }, failTitle: string) => Promise<boolean>;
  onKindChange: (kind: DepartmentKind) => void;
  onDelete: () => void;
  onAddPosition: (name: string) => Promise<boolean>;
  onRenamePosition: (p: Position, name: string) => Promise<boolean>;
  onMovePosition: (p: Position, delta: -1 | 1) => void;
  onDeletePosition: (p: Position) => void;
}) {
  const [newPosition, setNewPosition] = useState('');
  return (
    <div className="py-3 px-5 [border-bottom:1px_solid_var(--color-line-soft)] flex flex-col gap-2.5"
      {...deptDrag.row(d.id, `dept:${d.side}`)} style={deptDrag.style(d.id)}>
      <div data-reorder-row className="flex items-center gap-3 flex-wrap">
        <ReorderHandle disabled={!canEdit || busy} canUp={canUp} canDown={canDown} label={d.name} onMove={onMove} drag={deptDrag.handle(d.id, `dept:${d.side}`)} />
        <EditableName value={d.name} canEdit={canEdit} onSave={name => onPatch({ name }, 'The department was not renamed.')} className="text-copy font-semibold" />
        <span className="text-caption text-muted-ink">{plural(d.headCount, 'person', 'people')}</span>
        <span className="flex-1" />
        {canEdit ? (
          <>
            <Select label={`Kind of ${d.name}`} value={d.kind} onChange={v => onKindChange(v as DepartmentKind)} options={KIND_OPTIONS} disabled={busy} />
            <Select label={`Side of ${d.name}`} value={d.side} onChange={v => void onPatch({ side: v as UserSide }, 'The side was not changed.')} options={SIDE_OPTIONS} disabled={busy} />
            {d.kind === 'management'
              ? <span className="text-caption text-muted-ink w-[72px]">Cannot be deleted</span>
              : <Button size="sm" variant="danger" icon={<Icon name="Trash2" size="sm" />} onClick={onDelete} disabled={busy} aria-label={`Delete ${d.name}`}>Delete</Button>}
          </>
        ) : <span className="text-meta text-muted-ink">{sideLabel(d.side)}</span>}
      </div>
      {KIND_NOTE[d.kind] && <span className="text-caption text-muted-ink">{KIND_NOTE[d.kind]}</span>}
      <ul className="m-0 p-0 pl-[34px] list-none flex flex-col gap-1.5">
        {d.positions.map((p, i) => (
          <li key={p.id} data-reorder-row className="flex items-center gap-3 flex-wrap" {...posDrag.row(p.id, `pos:${d.id}`)} style={posDrag.style(p.id)}>
            <ReorderHandle disabled={!canEdit || busy} canUp={i > 0} canDown={i < d.positions.length - 1} label={p.name} onMove={delta => onMovePosition(p, delta)}
              drag={posDrag.handle(p.id, `pos:${d.id}`)} />
            <EditableName value={p.name} canEdit={canEdit} onSave={name => onRenamePosition(p, name)} className="text-copy" />
            <span className="text-caption text-muted-ink">{plural(p.headCount, 'person', 'people')}</span>
            {canEdit && <Button size="sm" variant="tertiary" onClick={() => onDeletePosition(p)} disabled={busy} aria-label={`Delete ${p.name}`}>Delete</Button>}
          </li>
        ))}
        {d.positions.length === 0 && <li className="text-caption text-muted-ink">No positions yet.</li>}
        {canEdit && (
          <li>
            <form className="flex items-center gap-2" onSubmit={async e => { e.preventDefault(); if (newPosition.trim() && await onAddPosition(newPosition.trim())) setNewPosition(''); }}>
              <input aria-label={`New position in ${d.name}`} value={newPosition} onChange={e => setNewPosition(e.target.value)} placeholder="Add a position"
                className="h-8 w-[200px] px-2.5 rounded-control border border-solid border-line bg-card [font-family:inherit] text-copy outline-none" />
              <Button size="sm" type="submit" disabled={busy || !newPosition.trim()} disabledReason="Type a position name first.">Add</Button>
            </form>
          </li>
        )}
      </ul>
    </div>
  );
}

type DragHandleProps = ReturnType<DragApi['handle']>;

/**
 * The grip a row is dragged by. Arrow keys on the grip move the row too, and a touch screen, which cannot drag, shows
 * the two arrow buttons instead.
 */
function ReorderHandle({ disabled, canUp, canDown, label, onMove, drag }: {
  disabled: boolean; canUp: boolean; canDown: boolean; label: string; onMove: (delta: -1 | 1) => void; drag: DragHandleProps;
}) {
  const ARROW = 'grid place-items-center w-6 h-5 p-0 border-none bg-transparent text-muted-ink cursor-pointer disabled:opacity-30 disabled:cursor-default';
  return (
    <span className="flex items-center flex-none">
      {/* A span, not a button: Firefox does not start a drag from a button. */}
      <span role="button" aria-disabled={disabled} tabIndex={disabled ? -1 : 0} title={disabled ? undefined : 'Drag to reorder'}
        aria-label={`Reorder ${label}. Drag it, or press the up or down arrow key.`}
        {...(disabled ? {} : drag)}
        onKeyDown={e => {
          if (disabled) return;
          if (e.key === 'ArrowUp' && canUp) { e.preventDefault(); onMove(-1); }
          else if (e.key === 'ArrowDown' && canDown) { e.preventDefault(); onMove(1); }
        }}
        className={`grid place-items-center w-6 h-6 text-muted-ink rounded-control ${disabled ? 'opacity-30' : 'cursor-grab active:cursor-grabbing hover:text-ink'}`}>
        <Icon name="GripVertical" size="sm" />
      </span>
      <span className="hidden [@media(pointer:coarse)]:flex flex-col">
        <button type="button" className={ARROW} disabled={disabled || !canUp} onClick={() => onMove(-1)} aria-label={`Move ${label} up`}><span className="rotate-180 grid"><Icon name="ChevronDown" size="sm" /></span></button>
        <button type="button" className={ARROW} disabled={disabled || !canDown} onClick={() => onMove(1)} aria-label={`Move ${label} down`}><Icon name="ChevronDown" size="sm" /></button>
      </span>
    </span>
  );
}

/** A name that turns into a text box when its pencil is pressed. Enter saves, Escape cancels. */
function EditableName({ value, canEdit, onSave, className }: { value: string; canEdit: boolean; onSave: (name: string) => Promise<boolean>; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  if (!editing) {
    return (
      <span className="flex items-center gap-1.5 min-w-0">
        <span className={className}>{value}</span>
        {canEdit && <button type="button" onClick={() => { setText(value); setEditing(true); }} aria-label={`Rename ${value}`}
          className="grid p-0.5 border-none bg-transparent text-muted-ink cursor-pointer"><Icon name="Pencil" size="sm" /></button>}
      </span>
    );
  }
  const commit = async () => {
    const name = text.trim();
    if (name && name !== value && !(await onSave(name))) return;
    setEditing(false);
  };
  return (
    <input autoFocus aria-label={`Name, was ${value}`} value={text} onChange={e => setText(e.target.value)} onBlur={() => void commit()}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void commit(); } else if (e.key === 'Escape') { e.preventDefault(); setEditing(false); } }}
      className="h-8 w-[200px] px-2.5 rounded-control border border-solid border-line bg-card [font-family:inherit] text-copy outline-none" />
  );
}

/** Asks where to move the people before a department or position with people in it is deleted. */
function MoveDialog({ prompt, departments, busy, onClose, onMove }: {
  prompt: MovePrompt; departments: Department[]; busy: boolean; onClose: () => void; onMove: (moveTo: unknown) => Promise<boolean>;
}) {
  const isDept = prompt.kind === 'department';
  // Management is left out: it gives Full access, which is chosen for each person on the user form, never by a delete.
  const targets = departments.filter(d => d.id !== prompt.id && d.kind !== 'management');
  const [deptId, setDeptId] = useState(isDept ? '' : prompt.departmentId);
  const positions = departments.find(d => d.id === deptId)?.positions.filter(p => isDept || p.id !== prompt.id) ?? [];
  const [positionId, setPositionId] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void onMove(isDept ? { departmentId: deptId, positionId: positionId || null } : { positionId: positionId || null });
  };
  return (
    <Modal title={`Move the people in ${prompt.name} first`}
      sub={`${plural(prompt.count, 'person', 'people')} ${prompt.count === 1 ? 'is' : 'are'} still in ${prompt.name}. Choose where to move them, then it is deleted.`}
      onClose={onClose}
      footer={<>
        <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="danger" size="sm" type="submit" form="move-form" loading={busy} disabled={isDept && !deptId}>Move and delete</Button>
      </>}>
      <form id="move-form" onSubmit={submit} className="flex flex-col gap-4">
        {isDept && <Select label="Move them to department" showLabel size="md" value={deptId}
          onChange={v => { setDeptId(v); setPositionId(''); }} placeholder="Choose a department" options={targets.map(d => ({ value: d.id, label: d.name }))} />}
        <Select label={isDept ? 'Position' : 'Move them to position'} showLabel size="md" value={positionId} onChange={setPositionId}
          placeholder="No position" options={positions.map(p => ({ value: p.id, label: p.name }))} />
        <span className="text-meta text-muted-ink">
          Their access follows the new department and position straight away.{isDept ? ' Management is not offered: that gives Full access, so set it for each person on the user form.' : ''}
        </span>
      </form>
    </Modal>
  );
}
