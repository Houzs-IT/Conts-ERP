import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { StatusBadge } from '../components/StatusBadge';
import { DataTable, type Column } from '../components/DataTable';
import { FilterSelect } from './finance/listKit';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
import { fetchAllPages } from '../lib/export';
import { dateTime, todayMyt } from '../lib/format';
import { SIGN_IN_METHOD, SIGN_IN_RESULT, deviceOf } from '../lib/signIns';
import { cx } from '../lib/design-tokens';

interface SignIn { id: string; userId: string | null; email: string; fullName: string | null; at: string; ip: string | null; userAgent: string | null; result: string; method: string }
interface Page { data: SignIn[]; total: number; page: number; pageSize: number; notMigrated?: boolean }

const RESULT_OPTIONS = Object.entries(SIGN_IN_RESULT).map(([value, r]) => ({ value, label: r.label }));
const SIZES = [25, 50, 100];

/** Users and roles > Sign-ins: every sign-in attempt, newest first, for management (functions/api/users/sign-ins.ts). */
export default function UsersSignIns({ people }: { people: { id: string; fullName: string }[] }) {
  const [user, setUser] = useState('');
  const [result, setResult] = useState('');
  const [from, setFrom] = useState(todayMyt(-29));
  const [to, setTo] = useState(todayMyt());
  // The table keeps its page and size in the address under its own prefix (the page also has ?tab=).
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('si.page')) || 1);
  const pageSize = SIZES.includes(Number(params.get('si.size'))) ? Number(params.get('si.size')) : 25;
  const filters = new URLSearchParams();
  if (user) filters.set('user', user);
  if (result) filters.set('result', result);
  if (from) filters.set('from', from);
  if (to) filters.set('to', to);
  const { data, loading, error, reload } = useApi<Page>(`/users/sign-ins?${new URLSearchParams({ page: String(page), pageSize: String(pageSize), ...Object.fromEntries(filters) })}`);
  const filter = (fn: () => void) => { fn(); setParams(p => { const n = new URLSearchParams(p); n.delete('si.page'); return n; }, { replace: true }); };
  const dateInput = 'h-9 box-border px-2.5 border border-solid border-line rounded-control bg-card font-sans text-copy text-ink min-w-0';

  async function fetchAll(onProgress: (got: number, of: number) => void) {
    return (await fetchAllPages<SignIn>(async (p, n) => {
      const r = await api.get<Page>('/users/sign-ins', { ...Object.fromEntries(filters), page: p, pageSize: n });
      return { rows: r.data, total: r.total };
    }, { size: 100, onProgress })).rows;
  }

  const columns = useMemo<Column<SignIn>[]>(() => [
    { key: 'at', label: 'When', type: 'datetime', value: s => s.at, width: 150, hideable: false },
    { key: 'who', label: 'Person', value: s => s.fullName ?? s.email, width: 200, sub: s => (s.fullName ? s.email : null) },
    { key: 'email', label: 'Email', value: s => s.email, hidden: true, width: 200 },
    { key: 'result', label: 'Result', type: 'status', value: s => (SIGN_IN_RESULT[s.result]?.label ?? s.result),
      status: s => SIGN_IN_RESULT[s.result] ?? { label: s.result, tone: 'neutral' }, width: 130 },
    { key: 'how', label: 'How', value: s => SIGN_IN_METHOD[s.method] ?? s.method, width: 170 },
    { key: 'device', label: 'Device', value: s => deviceOf(s.userAgent), width: 160 },
    { key: 'ip', label: 'IP address', value: s => s.ip, width: 130 },
  ], []);

  return (
    <div className="flex flex-col gap-3">
      {data?.notMigrated && <p className="m-0 text-meta text-muted-ink">Sign-ins are not being recorded yet: the database update for the sign-in record (migration 0098) has not been applied.</p>}
      <DataTable<SignIn> id="users.signins" urlPrefix="si." columns={columns} rows={data ? data.data : null} rowKey={s => s.id}
        loading={loading} error={error} onRetry={reload} noun={['sign-in', 'sign-ins']} exportName="sign-ins"
        server={{ total: data?.total ?? 0, page: data?.page ?? page, pageSize: data?.pageSize ?? pageSize, sizes: SIZES, defaultPageSize: 25, fetchAll }}
        filtered={!!user || !!result} onClearFilters={() => filter(() => { setUser(''); setResult(''); })}
        empty={{ title: 'No sign-ins in these dates.', body: 'Try a wider date range or another person.', icon: 'LogIn' }}
        toolbar={<>
          <FilterSelect label="Person" value={user} onChange={v => filter(() => setUser(v))} all="Everyone" className="w-full sm:w-[200px]"
            options={people.map(p => ({ value: p.id, label: p.fullName }))} />
          <FilterSelect label="Result" value={result} onChange={v => filter(() => setResult(v))} all="Every result" className="w-full sm:w-[160px]" options={RESULT_OPTIONS} />
          <label className="flex items-center gap-2 text-meta text-muted-ink flex-1 sm:flex-none min-w-0">
            From <input type="date" value={from} max={to || undefined} onChange={e => filter(() => setFrom(e.target.value))} className={cx(dateInput, 'flex-1')} aria-label="From date" />
          </label>
          <label className="flex items-center gap-2 text-meta text-muted-ink flex-1 sm:flex-none min-w-0">
            to <input type="date" value={to} min={from || undefined} onChange={e => filter(() => setTo(e.target.value))} className={cx(dateInput, 'flex-1')} aria-label="To date" />
          </label>
        </>}
        renderCard={s => {
          const r = SIGN_IN_RESULT[s.result] ?? { label: s.result, tone: 'neutral' as const };
          const who = s.fullName ?? s.email;
          return (
            <span className="flex flex-col gap-1">
              <span className="flex items-center justify-between gap-2">
                <span className="text-copy font-medium truncate" title={who}>{who}</span>
                <StatusBadge tone={r.tone} label={r.label} size="sm" />
              </span>
              <span className="text-meta text-muted-ink tabular-nums">{dateTime(s.at)}</span>
              <span className="text-meta text-muted-ink truncate">{SIGN_IN_METHOD[s.method] ?? s.method} · {deviceOf(s.userAgent)}{s.ip ? ` · ${s.ip}` : ''}</span>
            </span>
          );
        }} />
    </div>
  );
}
