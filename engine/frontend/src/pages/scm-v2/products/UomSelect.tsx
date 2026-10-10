/* The eight renovation units (spec 2026-10-09 section 3). Works are priced
   supply-and-install, so there are no bag or tin units. */
import { UOMS } from '../../../vendor/shared/renovation-catalog';
import styles from '../Products.module.css';

export function UomSelect({ value, onChange, id }: { value: string; onChange: (v: string) => void; id?: string }) {
  return (
    <select id={id} aria-label="Unit" className={styles.fieldSelect} value={value} onChange={(e) => onChange(e.target.value)}>
      {UOMS.map((u) => (
        <option key={u.code} value={u.code}>
          {u.label}{u.printLabel !== u.code ? ` (prints ${u.printLabel})` : ` (${u.code})`}
        </option>
      ))}
    </select>
  );
}
