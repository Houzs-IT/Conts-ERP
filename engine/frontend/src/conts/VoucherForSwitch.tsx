// Conts only: "For" on a payment voucher — Rental, Renovation, Company or Mixed (chew 2 Nov 2026; SOP 3.2). The choice
// sets every line's department; conts/voucherPurpose.ts holds the rules.
import { VOUCHER_FOR, type VoucherFor } from "./voucherPurpose";

export function VoucherForSwitch({ value, onChange, disabled, labelClass }: {
  value: VoucherFor | ""; onChange: (f: VoucherFor) => void; disabled?: boolean; labelClass?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span className={labelClass} id="voucher-for-label">For *</span>
      <div role="radiogroup" aria-labelledby="voucher-for-label" style={{ display: "flex", flexWrap: "wrap", gap: 0, border: "1px solid var(--line, rgba(34,31,32,0.2))", borderRadius: 8, overflow: "hidden", width: "fit-content", maxWidth: "100%" }}>
        {VOUCHER_FOR.map((o, i) => {
          const on = value === o.value;
          return (
            <button key={o.value} type="button" role="radio" aria-checked={on} disabled={disabled} onClick={() => onChange(o.value)}
              style={{
                padding: "6px 14px", border: "none", borderLeft: i === 0 ? "none" : "1px solid var(--line, rgba(34,31,32,0.2))",
                background: on ? "var(--c-ink, #221F20)" : "transparent", color: on ? "var(--c-paper, #fff)" : "inherit",
                fontWeight: on ? 700 : 500, cursor: disabled ? "default" : "pointer", fontSize: "var(--fs-13)",
              }}>
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
