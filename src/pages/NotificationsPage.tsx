import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { Button } from '../components/Button';
import { ListPager } from '../components/ListPager';
import { Segmented } from '../components/Metric';
import { SkeletonRows } from '../components/States';
import { NoticeRow, announceNoticesChanged, type Notice, type NoticePage } from '../components/NotificationBell';
import { api, errorMessage } from '../lib/api';
import { plural } from '../lib/format';

const PAGE_SIZE = 25;

/** Every notice the signed-in person has had, newest first: the bell's full history. */
export default function NotificationsPage() {
  const navigate = useNavigate();
  const [show, setShow] = useState<'all' | 'unread'>('all');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<NoticePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => { setPage(1); }, [show]);
  useEffect(() => {
    let live = true;
    setLoading(true);
    api.get<NoticePage>('/notifications', { page, pageSize: PAGE_SIZE, unread: show === 'unread' ? 1 : undefined })
      .then(r => { if (live) { setData(r); setError(null); } })
      .catch(e => { if (live) setError(errorMessage(e, 'Your notifications could not load. Check your connection and try again.')); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [page, show, nonce]);

  const open = (n: Notice) => {
    if (!n.readAt) {
      setData(d => d && { ...d, unread: Math.max(0, d.unread - 1), data: d.data.map(x => x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x) });
      api.patch('/notifications', { ids: [n.id] }).then(announceNoticesChanged).catch(() => setNonce(x => x + 1));
    }
    if (n.link) navigate(n.link);
  };
  const markAll = () => {
    setData(d => d && { ...d, unread: 0, data: d.data.map(x => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })) });
    api.patch('/notifications', { all: true }).then(() => { announceNoticesChanged(); if (show === 'unread') setNonce(x => x + 1); }).catch(() => setNonce(x => x + 1));
  };

  const unread = data?.unread ?? 0;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Notifications"
        sub={data ? (unread ? `${plural(unread, 'unread notice')}` : 'Everything is read.') : ' '}
        primary={<Button onClick={markAll} disabled={!unread} disabledReason="Nothing unread">Mark all read</Button>} />
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Segmented label="Show" value={show} onChange={setShow} options={[{ key: 'all', label: 'All' }, { key: 'unread', label: unread ? `Unread (${unread})` : 'Unread' }]} />
        <span className="text-meta text-muted-ink">Kept for you only. Opening one takes you to the record and marks it read.</span>
      </div>
      <section aria-label="Notifications" className="bg-card border border-solid border-line rounded-card overflow-hidden flex-none">
        {loading && !data && <SkeletonRows rows={6} height={56} />}
        {error && <div className="py-4 px-5 text-copy text-danger" role="alert">{error}</div>}
        {data && !error && data.data.length === 0 && (
          <div className="py-8 px-5 text-copy text-muted-ink text-center">
            {show === 'unread' ? 'Nothing unread.' : 'No notifications yet. New bookings, cancellations, cleans and repairs that concern you appear here.'}
          </div>
        )}
        {data && data.data.length > 0 && (
          <div className={loading ? 'opacity-60' : undefined}>
            {data.data.map(n => <NoticeRow key={n.id} n={n} onOpen={open} wide />)}
          </div>
        )}
        {data && <ListPager page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} busy={loading} noun="notices" />}
      </section>
    </div>
  );
}
