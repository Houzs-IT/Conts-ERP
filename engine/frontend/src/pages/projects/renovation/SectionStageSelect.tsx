import { RENO_STAGES, STAGE_LABEL, isStageKey, type StageKey } from "../../../vendor/shared/renovation-stages";

/** The stage a checklist template section belongs to. Only a section with a stage
    is copied into a new renovation project (services/renovation/create.ts). */
export function SectionStageSelect({
  value,
  onChange,
  label,
  disabled,
  className,
}: {
  value: string | null | undefined;
  onChange: (stage: StageKey | null) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <select
      aria-label={label}
      title={label}
      value={isStageKey(value ?? null) ? (value as string) : ""}
      disabled={disabled}
      onChange={(e) => onChange(isStageKey(e.target.value) ? e.target.value : null)}
      className={className ?? "h-7 rounded-md border border-border bg-surface px-1.5 text-[11px] text-ink-secondary outline-none focus:border-primary"}
    >
      <option value="">No stage (not copied)</option>
      {RENO_STAGES.map((k) => (
        <option key={k} value={k}>
          {STAGE_LABEL[k]}
        </option>
      ))}
    </select>
  );
}
