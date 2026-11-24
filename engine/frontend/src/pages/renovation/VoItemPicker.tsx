import { useMemo, useRef, useState, type ReactElement } from 'react';
import { Search } from 'lucide-react';
import { ItemPickerDialog, type ItemPickerRow } from '../../vendor/scm/components/ItemPickerDialog';
import { mfgCategoryLabel, useMfgProducts } from '../../vendor/scm/lib/mfg-products-queries';
import { refusalOf, searchProducts, type ProductPick } from '../../lib/renovation/api';
import { useToast } from '../../hooks/useToast';
import { cn } from '../../lib/utils';

/* VO add and change item (owner, 24 Nov 2026): the purchase order's Select items window. The list is the SKU catalogue
   the PO uses; the picked SKU's VO price and cost come from the renovation product lookup. */
const BUTTON = 'flex h-11 w-full items-center gap-1 rounded border px-1.5 text-left text-[13px] font-semibold lg:h-8 lg:text-[11.5px]'; // ds-allow-hardcode: ProductPicker's tall button sizes

export function VoItemPicker({ mode, value, title, disabled, onPick, onClose }: {
  mode: 'add' | 'replace'; value: string | null; title: string; disabled?: boolean;
  onPick: (p: ProductPick) => void; onClose?: () => void;
}): ReactElement {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const skus = useMfgProducts({ enabled: open });
  /* Several Adds can be in flight at once: each must land on the latest edits, not the ones from when it was clicked. */
  const latestPick = useRef(onPick);
  latestPick.current = onPick;
  const rows = useMemo<ItemPickerRow[]>(() => (skus.data ?? [])
    .filter((p) => !p.code.startsWith('RENO-'))
    .map((p) => ({ key: p.id, code: p.code, name: p.name, categoryLabel: mfgCategoryLabel(p.category), uom: p.uom ?? undefined })), [skus.data]);

  const pick = async ({ code }: ItemPickerRow): Promise<void> => {
    try {
      const { products } = await searchProducts(code);
      const found = products.find((p) => p.code === code);
      if (!found) { toast.error(`${code} cannot go on a VO (it is not an active product).`); return; }
      latestPick.current(found);
    } catch (e) { toast.error(refusalOf(e).message); }
  };
  const close = (): void => { setOpen(false); onClose?.(); };

  return (
    <>
      <button type="button" disabled={disabled} onClick={() => setOpen(true)}
        className={cn(BUTTON,
          value ? 'border-border bg-surface-2 text-primary-ink' : 'border-dashed border-err/50 text-err', disabled && 'opacity-70')}
        title={value ? `Product ${value}` : 'Pick the product for this line'}>
        <Search size={12} className="shrink-0" />
        <span className="truncate">{value ?? (mode === 'add' ? 'Add items' : 'Pick product')}</span>
      </button>
      {open && (
        <ItemPickerDialog mode={mode} title={title} currentCode={value ?? undefined} rows={rows} onPick={(row) => void pick(row)} onClose={close}
          subtitle={skus.isLoading ? 'Loading SKUs...' : skus.error ? refusalOf(skus.error).message : `All ${rows.length} SKUs`} />
      )}
    </>
  );
}
