import { type ReactNode } from 'react';
import { NumericInput, type NumericBaseProps } from './NumericInput';

export interface NumberInputProps extends NumericBaseProps {
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  /** Decimal places kept. 0 (whole numbers) by default. */
  decimals?: number;
  allowNegative?: boolean;
  /** ArrowUp/ArrowDown change the value by this much. Defaults to 1 for whole numbers, off otherwise. */
  step?: number;
  /** Thousands separator once the field is left. On by default; turn off for codes such as a postcode prefix. */
  grouping?: boolean;
  /** Unit shown inside the field on the right, e.g. "h", "km". */
  suffix?: ReactNode;
}

/** Counts, quantities, minutes, kilometres. Text field with a numeric keyboard; see NumericInput for why. */
export function NumberInput({ value, onChange, min, max, decimals = 0, allowNegative, step, grouping = true, suffix, ...rest }: NumberInputProps) {
  const scale = 10 ** decimals;
  const toScaled = (n: number) => Math.round(n * scale);
  const stepUsed = step ?? (decimals === 0 ? 1 : undefined);
  return (
    <NumericInput
      {...rest}
      scaled={value == null ? null : toScaled(value)}
      onScaled={n => onChange(n == null ? null : n / scale)}
      decimals={decimals}
      allowNegative={allowNegative ?? (min != null && min < 0)}
      minScaled={min == null ? undefined : toScaled(min)}
      maxScaled={max == null ? undefined : toScaled(max)}
      describeBound={n => String(n / scale)}
      fixed={false}
      grouping={grouping}
      stepScaled={stepUsed == null ? undefined : toScaled(stepUsed)}
      inputMode={decimals === 0 ? 'numeric' : 'decimal'}
      trailing={suffix ? <span className="text-meta text-muted-ink">{suffix}</span> : undefined}
    />
  );
}
