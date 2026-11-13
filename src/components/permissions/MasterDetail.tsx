import type { ReactNode } from 'react';
import { Button } from '../Button';
import Icon from '../Icon';
import { cx } from '../../lib/design-tokens';

export function BackLink({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <div className="-ml-2.5 lg:hidden">
      <Button variant="tertiary" size="sm" icon={<Icon name="ChevronLeft" size="sm" />} onClick={onBack}>{label}</Button>
    </div>
  );
}

export interface MasterDetailProps {
  list: ReactNode;
  detail: ReactNode | null;
  emptyDetail: string;
}

export function MasterDetail({ list, detail, emptyDetail }: MasterDetailProps) {
  const isDetailOpen = detail !== null;
  return (
    <div className="lg:grid lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
      <div className={cx('lg:sticky lg:top-0 lg:max-h-[calc(100dvh-96px)] lg:overflow-y-auto lg:[border-right:1px_solid_var(--color-line)]', isDetailOpen && 'max-lg:hidden')}>
        {list}
      </div>
      <div className={cx('min-w-0', !isDetailOpen && 'max-lg:hidden')}>
        {detail ?? <p className="m-0 p-8 text-center text-copy text-muted-ink">{emptyDetail}</p>}
      </div>
    </div>
  );
}
