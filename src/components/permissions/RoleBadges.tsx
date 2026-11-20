import { cx } from '../../lib/design-tokens';

export interface RoleLabel { position: string; department: string | null }

export interface RoleBadgesProps {
  /** The main role first, then the extra ones. */
  roles: readonly RoleLabel[];
  /** How many roles to draw before the rest fold into "+N". */
  shown?: number;
}

const text = ({ position, department }: RoleLabel): string => (department ? `${position} · ${department}` : position);

/** Each role as its job title pill with its department underneath, so the title reads at a glance. */
export function RoleBadges({ roles, shown = 2 }: RoleBadgesProps) {
  const rest = roles.slice(shown);
  return (
    <span className="flex items-start gap-3 min-w-0" title={roles.map(text).join('\n')}>
      {roles.slice(0, shown).map((role, i) => (
        <span key={text(role)} className="flex flex-col items-start gap-0.5 min-w-0">
          <span className={cx('inline-flex items-center px-2 py-px rounded-pill border border-solid text-caption whitespace-nowrap max-w-full overflow-hidden text-ellipsis',
            i === 0 ? 'bg-ink border-ink text-card font-semibold' : 'bg-card border-ink-2 text-ink font-medium')}>
            {role.position}
          </span>
          {role.department && <span className="text-caption text-ink-2 whitespace-nowrap max-w-full overflow-hidden text-ellipsis">{role.department}</span>}
        </span>
      ))}
      {rest.length > 0 && (
        <span className="inline-flex items-center px-2 py-px rounded-pill border border-solid border-line-strong bg-muted text-caption font-semibold text-ink-2 whitespace-nowrap"
          aria-label={`${rest.length} more: ${rest.map(text).join(', ')}`}>
          +{rest.length}
        </span>
      )}
    </span>
  );
}
