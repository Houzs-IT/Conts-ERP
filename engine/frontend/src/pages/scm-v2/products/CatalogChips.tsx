/* Group and sub-category chips for the renovation SKU Master (spec 2026-10-09
   section 3). One row of the seven groups, and, once a group is picked, a row of
   its sub-categories. Same pill look as the Houzs category chips. */
import { RENOVATION_GROUPS, subCategoriesOf, type CatalogGroup } from '../../../vendor/shared/renovation-catalog';

const chipClass = (active: boolean, small = false) =>
  [
    'whitespace-nowrap rounded-full border font-semibold tracking-wide transition-all duration-150',
    small ? 'px-3 py-1 text-[12px]' : 'px-4 py-1.5 text-[13px]',
    active
      ? 'border-primary bg-primary text-white shadow-sm'
      : 'border-border bg-surface text-ink hover:border-primary/40 hover:bg-primary-soft hover:text-primary',
  ].join(' ');

export function CatalogChips({
  group,
  sub,
  onGroup,
  onSub,
}: {
  group: CatalogGroup | null;
  sub: string | null;
  onGroup: (g: CatalogGroup | null) => void;
  onSub: (s: string | null) => void;
}) {
  const subs = group ? subCategoriesOf(group) : [];
  return (
    <div className="space-y-2">
      <div role="group" aria-label="Category group" className="flex flex-wrap gap-1.5">
        <button type="button" className={chipClass(group === null)} aria-pressed={group === null} onClick={() => { onGroup(null); onSub(null); }}>
          All
        </button>
        {RENOVATION_GROUPS.map((g) => (
          <button
            key={g.code}
            type="button"
            className={chipClass(group === g.code)}
            aria-pressed={group === g.code}
            onClick={() => { onGroup(g.code); onSub(null); }}
          >
            {g.label}
          </button>
        ))}
      </div>
      {group && (
        <div role="group" aria-label="Sub-category" className="flex flex-wrap gap-1.5 border-l-2 border-primary/30 pl-2">
          <button type="button" className={chipClass(sub === null, true)} aria-pressed={sub === null} onClick={() => onSub(null)}>
            All {RENOVATION_GROUPS.find((g) => g.code === group)?.label.toLowerCase()}
          </button>
          {subs.map((s) => (
            <button key={s.code} type="button" className={chipClass(sub === s.code, true)} aria-pressed={sub === s.code} onClick={() => onSub(s.code)}>
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
