import type { ReactElement } from "react";

export interface ToggleGroupOption<Value extends string> { value: Value; label: string }

export function ToggleGroup<Value extends string>({ label, options, value, onChange }: {
  label: string;
  options: ReadonlyArray<ToggleGroupOption<Value>>;
  value: Value;
  onChange: (value: Value) => void;
}): ReactElement {
  return (
    <div role="group" aria-label={label} className="inline-flex shrink-0 overflow-hidden rounded-md border border-border">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={
            "h-7 px-3 text-[12px] font-semibold transition-colors [@media(pointer:coarse)]:h-11 " +
            (value === option.value ? "bg-primary text-white" : "bg-surface text-ink-secondary hover:bg-surface-dim")
          }
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
