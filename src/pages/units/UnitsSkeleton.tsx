import type { CSSProperties } from 'react';
import { Card } from '../../components/Card';
import { cx } from '../../lib/design-tokens';

const Bar = ({ className, style }: { className: string; style?: CSSProperties }) => <div className={cx('skeleton', className)} style={style} />;

/** The unit tree before the units arrive: its search box, a building heading and unit rows. */
export function TreeSkeleton({ fill }: { fill?: boolean }) {
  return (
    <Card style={fill ? { height: '100%' } : undefined}>
      <div aria-hidden>
        <div className="py-[10px] px-3 [border-bottom:1px_solid_var(--color-line)] flex flex-col gap-2">
          <Bar className="h-[36px] rounded-control" />
          <div className="flex items-center justify-between h-[20px]"><Bar className="h-[10px] w-[38%]" /><Bar className="h-[10px] w-[22%]" /></div>
        </div>
        {[3, 2, 2].map((n, g) => (
          <div key={g}>
            <div className="py-[10px] px-4 bg-page [border-bottom:1px_solid_var(--color-line-soft)] flex justify-between"><Bar className="h-[9px] w-[34%] skeleton-quiet" /><Bar className="h-[9px] w-[16%] skeleton-quiet" /></div>
            {Array.from({ length: n }, (_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 h-[46px] [border-bottom:1px_solid_var(--color-line-soft)]">
                <div className="flex flex-col gap-[7px] flex-1"><Bar className={cx('h-[11px]', i % 2 ? 'w-[46%]' : 'w-[58%]')} /><Bar className="h-[9px] w-[30%]" /></div>
                <Bar className="h-[8px] w-[8px] rounded-full!" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
}

/** One unit's record before it arrives: photo strip, title block with the owner beside it, the figures row and the tabs. */
export function RecordSkeleton() {
  return (
    <Card>
      <div aria-hidden>
        <div className="pt-[14px] px-[14px]"><Bar className="h-[84px] sm:h-[112px] rounded-control" /></div>
        <div className="pt-[18px] px-5 sm:px-6 pb-4 flex items-start justify-between gap-6 flex-wrap">
          <div className="flex flex-col gap-[11px] min-w-0 flex-1">
            <Bar className="h-[10px] w-[min(200px,50%)]" />
            <Bar className="h-[22px] w-[min(280px,70%)] rounded-control" />
            <Bar className="h-[11px] w-[min(240px,60%)]" />
            <Bar className="h-[32px] w-[150px] rounded-control" />
          </div>
          <div className="flex flex-col gap-[9px] w-[min(160px,45%)]">
            <Bar className="h-[10px] w-[50%]" /><Bar className="h-[15px] w-[90%]" /><Bar className="h-[10px] w-[70%]" />
          </div>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-x-4 gap-y-5 pt-5 px-5 sm:px-6 pb-5 [border-top:1px_solid_var(--color-line-soft)]">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex flex-col gap-2"><Bar className="h-[10px] w-[60%]" /><Bar className="h-[20px] sm:h-[24px] w-[70%]" /></div>
          ))}
        </div>
        <div className="flex gap-4 px-5 sm:px-6 h-[45px] items-center [border-top:1px_solid_var(--color-line)]">
          {[54, 44, 50, 42, 60, 48].map((w, i) => <Bar key={i} className={cx('h-[11px] flex-none', i > 3 && 'max-sm:hidden')} style={{ width: w }} />)}
        </div>
      </div>
    </Card>
  );
}
