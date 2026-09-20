import { useState } from 'react';
import { color, radius, text } from '../theme';
import { Card } from '../components/Card';
import PageHeader from '../components/PageHeader';
import ChannelMark from '../components/ChannelMark';
import { StaleBanner, TableSkeleton } from '../components/DataState';
import { useApi } from '../lib/useApi';
import type { BookingChannel } from '../lib/types';

interface Guest {
  id: string; fullName: string; email: string | null; phone: string | null;
  stays: number; lastStay: string | null; lastUnit: string | null; lastChannel: BookingChannel | null;
}
interface Payload { data: Guest[]; total: number; generatedAt: string }

const FALLBACK: Payload = {
  total: 4, generatedAt: '',
  data: [
    { id: 'g1', fullName: 'Nadia Abdullah', email: 'nadia@example.com', phone: '+60 12-111 0001', stays: 3, lastStay: '2026-09-16', lastUnit: '#A-12-03', lastChannel: 'airbnb' },
    { id: 'g2', fullName: 'Aaron Lee', email: 'aaron@example.com', phone: '+60 12-111 0002', stays: 2, lastStay: '2026-09-20', lastUnit: '#A-12-03', lastChannel: 'direct' },
    { id: 'g3', fullName: 'Priya Sundaram', email: 'priya@example.com', phone: '+65 8111 0003', stays: 1, lastStay: '2026-09-23', lastUnit: '#B-08-11', lastChannel: 'booking_com' },
    { id: 'g4', fullName: 'Chen Yu', email: 'chen@example.com', phone: '+86 131 1100 04', stays: 1, lastStay: '2026-09-16', lastUnit: '#2207', lastChannel: 'agoda' },
  ],
};

const COLS = 'minmax(170px,1.6fr) minmax(190px,1.7fr) minmax(130px,1.1fr) minmax(90px,0.8fr) minmax(110px,0.9fr)';

export default function GuestsPage() {
  const [q, setQ] = useState('');
  const { data, loading, error, reload } = useApi<Payload>(
    q ? `/guests?q=${encodeURIComponent(q)}` : '/guests', FALLBACK);
  const rows = data?.data ?? [];

  return (
    <>
      <PageHeader title="Guests" sub={`${data?.total ?? rows.length} guests · a guest with no stay has no record`} />

      {error && <StaleBanner message={`Showing the last list we have. ${error}`} onRetry={reload} />}

      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name or email"
        aria-label="Search guests"
        style={{ maxWidth: 340, height: 38, padding: '0 14px', fontSize: 13, font: 'inherit', border: `1px solid ${color.border}`, borderRadius: radius.control, outline: 'none' }} />

      <Card>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 860 }}>
            <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, padding: '9px 22px', background: color.muted, borderBottom: `1px solid ${color.border}`, fontSize: text.small, fontWeight: 600, color: color.textMuted }}>
              <div>Guest</div><div>Contact</div><div>Last unit</div><div style={{ textAlign: 'right' }}>Stays</div><div>Channel</div>
            </div>
            {loading && rows.length === 0 ? <TableSkeleton rows={4} cols={5} /> : rows.length === 0 ? (
              <div style={{ padding: '28px 22px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontSize: 13 }}>No guests match “{q}”.</span>
                <button onClick={() => setQ('')} style={{ alignSelf: 'flex-start', fontSize: text.small, fontWeight: 600, color: color.goldInk, background: 'none', border: 'none', cursor: 'pointer', font: 'inherit' }}>Clear search</button>
              </div>
            ) : rows.map(g => (
              <div key={g.id} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, alignItems: 'center', minHeight: 52, padding: '9px 22px', borderBottom: `1px solid ${color.borderMuted}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <span style={{ width: 30, height: 30, flex: 'none', borderRadius: 999, background: color.muted, color: color.textMuted, display: 'grid', placeItems: 'center', fontSize: text.micro, fontWeight: 600 }}>
                    {g.fullName.split(' ').map(n => n[0]).slice(0, 2).join('')}
                  </span>
                  <span style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.fullName}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.email ?? '\u2014'}</span>
                  <span style={{ fontSize: 11.5, color: color.textMuted }}>{g.phone ?? '\u2014'}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13 }}>{g.lastUnit ?? '\u2014'}</span>
                  <span style={{ fontSize: 11.5, color: color.textMuted }}>{g.lastStay ?? ''}</span>
                </div>
                <span style={{ fontSize: 13, textAlign: 'right', fontWeight: 500 }}>{g.stays}</span>
                <div>{g.lastChannel && <ChannelMark ch={g.lastChannel} size={20} />}</div>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </>
  );
}
