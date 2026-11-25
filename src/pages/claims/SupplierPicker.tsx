import { useMemo, useState } from 'react';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import Icon from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { useApi } from '../../lib/useApi';
import { cx } from '../../lib/design-tokens';

export type Supplier = { id: string; code: string; name: string };

/** Every supplier of the company in a table to search, with "Not on the list" first when the payee may be typed. */
export function SupplierPicker({ value, onChange, allowNotListed }: { value: Supplier | null; onChange: (s: Supplier | null) => void; allowNotListed: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const all = useApi<{ suppliers: Supplier[] }>(open ? '/claims/suppliers' : null);
  const rows = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return (all.data?.suppliers ?? []).filter(s => words.every(w => `${s.code} ${s.name}`.toLowerCase().includes(w)));
  }, [all.data, q]);
  const pick = (s: Supplier | null) => { onChange(s); setOpen(false); setQ(''); };
  return (
    <div className="flex flex-col gap-1">
      <span className="text-meta font-semibold text-ink">Supplier</span>
      <button type="button" onClick={() => setOpen(true)} aria-label="Supplier"
        className="h-[var(--control-height)] min-h-10 flex items-center justify-between gap-2 px-3 rounded-control border border-solid border-line-input bg-card font-sans text-copy text-left text-ink cursor-pointer hover:border-line-strong">
        <span className={cx('truncate', !value && 'text-muted-ink')}>{value ? `${value.code} ${value.name}` : allowNotListed ? 'Choose the supplier, or not on the list' : 'Choose the supplier'}</span>
        <Icon name="ChevronDown" size="sm" />
      </button>
      {open && (
        <Modal title="Choose the supplier" eyebrow="My claims" size="md" onClose={() => setOpen(false)} dirty={false}
          footer={<Button variant="secondary" size="sm" onClick={() => setOpen(false)}>Cancel</Button>}>
          <Field label="Search" value={q} onChange={e => setQ(e.target.value)} placeholder="Name or code" autoFocus />
          <div className="mt-3 max-h-[55vh] overflow-auto rounded-control border border-solid border-line-soft">
            {allowNotListed && (
              <button type="button" onClick={() => pick(null)} className="w-full flex items-center justify-between gap-3 min-h-11 px-3 py-2 bg-transparent border-0 [border-bottom:1px_solid_var(--color-line-soft)] font-sans text-left cursor-pointer hover:bg-muted">
                <span className="flex flex-col"><b className="text-copy">Not on the list</b><span className="text-meta text-muted-ink">Type who is paid; finance checks them</span></span>
                <Icon name="ChevronRight" size="sm" />
              </button>
            )}
            {all.loading && <div className="px-3 py-3 text-copy text-muted-ink">Loading suppliers</div>}
            {!all.loading && rows.length === 0 && <div className="px-3 py-3 text-copy text-muted-ink">No supplier matches.</div>}
            {rows.map(s => (
              <button key={s.id} type="button" onClick={() => pick(s)} aria-pressed={value?.id === s.id}
                className={cx('w-full flex items-center gap-3 min-h-10 px-3 py-2 border-0 [border-bottom:1px_solid_var(--color-line-soft)] font-sans text-copy text-left cursor-pointer hover:bg-muted', value?.id === s.id ? 'bg-muted' : 'bg-transparent')}>
                <span className="font-mono text-meta text-muted-ink whitespace-nowrap">{s.code}</span>
                <span className="min-w-0 truncate">{s.name}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
