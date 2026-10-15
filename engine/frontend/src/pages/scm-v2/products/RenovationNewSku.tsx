/* New SKU for the renovation catalog: code, name, group, sub-category (a Works
   SKU's trade), unit and description. Prices live on the quotation / SO line and
   cost on the supplier binding, so none are asked here. A photo-group SKU is
   created INACTIVE and the drawer says it needs a photo; Works / Service SKUs are
   active at once. */
import { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '../../../components/Button';
import { useNotify } from '../../../vendor/scm/components/NotifyDialog';
import { useCreateMfgProduct, type MfgCategory } from '../../../vendor/scm/lib/mfg-products-queries';
import { genericSkus, isPhotoRequiredCategory, type CatalogGroup } from '../../../vendor/shared/renovation-catalog';
import { useRenovationCatalog } from '../../../vendor/scm/lib/renovation-catalog-queries';
import { CatalogCategoryPicker } from './CatalogCategoryPicker';
import { UomSelect } from './UomSelect';
import styles from '../Products.module.css';

const defaultUom = (sub: string | null) => genericSkus().find((g) => g.sub === sub)?.uom ?? 'UNIT';

export function RenovationNewSku({
  initialGroup,
  initialSub,
  onClose,
  onCreated,
}: {
  initialGroup: CatalogGroup | null;
  initialSub: string | null;
  onClose: () => void;
  onCreated: (created: { id: string; code: string; needsPhoto: boolean }) => void;
}) {
  const create = useCreateMfgProduct();
  const notify = useNotify();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [group, setGroup] = useState<CatalogGroup>(initialGroup ?? 'WORKS');
  const [sub, setSub] = useState<string | null>(initialSub);
  const [uom, setUom] = useState(defaultUom(initialSub));
  const [uomTouched, setUomTouched] = useState(false);
  // A trade's default unit may have been hidden under Units; a new SKU then starts on UNIT.
  const pickable = useRenovationCatalog().pickableUoms(null);
  const unit = pickable.some((u) => u.code === uom) ? uom : 'UNIT';
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    if (!code.trim()) return setError('Code is required.');
    if (!name.trim()) return setError('Name is required.');
    if (!sub) return setError(group === 'WORKS' ? 'Choose the trade.' : 'Choose the sub-category.');
    create.mutate(
      {
        code: code.trim(),
        name: name.trim(),
        category: group as MfgCategory,
        subCategory: sub,
        uom: unit,
        description: description.trim() || undefined,
      },
      {
        onSuccess: (res) => {
          const needsPhoto = res.needsPhoto ?? isPhotoRequiredCategory(group);
          void notify({
            title: needsPhoto ? `${res.code} created. Add a photo to make it active.` : `${res.code} created and active.`,
          });
          onCreated({ id: res.id, code: res.code, needsPhoto });
        },
        onError: (e) => setError(e instanceof Error ? e.message : 'Could not create the SKU.'),
      },
    );
  };

  return (
    <div className={styles.drawerBackdrop} onClick={onClose}>
      <aside className={styles.drawer} role="dialog" aria-label="New SKU" onClick={(e) => e.stopPropagation()}>
        <header className={styles.drawerHeader}>
          <h2 className={styles.drawerTitle}>New SKU</h2>
          <button type="button" aria-label="Close" className={styles.iconBtn} onClick={onClose}><X size={16} strokeWidth={1.75} /></button>
        </header>
        <div className={styles.drawerBody}>
          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Code *</span>
              <input aria-label="Code" className={styles.fieldInput} value={code} onChange={(e) => setCode(e.target.value)} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Name *</span>
              <input aria-label="Name" className={styles.fieldInput} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <CatalogCategoryPicker
              idPrefix="new-sku"
              group={group}
              sub={sub}
              onChange={(n) => {
                setGroup(n.group);
                setSub(n.sub);
                if (!uomTouched) setUom(defaultUom(n.sub));
              }}
            />
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Unit</span>
              <UomSelect value={unit} keep={null} onChange={(v) => { setUom(v); setUomTouched(true); }} />
            </label>
            <label className={`${styles.field} ${styles.formGridFull}`}>
              <span className={styles.fieldLabel}>Description</span>
              <input aria-label="Description" className={styles.fieldInput} value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
          </div>
          {error && <p role="alert" className="mt-3 text-[12px] text-red-700">{error}</p>}
        </div>
        <footer className={styles.drawerFooter}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create SKU'}
          </Button>
        </footer>
      </aside>
    </div>
  );
}
