import { NumericInput, type NumericBaseProps } from './NumericInput';

export interface PercentInputProps extends NumericBaseProps {
  /** Whole percent: 75 means 75%, never 0.75. Null when empty. */
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  /** Defaults to 100. */
  max?: number;
  /** Decimal places kept. Defaults to 2. */
  decimals?: number;
}

/** A share in whole percent with a "%" inside the field. Typing 0.75 is allowed but flagged, since it nearly always
 *  means someone meant 75%. */
export function PercentInput({ value, onChange, min = 0, max = 100, decimals = 2, help, ...rest }: PercentInputProps) {
  const scale = 10 ** decimals;
  return (
    <NumericInput
      {...rest}
      help={help}
      scaled={value == null ? null : Math.round(value * scale)}
      onScaled={n => onChange(n == null ? null : n / scale)}
      decimals={decimals}
      allowNegative={min < 0}
      minScaled={Math.round(min * scale)}
      maxScaled={Math.round(max * scale)}
      describeBound={n => `${n / scale}%`}
      fixed={false}
      grouping={false}
      inputMode="decimal"
      trailing={<span className="text-meta text-muted-ink">%</span>}
      hint={n => (n != null && n > 0 && n < scale ? `That is under 1%. For 75%, type 75.` : undefined)}
    />
  );
}
