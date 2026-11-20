import { cx } from '../../lib/design-tokens';

export interface RoleLabel { position: string; department: string | null }

export interface RoleBadgesProps {
  /** The main role first, then the extra ones. */
  roles: readonly RoleLabel[];
  /** How many pills to draw before the rest fold into "+N". */
  shown?: number;
}

const text = ({ position, department }: RoleLabel): string => (department ? `${position} · ${department}` : position);

export function RoleBadges({ roles, shown = 2 }: RoleBadgesProps) {
  const rest = roles.slice(shown);
  return (
    <span className="flex items-center gap-1.5 flex-wrap min-w-0" title={roles.map(text).join('\n')}>
      {roles.slice(0, shown).map((role, i) => (
        <span key={text(role)}
          className={cx('inline-flex items-center px-2 py-px rounded-pill border border-solid text-caption whitespace-nowrap max-w-full overflow-hidden text-ellipsis',
            i === 0 ? 'border-line-strong bg-card font-semibold text-ink' : 'border-line bg-card font-medium text-muted-ink')}>
          {role.position}
        </span>
      ))}
      {rest.length > 0 && (
        <span className="inline-flex items-center px-2 py-px rounded-pill bg-muted text-caption font-medium text-muted-ink whitespace-nowrap"
          aria-label={`${rest.length} more: ${rest.map(text).join(', ')}`}>
          +{rest.length}
        </span>
      )}
    </span>
  );
}
