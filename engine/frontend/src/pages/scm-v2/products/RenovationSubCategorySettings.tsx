/* Catalog settings for the renovation SKU Master. Groups tab: rename, reorder and
   hide the groups (a new one needs its accounts, so it is added under Accounting >
   Item Groups). Sub-categories tab: add, rename, reorder and hide the
   sub-categories of a group. The site-trade services filed under Service (aircon
   install, cleaning, project management) stay fixed. A Works sub-category is a site trade.
   Hide, not delete: SKUs and documents keep the code, and a hidden one still
   shows on the SKU that has it. Rules are checked server-side
   (backend scm/routes/renovation-catalog-settings.ts). */
import { useState } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, X } from 'lucide-react';
import { Button } from '../../../components/Button';
import { isFixedSub, subCategoriesOf, type CatalogGroup, type SubCategoryDef } from '../../../vendor/shared/renovation-catalog';
import { useAddSubCategory, useRenovationCatalog, useUpdateGroup, useUpdateSubCategory, type CatalogGroupRow } from '../../../vendor/scm/lib/renovation-catalog-queries';
import styles from '../Products.module.css';

/* 40px: a finger-sized target on a phone (the shared iconBtn is 22px). */
const rowBtn = `${styles.iconBtn} min-h-[40px] min-w-[40px] items-center justify-center`;

const errText = (e: unknown) => (e instanceof Error ? e.message : 'Could not save.');

export function RenovationSubCategorySettings({ initialGroup, onClose }: { initialGroup: CatalogGroup | null; onClose: () => void }) {
  const catalog = useRenovationCatalog();
  const add = useAddSubCategory();
  const update = useUpdateSubCategory();
  const updateGroup = useUpdateGroup();
  const [view, setView] = useState<'groups' | 'subs'>('subs');
  const [group, setGroup] = useState<CatalogGroup>(initialGroup ?? 'WORKS');
  const [newLabel, setNewLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  const editable = catalog.canEdit;
  const subs = subCategoriesOf(group, catalog.all);
  const busy = add.isPending || update.isPending || updateGroup.isPending;
  const groups = catalog.allGroups;

  const patch = (code: string, p: { label?: string; sortOrder?: number; active?: boolean }) =>
    update.mutateAsync({ code, ...p }).catch((e) => { setError(errText(e)); throw e; });

  const rename = (s: SubCategoryDef, label: string) => {
    const next = label.trim();
    if (!next || next === s.label) return;
    setError(null);
    void patch(s.code, { label: next }).catch(() => {});
  };

  const move = async (i: number, dir: -1 | 1) => {
    if (i < 0 || i >= subs.length || i + dir < 0 || i + dir >= subs.length) return;
    const a = subs[i];
    const b = subs[i + dir];
    setError(null);
    const aSort = a.sort === b.sort ? b.sort + dir : b.sort;
    try {
      await patch(a.code, { sortOrder: Math.max(0, aSort) });
      await patch(b.code, { sortOrder: a.sort });
    } catch { /* shown by patch */ }
  };

  const patchGroup = (code: string, p: { label?: string; sortOrder?: number; active?: boolean }) =>
    updateGroup.mutateAsync({ code, ...p }).catch((e) => { setError(errText(e)); throw e; });

  const renameGroup = (g: CatalogGroupRow, label: string) => {
    const next = label.trim();
    if (!next || next === g.label) return;
    setError(null);
    void patchGroup(g.code, { label: next }).catch(() => {});
  };

  /* Renumber the whole list on a move: groups added under Item Groups may share an order number. */
  const moveGroup = async (i: number, dir: -1 | 1) => {
    if (i + dir < 0 || i + dir >= groups.length) return;
    const next = [...groups];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    setError(null);
    try {
      for (const [n, g] of next.entries()) {
        if (g.sort_order !== (n + 1) * 10) await patchGroup(g.code, { sortOrder: (n + 1) * 10 });
      }
    } catch { /* shown by patchGroup */ }
  };

  const addOne = () => {
    const label = newLabel.trim();
    if (!label) return;
    setError(null);
    add.mutate({ group, label }, { onSuccess: () => setNewLabel(''), onError: (e) => setError(errText(e)) });
  };

  return (
    <div className={styles.drawerBackdrop} onClick={onClose}>
      <aside className={styles.drawer} role="dialog" aria-label="Groups and sub-categories" onClick={(e) => e.stopPropagation()}>
        <header className={styles.drawerHeader}>
          <h2 className={styles.drawerTitle}>{view === 'groups' ? 'Groups' : 'Sub-categories'}</h2>
          <button type="button" aria-label="Close" className={styles.iconBtn} onClick={onClose}><X size={16} strokeWidth={1.75} /></button>
        </header>
        <div className={`${styles.drawerBody} space-y-4`}>
          <div role="tablist" aria-label="Edit" className="flex gap-2">
            {([['groups', 'Groups'], ['subs', 'Sub-categories']] as const).map(([v, label]) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                className={`min-h-[40px] rounded-full border px-4 text-[13px] font-semibold ${view === v ? 'border-ink bg-ink text-white' : 'border-border bg-surface text-ink'}`}
                onClick={() => { setView(v); setError(null); }}
              >
                {label}
              </button>
            ))}
          </div>

          {view === 'groups' && (
            <>
              <p className="text-[12px] text-ink-secondary">
                {catalog.canEdit
                  ? 'Rename, reorder or hide the groups on the SKU Master. A hidden group stays on the SKUs and documents that have it, but cannot be picked for new ones. A new group is added under Accounting > Item Groups, because it needs its accounts.'
                  : 'You can view this list. Changing it needs permission to edit products.'}
              </p>
              <ul className="divide-y divide-border rounded-md border border-border" aria-label="Groups">
                {groups.map((g, i) => {
                  const hidden = g.active === false;
                  return (
                    <li key={g.code} className={`flex items-center gap-2 px-3 py-2 ${hidden ? 'bg-surface-2' : ''}`}>
                      {editable ? (
                        <input
                          aria-label={`Name of ${g.label}`}
                          defaultValue={g.label}
                          key={g.label}
                          maxLength={60}
                          className={`${styles.fieldInput} min-w-0 flex-1 ${hidden ? 'text-ink-muted' : ''}`}
                          onBlur={(e) => renameGroup(g, e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                        />
                      ) : (
                        <span className={`min-w-0 flex-1 text-[13px] ${hidden ? 'text-ink-muted' : ''}`}>{g.label}</span>
                      )}
                      {hidden && <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold text-ink-secondary">Hidden</span>}
                      {editable && (
                        <>
                          <button type="button" className={rowBtn} aria-label={`Move ${g.label} up`} disabled={busy || i === 0} onClick={() => void moveGroup(i, -1)}>
                            <ArrowUp size={14} strokeWidth={1.75} />
                          </button>
                          <button type="button" className={rowBtn} aria-label={`Move ${g.label} down`} disabled={busy || i === groups.length - 1} onClick={() => void moveGroup(i, 1)}>
                            <ArrowDown size={14} strokeWidth={1.75} />
                          </button>
                          <button
                            type="button"
                            className={rowBtn}
                            aria-label={hidden ? `Show ${g.label}` : `Hide ${g.label}`}
                            title={hidden ? 'Show' : 'Hide'}
                            disabled={busy}
                            onClick={() => { setError(null); void patchGroup(g.code, { active: hidden }).catch(() => {}); }}
                          >
                            {hidden ? <Eye size={14} strokeWidth={1.75} /> : <EyeOff size={14} strokeWidth={1.75} />}
                          </button>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {view === 'subs' && (<>
          <label className={styles.field} htmlFor="subcat-settings-group">
            <span className={styles.fieldLabel}>Group</span>
            <select
              id="subcat-settings-group"
              className={styles.fieldSelect}
              value={group}
              onChange={(e) => { setGroup(e.target.value as CatalogGroup); setError(null); }}
            >
              {groups.map((g) => <option key={g.code} value={g.code}>{g.active === false ? `${g.label} (hidden)` : g.label}</option>)}
            </select>
          </label>

          <p className="text-[12px] text-ink-secondary">
            {catalog.canEdit
              ? 'Hidden sub-categories stay on the SKUs that already have them, but cannot be picked for new ones. A new group is added under Accounting > Item Groups.'
              : 'You can view this list. Changing it needs permission to edit products.'}
          </p>
          {group === 'WORKS' && catalog.canEdit && (
            <p className="text-[12px] text-ink-secondary">
              Each Works sub-category is a site trade. A new one gets its own site task, placed after the built-in trades. The order here is only the list order.
            </p>
          )}
          {catalog.query.error && (
            <p role="alert" className="text-[12px] text-red-700">
              Could not load the saved list, showing the built-in one: {errText(catalog.query.error)}
            </p>
          )}

          <ul className="divide-y divide-border rounded-md border border-border" aria-label={`${groups.find((g) => g.code === group)?.label} sub-categories`}>
            {subs.map((s, i) => {
              const hidden = s.active === false;
              const rowEditable = editable && !isFixedSub(group, s.code);
              return (
                <li key={s.code} className={`flex items-center gap-2 px-3 py-2 ${hidden ? 'bg-surface-2' : ''}`}>
                  {rowEditable ? (
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
                  {rowEditable && (
                    <>
                      <button type="button" className={rowBtn} aria-label={`Move ${s.label} up`} disabled={busy || i === 0 || isFixedSub(group, subs[i - 1].code)} onClick={() => void move(i, -1)}>
                        <ArrowUp size={14} strokeWidth={1.75} />
                      </button>
                      <button type="button" className={rowBtn} aria-label={`Move ${s.label} down`} disabled={busy || i === subs.length - 1 || isFixedSub(group, subs[i + 1].code)} onClick={() => void move(i, 1)}>
                        <ArrowDown size={14} strokeWidth={1.75} />
                      </button>
                      <button
                        type="button"
                        className={rowBtn}
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
          </>)}
          {error && <p role="alert" className="text-[12px] text-red-700">{error}</p>}
        </div>
      </aside>
    </div>
  );
}
