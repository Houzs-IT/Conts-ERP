import { StatTile } from './Metric';

export interface SystemStat { label: string; value: string | undefined; hint?: string; warn?: boolean }

/** The four-figure strip under each System page header (Settings, Integrations, Users and roles,
 *  Automations, Pricing). The first figure is the hero tile. Four across on wide screens and 2 × 2
 *  below 1024px, so a tile never sits alone on its own row. Display only: every figure is computed
 *  by the page from data it already loads. */
export function SystemStats({ stats, loading }: { stats: SystemStat[]; loading?: boolean }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      {stats.map((s, i) => (
        <StatTile key={s.label} label={s.label} value={s.value} hint={s.hint} loading={loading}
          hero={i === 0} tone={s.warn ? 'warning' : undefined} />
      ))}
    </div>
  );
}
