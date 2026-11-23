import { useMemo, useState, type CSSProperties, type ReactElement } from 'react';
import { Check, Plus, Search } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { Modal } from './Modal';
import { CategoryDropdown, type CategoryOption } from './CategoryDropdown';

export interface ItemPickerRow {
  key: string;
  code: string;
  name: string;
  categoryLabel: string;
  supplierSku?: string;
  priceLabel?: string;
  uom?: string;
}

export type ItemPickerMode = 'add' | 'replace';

export interface ItemPickerDialogProps {
  title: string;
  subtitle: string;
  rows: readonly ItemPickerRow[];
  /** 'add' keeps the window open for more picks; 'replace' picks one item and closes. */
  mode?: ItemPickerMode;
  /** The code already on the line being replaced, marked as Current. */
  currentCode?: string;
  onPick: (row: ItemPickerRow) => void;
  onClose: () => void;
}

// The full catalogue is ~1,100 SKUs; painting all of them makes typing in the search box lag.
const RENDER_CAP = 80;
const TOUCH_PX = 44; // ds-allow-hardcode: touch-target floor
const INPUT_FONT_PX = 16; // ds-allow-hardcode: below 16px iOS zooms into the input

const toolbar: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' };
const field: CSSProperties = {
  minHeight: TOUCH_PX, fontSize: INPUT_FONT_PX, padding: '0 var(--space-3)', borderRadius: 'var(--radius-md)',
  border: '1px solid var(--line-strong)', background: 'var(--c-paper)', color: 'var(--c-ink)',
};
const list: CSSProperties = { display: 'flex', flexDirection: 'column', border: '1px solid var(--line)', borderRadius: 'var(--radius-lg)', background: 'var(--c-paper)' };
const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-3) var(--space-4)', borderTop: '1px solid var(--line)' };
const textCol: CSSProperties = { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 };
const codeStyle: CSSProperties = { fontWeight: 700, fontSize: 'var(--fs-14)', color: 'var(--c-ink)', overflowWrap: 'anywhere' };
const muted: CSSProperties = { fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', overflowWrap: 'anywhere' };
const skuStyle: CSSProperties = { fontSize: 'var(--fs-12)', color: 'var(--c-burnt)', fontFamily: 'var(--font-mono)', overflowWrap: 'anywhere' };
const priceCol: CSSProperties = { textAlign: 'right', flex: 'none', display: 'flex', flexDirection: 'column', gap: 2 };
const footer: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' };
const countPill: CSSProperties = { fontSize: 'var(--fs-12)', padding: 'var(--space-1) var(--space-3)', borderRadius: 'var(--radius-pill)', border: '1px solid var(--line-strong)', color: 'var(--fg-muted)' };

const currentBadge: CSSProperties = {
  marginLeft: 'var(--space-2)', fontSize: 'var(--fs-11)', fontWeight: 700, letterSpacing: '0.06em', verticalAlign: 'middle',
  padding: '1px var(--space-2)', borderRadius: 'var(--radius-pill)', border: '1px solid var(--line-strong)', color: 'var(--fg-muted)',
};

const matches = (row: ItemPickerRow, query: string): boolean =>
  [row.code, row.name, row.supplierSku ?? ''].some((text) => text.toLowerCase().includes(query));

export function ItemPickerDialog({ title, subtitle, rows, mode = 'add', currentCode, onPick, onClose }: ItemPickerDialogProps): ReactElement {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [addedByKey, setAddedByKey] = useState<Record<string, number>>({});

  const categoryOptions = useMemo<CategoryOption[]>(() => {
    const counts = new Map<string, number>();
    for (const { categoryLabel } of rows) counts.set(categoryLabel, (counts.get(categoryLabel) ?? 0) + 1);
    const sorted = [...counts].sort(([a], [b]) => a.localeCompare(b));
    return [
      { value: '', label: `All categories (${rows.length})` },
      ...sorted.map(([label, count]) => ({ value: label, label: `${label} (${count})` })),
    ];
  }, [rows]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => (!category || row.categoryLabel === category) && (!query || matches(row, query)));
  }, [rows, search, category]);
  const shown = filtered.slice(0, RENDER_CAP);
  const addedTotal = Object.values(addedByKey).reduce((sum, n) => sum + n, 0);

  const isReplace = mode === 'replace';
  const add = (row: ItemPickerRow): void => {
    onPick(row);
    if (isReplace) { onClose(); return; }
    setAddedByKey((prev) => ({ ...prev, [row.key]: (prev[row.key] ?? 0) + 1 }));
  };

  return (
    <Modal
      title={<>{title}<span style={{ display: 'block', ...muted, fontWeight: 400 }}>{subtitle}</span></>}
      onClose={onClose}
      width="min(760px, 100%)"
      ariaLabel={title}
    >
      <div style={toolbar}>
        <div style={{ flex: '1 1 180px' }}>
          <CategoryDropdown value={category} onChange={setCategory} options={categoryOptions} />
        </div>
        <label style={{ ...field, flex: '3 1 240px', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <Search size={16} strokeWidth={1.75} aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by item code, supplier SKU or description…"
            autoFocus
            style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: INPUT_FONT_PX, flex: 1, minWidth: 0, color: 'inherit' }}
          />
        </label>
      </div>

      <div style={list}>
        {shown.length === 0 && <p style={{ ...muted, padding: 'var(--space-5)', textAlign: 'center', margin: 0 }}>No items match.</p>}
        {shown.map((row, index) => {
          const addedCount = addedByKey[row.key] ?? 0;
          const isCurrent = isReplace && row.code === currentCode;
          return (
            <div
              key={row.key}
              style={{ ...rowStyle, ...(index === 0 && { borderTop: 'none' }), ...(isCurrent && { background: 'var(--c-cream)' }) }}
            >
              <div style={textCol}>
                <span style={codeStyle}>
                  {row.code}
                  {isCurrent && <span style={currentBadge}>Current</span>}
                </span>
                <span style={muted}>{row.categoryLabel} · {row.name}</span>
                {row.supplierSku && <span style={skuStyle}>{row.supplierSku}</span>}
              </div>
              {row.priceLabel && (
                <div style={priceCol}>
                  <span style={{ fontSize: 'var(--fs-14)', fontWeight: 600 }}>{row.priceLabel}</span>
                  {row.uom && <span style={muted}>{row.uom}</span>}
                </div>
              )}
              {isReplace ? (
                <Button variant="secondary" size="sm" onClick={() => add(row)} style={{ minHeight: TOUCH_PX, flex: 'none' }}>
                  Select
                </Button>
              ) : (
                <Button variant={addedCount ? 'primary' : 'secondary'} size="sm" onClick={() => add(row)} style={{ minHeight: TOUCH_PX, flex: 'none' }}>
                  {addedCount ? <><Check size={14} /> Added{addedCount > 1 ? ` ×${addedCount}` : ''}</> : <><Plus size={14} /> Add</>}
                </Button>
              )}
            </div>
          );
        })}
      </div>
      {filtered.length > shown.length && (
        <p style={{ ...muted, margin: 0 }}>Showing {shown.length} of {filtered.length}. Search or pick a category to narrow.</p>
      )}

      {isReplace ? (
        <div style={{ ...footer, justifyContent: 'flex-end' }}>
          <Button variant="ghost" size="md" onClick={onClose} style={{ minHeight: TOUCH_PX }}>Cancel</Button>
        </div>
      ) : (
        <div style={footer}>
          <span style={countPill}>{addedTotal} {addedTotal === 1 ? 'item' : 'items'} added</span>
          <Button variant="primary" size="md" onClick={onClose} style={{ minHeight: TOUCH_PX }}>Done</Button>
        </div>
      )}
    </Modal>
  );
}
