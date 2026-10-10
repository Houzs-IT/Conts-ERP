import { useState } from 'react';
import { Badge } from '../components/Badge';
import { PageControls } from '../components/PageControls';
import { EmptyState } from '../components/States';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { ListCard, FilterSelect, STICKY_HEAD, usePhone } from './finance/listKit';
import { useApi } from '../lib/useApi';
import { dateTime, todayMyt } from '../lib/format';
import { SIGN_IN_METHOD, SIGN_IN_RESULT, deviceOf } from '../lib/signIns';
import { cx } from '../lib/design-tokens';

interface SignIn { id: string; userId: string | null; email: string; fullName: string | null; at: string; ip: string | null; userAgent: string | null; result: string; method: string }
interface Page { data: SignIn[]; total: number; page: number; pageSize: number; notMigrated?: boolean }

const COLS = 'grid-cols-[150px_minmax(170px,1.4fr)_130px_minmax(170px,1.3fr)_minmax(150px,1fr)_120px]';
const RESULT_OPTIONS = Object.entries(SIGN_IN_RESULT).map(([value, r]) => ({ value, label: r.label }));

/** Users and roles > Sign-ins: every sign-in attempt, newest first, for management (functions/api/users/sign-ins.ts). */
export default function UsersSignIns({ people }: { people: { id: string; fullName: string }[] }) {
  const [user, setUser] = useState('');
  const [result, setResult] = useState('');
  const [from, setFrom] = useState(todayMyt(-29));
  const [to, setTo] = useState(todayMyt());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const phone = usePhone();
  const q = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (user) q.set('user', user);
  if (result) q.set('result', result);
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  const { data, loading, error, reload } = useApi<Page>(`/users/sign-ins?${q}`);
  const filter = (fn: () => void) => { fn(); setPage(1); };
  const dateInput = 'h-9 box-border px-2.5 border border-solid border-line rounded-control bg-card font-sans text-copy text-ink min-w-0';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2 flex-wrap items-center">
        <FilterSelect label="Person" value={user} onChange={v => filter(() => setUser(v))} all="Everyone" className="w-full sm:w-[220px]"
          options={people.map(p => ({ value: p.id, label: p.fullName }))} />
        <FilterSelect label="Result" value={result} onChange={v => filter(() => setResult(v))} all="Every result" className="w-full sm:w-[170px]" options={RESULT_OPTIONS} />
        <label className="flex items-center gap-2 text-meta text-muted-ink flex-1 sm:flex-none min-w-0">
          From <input type="date" value={from} max={to || undefined} onChange={e => filter(() => setFrom(e.target.value))} className={cx(dateInput, 'flex-1')} aria-label="From date" />
        </label>
        <label className="flex items-center gap-2 text-meta text-muted-ink flex-1 sm:flex-none min-w-0">
          to <input type="date" value={to} min={from || undefined} onChange={e => filter(() => setTo(e.target.value))} className={cx(dateInput, 'flex-1')} aria-label="To date" />
        </label>
      </div>

      {error && <StaleBanner message={`Showing the last list we have. ${error}`} onRetry={reload} />}

      <ListCard busy={loading && !!data}>
        {!phone && (
          <div className={cx('grid gap-3.5 py-2.5 px-5', COLS, STICKY_HEAD)}>
            <div>When</div><div>Person</div><div>Result</div><div>How</div><div>Device</div><div>IP address</div>
          </div>
        )}
        {!data && loading ? <TableSkeleton rows={8} cols={phone ? 2 : 6} />
          : data?.notMigrated ? <EmptyState title="Sign-ins are not being recorded yet" body="The database update for the sign-in record (migration 0098) has not been applied." bare />
          : !data?.data.length ? <EmptyState kind="filtered" title="No sign-ins match" body="Try a wider date range or another person." bare />
          : data.data.map(s => {
            const r = SIGN_IN_RESULT[s.result] ?? { label: s.result, tone: 'neutral' as const };
            const who = s.fullName ?? s.email;
            return phone ? (
              <div key={s.id} className="flex flex-col gap-1 py-3 px-4 [border-bottom:1px_solid_var(--color-line-soft)]">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-copy font-medium truncate" title={who}>{who}</span>
                  <Badge tone={r.tone} label={r.label} size="sm" />
                </div>
                <span className="text-meta text-muted-ink tabular-nums">{dateTime(s.at)}</span>
                <span className="text-meta text-muted-ink truncate">{SIGN_IN_METHOD[s.method] ?? s.method} · {deviceOf(s.userAgent)}{s.ip ? ` · ${s.ip}` : ''}</span>
              </div>
            ) : (
              <div key={s.id} className={cx('grid gap-3.5 items-center min-h-[46px] py-2 px-5 [border-bottom:1px_solid_var(--color-line-soft)]', COLS)}>
                <span className="text-copy tabular-nums whitespace-nowrap">{dateTime(s.at)}</span>
                <span className="flex flex-col gap-px min-w-0">
                  <span className="text-copy font-medium truncate" title={who}>{who}</span>
                  {s.fullName && <span className="text-caption text-muted-ink truncate" title={s.email}>{s.email}</span>}
                </span>
                <span><Badge tone={r.tone} label={r.label} size="sm" /></span>
                <span className="text-copy text-muted-ink truncate">{SIGN_IN_METHOD[s.method] ?? s.method}</span>
                <span className="text-copy text-muted-ink truncate" title={s.userAgent ?? undefined}>{deviceOf(s.userAgent)}</span>
                <span className="text-copy text-muted-ink truncate tabular-nums">{s.ip ?? '—'}</span>
              </div>
            );
          })}
        {!!data?.total && (
          <PageControls page={page} pageSize={pageSize} total={data.total} noun="sign-ins" className="[border-top:1px_solid_var(--color-line)] bg-page"
            onPage={setPage} onSize={s => { setPageSize(s); setPage(1); }} />
        )}
      </ListCard>
    </div>
  );
}
