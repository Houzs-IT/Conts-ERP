import type { UserSide } from '../../lib/types';
import { companiesOf, sideLabel, type Company } from './shared';

const COMPANY_DOT_COLOR: Record<Company, string> = {
  conts: 'var(--color-gold-500)',
  dream_crafter: 'var(--color-info-line)',
};

export interface CompanyBadgesProps { side: UserSide }

export function CompanyBadges({ side }: CompanyBadgesProps) {
  return (
    <span className="flex items-center gap-1.5 flex-wrap min-w-0">
      {companiesOf(side).map(company => (
        // A tint and border of the company's own colour, so the two companies stay apart at a glance.
        <span key={company}
          className="inline-flex items-center gap-1.5 px-2 py-px rounded-pill border border-solid text-caption font-semibold text-ink whitespace-nowrap"
          style={{ background: `color-mix(in srgb, ${COMPANY_DOT_COLOR[company]} 16%, var(--color-card))`, borderColor: `color-mix(in srgb, ${COMPANY_DOT_COLOR[company]} 60%, var(--color-card))` }}>
          <span aria-hidden className="w-1.5 h-1.5 rounded-full flex-none" style={{ background: COMPANY_DOT_COLOR[company] }} />
          {sideLabel(company)}
        </span>
      ))}
    </span>
  );
}
