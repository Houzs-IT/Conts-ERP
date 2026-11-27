// The few pieces the Meetings page needs from the app, kept in one file so the page files read the same as Houzs
// ERP's and Hookka ERP's (one hub, three front ends):
//   TabStrip  - The Conts' own sub-tabs (TabBar, gold underline).
//   DialogFrame - The Conts' dialog behaviour (focus trap, Escape, backdrop), used for the phone filter sheet.
//   DateField, TimeField, NumberInput - The Conts' inputs (src/components/inputs), never a raw <input type="date|time|number">.
import type { ReactNode } from "react";
import { TabBar } from "../../components/TabBar";
import { DateField as ContsDateField, TimeField as ContsTimeField, NumberInput } from "../../components/inputs";

export { NumberInput };
export { DialogFrame } from "../../components/Modal";

const text = (n: ReactNode): string => (typeof n === "string" || typeof n === "number" ? String(n) : "");

export function TabStrip<T extends string>(p: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; className?: string }) {
  return (
    <div className={p.className}>
      <TabBar id="meetings" label="Meetings pages" tabs={p.options.map((o) => ({ key: o.value, label: text(o.label) }))} value={p.value} onChange={p.onChange} />
    </div>
  );
}

export function DateField(p: { value: string; onChange: (v: string) => void; fullWidth?: boolean; "aria-label"?: string }) {
  return <ContsDateField value={p.value} onChange={p.onChange} aria-label={p["aria-label"]} style={p.fullWidth ? { width: "100%" } : undefined} />;
}

export function TimeField(p: { value: string; onChange: (v: string) => void; "aria-label"?: string }) {
  return <ContsTimeField value={p.value} onChange={p.onChange} aria-label={p["aria-label"]} />;
}
