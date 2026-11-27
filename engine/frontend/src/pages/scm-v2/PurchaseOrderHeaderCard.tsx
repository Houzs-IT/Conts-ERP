import type { ReactElement } from 'react';
import { ChevronDown } from 'lucide-react';
import { formatPhone } from '@2990s/shared/phone';
import { DateField } from '../../vendor/scm/components/DateField';
import { SearchableSelect } from '../../vendor/scm/components/SearchableSelect';
import styles from './SalesOrderDetail.module.css';
import layout from './PurchaseOrderHeaderCard.module.css';

export interface PoHeaderOption {
  value: string;
  label: string;
}

export interface PoHeaderSupplier {
  name: string;
  address?: string | null;
  area?: string | null;
  postcode?: string | null;
  state?: string | null;
  country?: string | null;
  contact_person?: string | null;
  phone?: string | null;
  email?: string | null;
  payment_terms?: string | null;
}

export interface PoHeaderDates {
  poDate: string;
  expectedAt: string;
  supplierDate2: string;
  supplierDate3: string;
  supplierDate4: string;
}

export type PoHeaderDateKey = keyof PoHeaderDates;

export interface PurchaseOrderHeaderCardProps {
  supplierId: string;
  creditorOptions: PoHeaderOption[];
  onCreditorChange: (supplierId: string) => void;
  supplier: PoHeaderSupplier | null;
  currency: string;
  dates: PoHeaderDates;
  onDateChange: (key: PoHeaderDateKey, iso: string) => void;
  purchaseLocationId: string;
  warehouseOptions: PoHeaderOption[];
  onPurchaseLocationChange: (warehouseId: string) => void;
  notes: string;
  onNotesChange: (notes: string) => void;
}

const SUPPLIER_DATE_SLOTS = [
  { key: 'supplierDate2', label: 'Supplier Date 2' },
  { key: 'supplierDate3', label: 'Supplier Date 3' },
  { key: 'supplierDate4', label: 'Supplier Date 4' },
] as const satisfies ReadonlyArray<{ key: PoHeaderDateKey; label: string }>;

function joinAddress({ address, area, postcode, state, country }: PoHeaderSupplier): string {
  return [address, area, postcode, state, country].filter(Boolean).join(', ');
}

function SupplierSummary({ supplier, currency }: { supplier: PoHeaderSupplier | null; currency: string }): ReactElement {
  if (!supplier) {
    return <div className={layout.summary}><span className={layout.summaryEmpty}>Name and address fill in when you pick a creditor.</span></div>;
  }
  const address = joinAddress(supplier);
  const { contact_person: contactPerson, phone, email, payment_terms: paymentTerms } = supplier;
  return (
    <div className={layout.summary}>
      <div className={layout.summaryName}>{supplier.name}</div>
      {address && <div className={layout.summaryLine}>{address}</div>}
      <div className={layout.summaryMeta}>
        {contactPerson && <span>Contact <strong>{contactPerson}</strong></span>}
        {phone && <span>Phone <strong>{formatPhone(phone)}</strong></span>}
        {email && <span>Email <strong>{email}</strong></span>}
        {paymentTerms && <span>Terms <strong>{paymentTerms}</strong></span>}
        <span>Currency <strong>{currency}</strong></span>
      </div>
    </div>
  );
}

function RequiredLabel({ text }: { text: string }): ReactElement {
  return <span className={`${styles.fieldLabel} ${styles.fieldLabelReq}`}>{text} <span className={styles.req}>*</span></span>;
}

export function PurchaseOrderHeaderCard({
  supplierId, creditorOptions, onCreditorChange, supplier, currency, dates, onDateChange,
  purchaseLocationId, warehouseOptions, onPurchaseLocationChange, notes, onNotesChange,
}: PurchaseOrderHeaderCardProps): ReactElement {
  const control = `${styles.fieldInput} ${layout.control}`;
  const dateControl = `${styles.fieldInput} ${layout.dateControl}`;
  return (
    <section className={styles.card}>
      <div className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>Header</h2>
      </div>
      <div className={`${styles.cardBody} ${layout.body}`}>
        <div className={layout.top}>
          <div className={layout.stack}>
            <label className={styles.field}>
              <RequiredLabel text="Creditor" />
              {/* Type-to-search: a plain select over every supplier was a long scroll (Hookka #HK supplier picker, owner 8 Nov). */}
              <SearchableSelect
                value={supplierId}
                onChange={onCreditorChange}
                clearable
                options={creditorOptions}
                placeholder="Type a supplier code or name"
                ariaLabel="Creditor"
                className={control}
              />
            </label>
            <SupplierSummary supplier={supplier} currency={currency} />
          </div>

          <div className={layout.stack}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>P/O No</span>
              <input type="text" readOnly value="(assigned on Save)" className={control} />
            </label>
            <div className={layout.pair}>
              <label className={styles.field}>
                <RequiredLabel text="Date" />
                <DateField fullWidth value={dates.poDate} onChange={(iso) => onDateChange('poDate', iso)} className={dateControl} />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Expected Delivery</span>
                <DateField fullWidth value={dates.expectedAt} onChange={(iso) => onDateChange('expectedAt', iso)} className={dateControl} />
                <span className={layout.caption}>Defaults to today</span>
              </label>
            </div>
          </div>
        </div>

        {/* Mig 0026: supplier-revised header delivery dates. Optional; they fan down to lines without their own revised date. */}
        <div className={layout.row4}>
          {SUPPLIER_DATE_SLOTS.map(({ key, label }) => (
            <label key={key} className={styles.field}>
              <span className={styles.fieldLabel}>{label}</span>
              <DateField fullWidth value={dates[key]} onChange={(iso) => onDateChange(key, iso)} className={dateControl} />
            </label>
          ))}
          <label className={styles.field}>
            <RequiredLabel text="Purchase Location" />
            <span className={styles.selectWrap}>
              <select
                value={purchaseLocationId}
                onChange={(e) => onPurchaseLocationChange(e.target.value)}
                className={`${styles.fieldSelect} ${layout.control}`}
                required
              >
                <option value="">Pick a warehouse</option>
                {warehouseOptions.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
              </select>
              <ChevronDown size={14} className={styles.selectChevron} aria-hidden />
            </span>
            <span className={layout.caption}>Default ship-to for every line. Each line can change it.</span>
          </label>
        </div>

        <label className={`${styles.field} ${layout.notes}`}>
          <span className={styles.fieldLabel}>Notes</span>
          <textarea
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
            placeholder="Supplier instructions, internal notes"
            className={`${styles.fieldInput} ${layout.textarea}`}
            rows={2}
          />
        </label>
      </div>
    </section>
  );
}
