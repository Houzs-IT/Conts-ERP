/* Group + sub-category picker for one SKU. The sub-category list follows the
   group; changing the group clears a sub-category that does not belong to it.
   A legacy Houzs category (SOFA, ...) is shown as its group with its implied
   sub-category, and is only rewritten if the user picks something else.
   A hidden sub-category is offered only to the SKU that already has it. */
import { RENOVATION_GROUPS, isPhotoRequiredCategory, type CatalogGroup } from '../../../vendor/shared/renovation-catalog';
import { useRenovationCatalog } from '../../../vendor/scm/lib/renovation-catalog-queries';
import styles from '../Products.module.css';

export function CatalogCategoryPicker({
  group,
  sub,
  onChange,
  idPrefix = 'cat',
}: {
  group: CatalogGroup;
  sub: string | null;
  onChange: (next: { group: CatalogGroup; sub: string | null }) => void;
  idPrefix?: string;
}) {
  const catalog = useRenovationCatalog();
  const subs = catalog.pickable(group, sub);
  return (
    <>
      <label className={styles.field} htmlFor={`${idPrefix}-group`}>
        <span className={styles.fieldLabel}>Group *</span>
        <select
          id={`${idPrefix}-group`}
          className={styles.fieldSelect}
          value={group}
          onChange={(e) => {
            const g = e.target.value as CatalogGroup;
            const keep = sub && catalog.pickable(g, sub).some((s) => s.code === sub) ? sub : null;
            onChange({ group: g, sub: keep });
          }}
        >
          {RENOVATION_GROUPS.map((g) => (
            <option key={g.code} value={g.code}>{g.label}</option>
          ))}
        </select>
      </label>
      <label className={styles.field} htmlFor={`${idPrefix}-sub`}>
        <span className={styles.fieldLabel}>{group === 'WORKS' ? 'Trade *' : 'Sub-category *'}</span>
        <select
          id={`${idPrefix}-sub`}
          className={styles.fieldSelect}
          value={sub ?? ''}
          onChange={(e) => onChange({ group, sub: e.target.value || null })}
        >
          <option value="">Choose…</option>
          {subs.map((s) => (
            <option key={s.code} value={s.code}>{s.label}</option>
          ))}
        </select>
      </label>
      {isPhotoRequiredCategory(group) && (
        <p className={`${styles.formGridFull} text-[12px] text-ink-secondary`}>
          {RENOVATION_GROUPS.find((g) => g.code === group)?.label} SKUs need a photo before they can be active.
        </p>
      )}
    </>
  );
}
