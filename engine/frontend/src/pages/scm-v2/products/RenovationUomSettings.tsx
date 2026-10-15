/* Unit settings for the renovation SKU Master: add, rename, reorder, hide and
   delete units of measure. The short code is what prints and what an import
   sheet names, and "measured" makes a quotation line ask for a length or area,
   so both are fixed once added. Built-in units can only be hidden; an added one
   can be deleted while nothing uses it. Rules are checked server-side
   (backend scm/routes/renovation-catalog-settings.ts). */
import { useState } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, Trash2, X } from 'lucide-react';
import { Button } from '../../../components/Button';
import type { UomDef } from '../../../vendor/shared/renovation-catalog';
import { useAddUom, useDeleteUom, useRenovationCatalog, useUpdateUom } from '../../../vendor/scm/lib/renovation-catalog-queries';
import { useConfirm } from '../../../vendor/scm/components/ConfirmDialog';
import styles from '../Products.module.css';

const errText = (e: unknown) => (e instanceof Error ? e.message : 'Could not save.');
const FALLBACK_UNITS = ['UNIT', 'FT'];

export function RenovationUomSettings({ onClose }: { onClose: () => void }) {
  const catalog = useRenovationCatalog();
  const add = useAddUom();
  const update = useUpdateUom();
  const remove = useDeleteUom();
  const confirm = useConfirm();
  const [newLabel, setNewLabel] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newMeasure, setNewMeasure] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editable = catalog.canEdit;
  const units = catalog.uoms;
  const busy = add.isPending || update.isPending || remove.isPending;

  const patch = (code: string, p: { label?: string; sortOrder?: number; active?: boolean }) =>
    update.mutateAsync({ code, ...p }).catch((e) => { setError(errText(e)); throw e; });

  const rename = (u: UomDef, label: string) => {
    const next = label.trim();
    if (!next || next === u.label) return;
    setError(null);
    void patch(u.code, { label: next }).catch(() => {});
  };

  const move = async (i: number, dir: -1 | 1) => {
    const a = units[i];
    const b = units[i + dir];
    if (!a || !b) return;
    setError(null);
    const aSort = a.sort ?? 0;
    const bSort = b.sort ?? 0;
    try {
      await patch(a.code, { sortOrder: Math.max(0, aSort === bSort ? bSort + dir : bSort) });
      await patch(b.code, { sortOrder: aSort });
    } catch { /* shown by patch */ }
  };

  const del = async (u: UomDef) => {
    setError(null);
    const ok = await confirm({ title: `Delete ${u.label} (${u.printLabel})?`, body: 'It disappears from every unit list.', confirmLabel: 'Delete', danger: true });
    if (ok) remove.mutate(u.code, { onError: (e) => setError(errText(e)) });
  };

  const addOne = () => {
    const label = newLabel.trim();
    const code = newCode.trim().toUpperCase();
    if (!label || !code) return;
    setError(null);
    add.mutate({ code, label, measure: newMeasure }, {
      onSuccess: () => { setNewLabel(''); setNewCode(''); setNewMeasure(false); },
      onError: (e) => setError(errText(e)),
    });
  };

  return (
    <div className={styles.drawerBackdrop} onClick={onClose}>
      <aside className={styles.drawer} role="dialog" aria-label="Units" onClick={(e) => e.stopPropagation()}>
        <header className={styles.drawerHeader}>
          <h2 className={styles.drawerTitle}>Units</h2>
          <button type="button" aria-label="Close" className={styles.iconBtn} onClick={onClose}><X size={16} strokeWidth={1.75} /></button>
        </header>
        <div className={`${styles.drawerBody} space-y-4`}>
          <p className="text-[12px] text-ink-secondary">
            {editable
              ? 'Hidden units stay on the SKUs and quotation lines that already have them, but cannot be picked for new ones. A unit you added can be deleted while nothing uses it.'
              : 'You can view this list. Changing it needs permission to edit products.'}
          </p>
          {catalog.query.error && (
            <p role="alert" className="text-[12px] text-red-700">
              Could not load the saved list, showing the built-in one: {errText(catalog.query.error)}
            </p>
          )}

          <ul className="divide-y divide-border rounded-md border border-border" aria-label="Units">
            {units.map((u, i) => {
              const hidden = u.active === false;
              return (
                <li key={u.code} className={`flex items-center gap-2 px-3 py-2 ${hidden ? 'bg-surface-2' : ''}`}>
                  <span className="w-[72px] shrink-0 font-money text-[12px] font-semibold" title="What prints on documents">{u.printLabel}</span>
                  {editable ? (
                    <input
                      aria-label={`Name of ${u.printLabel}`}
                      defaultValue={u.label}
                      key={u.label}
                      maxLength={60}
                      className={`${styles.fieldInput} min-w-0 flex-1 ${hidden ? 'text-ink-muted' : ''}`}
                      onBlur={(e) => rename(u, e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    />
                  ) : (
                    <span className={`min-w-0 flex-1 text-[13px] ${hidden ? 'text-ink-muted' : ''}`}>{u.label}</span>
                  )}
                  {u.measure && <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-semibold text-primary">Measured</span>}
                  {hidden && <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold text-ink-secondary">Hidden</span>}
                  {editable && (
                    <>
                      <button type="button" className={styles.iconBtn} aria-label={`Move ${u.label} up`} disabled={busy || i === 0} onClick={() => void move(i, -1)}>
                        <ArrowUp size={14} strokeWidth={1.75} />
                      </button>
                      <button type="button" className={styles.iconBtn} aria-label={`Move ${u.label} down`} disabled={busy || i === units.length - 1} onClick={() => void move(i, 1)}>
                        <ArrowDown size={14} strokeWidth={1.75} />
                      </button>
                      <button
                        type="button"
                        className={styles.iconBtn}
                        aria-label={hidden ? `Show ${u.label}` : `Hide ${u.label}`}
                        title={FALLBACK_UNITS.includes(u.code) ? 'The system falls back to this unit, so it stays shown' : hidden ? 'Show' : 'Hide'}
                        disabled={busy || (!hidden && FALLBACK_UNITS.includes(u.code))}
                        onClick={() => { setError(null); void patch(u.code, { active: hidden }).catch(() => {}); }}
                      >
                        {hidden ? <Eye size={14} strokeWidth={1.75} /> : <EyeOff size={14} strokeWidth={1.75} />}
                      </button>
                      <button
                        type="button"
                        className={styles.iconBtn}
                        aria-label={`Delete ${u.label}`}
                        title={u.builtin ? 'Built-in units can be hidden, not deleted' : 'Delete'}
                        disabled={busy || u.builtin !== false}
                        onClick={() => void del(u)}
                      >
                        <Trash2 size={14} strokeWidth={1.75} />
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>

          {editable && (
            <form className="space-y-2 rounded-md border border-border p-3" onSubmit={(e) => { e.preventDefault(); addOne(); }}>
              <div className="text-[12px] font-semibold text-ink-secondary">Add a unit</div>
              <div className="flex flex-wrap gap-2">
                <input
                  aria-label="New unit name"
                  placeholder="Name, e.g. Metre (run)"
                  value={newLabel}
                  maxLength={60}
                  onChange={(e) => setNewLabel(e.target.value)}
                  className={`${styles.fieldInput} min-w-0 flex-1 basis-40`}
                />
                <input
                  aria-label="New unit short code"
                  placeholder="Prints as, e.g. M"
                  value={newCode}
                  maxLength={8}
                  onChange={(e) => setNewCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                  className={`${styles.fieldInput} w-32 font-money`}
                />
              </div>
              <label className="flex items-center gap-2 text-[12px] text-ink-secondary">
                <input type="checkbox" checked={newMeasure} onChange={(e) => setNewMeasure(e.target.checked)} />
                Measured: a quotation line asks for a length or area in this unit (like FT and SQFT)
              </label>
              <p className="text-[11px] text-ink-muted">The short code and the measured setting cannot be changed once the unit is added.</p>
              <Button type="submit" variant="primary" disabled={busy || !newLabel.trim() || !newCode.trim()}>
                <Plus size={14} strokeWidth={1.75} /> Add unit
              </Button>
            </form>
          )}
          {error && <p role="alert" className="text-[12px] text-red-700">{error}</p>}
        </div>
      </aside>
    </div>
  );
}
