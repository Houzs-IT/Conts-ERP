import { rm } from '../../lib/format';
import { NumericInput, type NumericBaseProps } from './NumericInput';

export interface MoneyInputProps extends NumericBaseProps {
  /** Integer sen, or null when the field is empty. */
  valueSen: number | null;
  onChangeSen: (sen: number | null) => void;
  /** Lowest allowed amount in sen. Defaults to 0 unless `allowNegative`. */
  minSen?: number;
  maxSen?: number;
  allowNegative?: boolean;
  /** Show the "RM" prefix inside the field. Off when the label or column already says RM. */
  prefix?: boolean;
}

/** Ringgit in, integer sen out. Typing "12.30" stores 1230; "RM 1,234.50" pastes as 123450. */
export function MoneyInput({ valueSen, onChangeSen, minSen, maxSen, allowNegative = false, prefix = false, placeholder, ...rest }: MoneyInputProps) {
  return (
    <NumericInput
      {...rest}
      placeholder={placeholder ?? '0.00'}
      scaled={valueSen}
      onScaled={onChangeSen}
      decimals={2}
      allowNegative={allowNegative}
      minScaled={minSen ?? (allowNegative ? undefined : 0)}
      maxScaled={maxSen}
      describeBound={rm}
      fixed
      grouping
      inputMode="decimal"
      leading={prefix ? <span className="text-meta text-muted-ink">RM</span> : undefined}
    />
  );
}
