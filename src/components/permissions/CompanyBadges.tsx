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
        <span key={company}
          className="inline-flex items-center gap-1.5 px-2 py-px rounded-pill border border-solid border-line bg-card text-caption font-medium text-ink whitespace-nowrap">
          <span aria-hidden className="w-1.5 h-1.5 rounded-full flex-none" style={{ background: COMPANY_DOT_COLOR[company] }} />
          {sideLabel(company)}
        </span>
      ))}
    </span>
  );
}
