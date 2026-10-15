/* The renovation units as saved under SKU Master > Units (migration 0118).
   A hidden unit is offered only to the SKU that already has it (`keep`). */
import { useRenovationCatalog } from '../../../vendor/scm/lib/renovation-catalog-queries';
import styles from '../Products.module.css';

export function UomSelect({ value, onChange, id, keep }: { value: string; onChange: (v: string) => void; id?: string; keep?: string | null }) {
  const units = useRenovationCatalog().pickableUoms(keep ?? value);
  return (
    <select id={id} aria-label="Unit" className={styles.fieldSelect} value={value} onChange={(e) => onChange(e.target.value)}>
      {units.map((u) => (
        <option key={u.code} value={u.code}>
          {u.label}{u.printLabel !== u.code ? ` (prints ${u.printLabel})` : ` (${u.code})`}{u.active === false ? ' - hidden' : ''}
        </option>
      ))}
    </select>
  );
}
