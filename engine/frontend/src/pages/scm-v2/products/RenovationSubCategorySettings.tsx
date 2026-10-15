/* Sub-category settings for the renovation SKU Master: add, rename, reorder and
   hide the sub-categories of a group. Groups are fixed (each sets a project stage
   and photo rule), so are the Works trades (they follow the site stage order).
   Hide, not delete: SKUs and documents keep the code, and a hidden one still
   shows on the SKU that has it. Rules are checked server-side
   (backend scm/routes/renovation-catalog-settings.ts). */
import { useState } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, X } from 'lucide-react';
import { Button } from '../../../components/Button';
import { FIXED_SUB_GROUPS, RENOVATION_GROUPS, subCategoriesOf, type CatalogGroup, type SubCategoryDef } from '../../../vendor/shared/renovation-catalog';
import { useAddSubCategory, useRenovationCatalog, useUpdateSubCategory } from '../../../vendor/scm/lib/renovation-catalog-queries';
import styles from '../Products.module.css';

const errText = (e: unknown) => (e instanceof Error ? e.message : 'Could not save.');

export function RenovationSubCategorySettings({ initialGroup, onClose }: { initialGroup: CatalogGroup | null; onClose: () => void }) {
  const catalog = useRenovationCatalog();
  const add = useAddSubCategory();
  const update = useUpdateSubCategory();
  const [group, setGroup] = useState<CatalogGroup>(initialGroup && !FIXED_SUB_GROUPS.includes(initialGroup) ? initialGroup : 'BUILTIN');
  const [newLabel, setNewLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  const fixed = FIXED_SUB_GROUPS.includes(group);
  const editable = catalog.canEdit && !fixed;
  const subs = subCategoriesOf(group, catalog.all);
  const busy = add.isPending || update.isPending;

  const patch = (code: string, p: { label?: string; sortOrder?: number; active?: boolean }) =>
    update.mutateAsync({ code, ...p }).catch((e) => { setError(errText(e)); throw e; });

  const rename = (s: SubCategoryDef, label: string) => {
    const next = label.trim();
    if (!next || next === s.label) return;
    setError(null);
    void patch(s.code, { label: next }).catch(() => {});
  };

  const move = async (i: number, dir: -1 | 1) => {
    const a = subs[i];
    const b = subs[i + dir];
    if (!a || !b) return;
    setError(null);
    const aSort = a.sort === b.sort ? b.sort + dir : b.sort;
    try {
      await patch(a.code, { sortOrder: Math.max(0, aSort) });
      await patch(b.code, { sortOrder: a.sort });
    } catch { /* shown by patch */ }
  };

  const addOne = () => {
    const label = newLabel.trim();
    if (!label) return;
    setError(null);
    add.mutate({ group, label }, { onSuccess: () => setNewLabel(''), onError: (e) => setError(errText(e)) });
  };

  return (
    <div className={styles.drawerBackdrop} onClick={onClose}>
      <aside className={styles.drawer} role="dialog" aria-label="Sub-categories" onClick={(e) => e.stopPropagation()}>
        <header className={styles.drawerHeader}>
          <h2 className={styles.drawerTitle}>Sub-categories</h2>
          <button type="button" aria-label="Close" className={styles.iconBtn} onClick={onClose}><X size={16} strokeWidth={1.75} /></button>
        </header>
        <div className={`${styles.drawerBody} space-y-4`}>
          <label className={styles.field} htmlFor="subcat-settings-group">
            <span className={styles.fieldLabel}>Group</span>
            <select
              id="subcat-settings-group"
              className={styles.fieldSelect}
              value={group}
              onChange={(e) => { setGroup(e.target.value as CatalogGroup); setError(null); }}
            >
              {RENOVATION_GROUPS.map((g) => <option key={g.code} value={g.code}>{g.label}</option>)}
            </select>
          </label>

          <p className="text-[12px] text-ink-secondary">
            {fixed
              ? 'Works trades follow the site stage order, so they cannot be changed here.'
              : catalog.canEdit
                ? 'Hidden sub-categories stay on the SKUs that already have them, but cannot be picked for new ones. The groups themselves are fixed.'
                : 'You can view this list. Changing it needs permission to edit products.'}
          </p>
          {catalog.query.error && (
            <p role="alert" className="text-[12px] text-red-700">
              Could not load the saved list, showing the built-in one: {errText(catalog.query.error)}
            </p>
          )}

          <ul className="divide-y divide-border rounded-md border border-border" aria-label={`${RENOVATION_GROUPS.find((g) => g.code === group)?.label} sub-categories`}>
            {subs.map((s, i) => {
              const hidden = s.active === false;
              return (
                <li key={s.code} className={`flex items-center gap-2 px-3 py-2 ${hidden ? 'bg-surface-2' : ''}`}>
                  {editable ? (
                    <input
                      aria-label={`Name of ${s.label}`}
                      defaultValue={s.label}
                      key={s.label}
                      maxLength={60}
                      className={`${styles.fieldInput} min-w-0 flex-1 ${hidden ? 'text-ink-muted' : ''}`}
                      onBlur={(e) => rename(s, e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    />
                  ) : (
                    <span className={`min-w-0 flex-1 text-[13px] ${hidden ? 'text-ink-muted' : ''}`}>{s.label}</span>
                  )}
                  {hidden && <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold text-ink-secondary">Hidden</span>}
                  {editable && (
                    <>
                      <button type="button" className={styles.iconBtn} aria-label={`Move ${s.label} up`} disabled={busy || i === 0} onClick={() => void move(i, -1)}>
                        <ArrowUp size={14} strokeWidth={1.75} />
                      </button>
                      <button type="button" className={styles.iconBtn} aria-label={`Move ${s.label} down`} disabled={busy || i === subs.length - 1} onClick={() => void move(i, 1)}>
                        <ArrowDown size={14} strokeWidth={1.75} />
                      </button>
                      <button
                        type="button"
                        className={styles.iconBtn}
                        aria-label={hidden ? `Show ${s.label}` : `Hide ${s.label}`}
                        title={hidden ? 'Show' : 'Hide'}
                        disabled={busy}
                        onClick={() => { setError(null); void patch(s.code, { active: hidden }).catch(() => {}); }}
                      >
                        {hidden ? <Eye size={14} strokeWidth={1.75} /> : <EyeOff size={14} strokeWidth={1.75} />}
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>

          {editable && (
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); addOne(); }}>
              <input
                aria-label="New sub-category"
                placeholder="New sub-category, e.g. Curtain install"
                value={newLabel}
                maxLength={60}
                onChange={(e) => setNewLabel(e.target.value)}
                className={`${styles.fieldInput} min-w-0 flex-1`}
              />
              <Button type="submit" variant="primary" disabled={busy || !newLabel.trim()}>
                <Plus size={14} strokeWidth={1.75} /> Add
              </Button>
            </form>
          )}
          {error && <p role="alert" className="text-[12px] text-red-700">{error}</p>}
        </div>
      </aside>
    </div>
  );
}
