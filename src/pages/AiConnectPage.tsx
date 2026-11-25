import { useEffect, useState } from 'react';
import { Button } from '../components/Button';
import Icon from '../components/Icon';
import { api, errorMessage } from '../lib/api';

interface Consent { app: string; clientName: string; redirectHost: string; user: { name: string; email: string }; allowed: boolean }

/**
 * /ai-connect?request=... : the "Allow?" screen Claude or ChatGPT sends a person to when they add the Conts ERP AI
 * Connector. Shown after sign-in, without the app's menu, on desktop and phone. The server decides everything
 * (functions/api/ai-connector/consent/[id].ts); this shows the question and sends the answer, then returns the browser
 * to the AI app.
 */
export default function AiConnectPage() {
  const id = new URLSearchParams(window.location.search).get('request') ?? '';
  const [data, setData] = useState<Consent | null>(null);
  const [error, setError] = useState<string | null>(id ? null : 'This link is incomplete. Start again from the AI app.');
  const [busy, setBusy] = useState(false);
  const [requested, setRequested] = useState(false);

  useEffect(() => {
    if (!id) return;
    let live = true;
    api.get<Consent>(`/ai-connector/consent/${encodeURIComponent(id)}`)
      .then(d => { if (live) setData(d); })
      .catch(e => { if (live) setError(errorMessage(e, 'This connect request could not load. Start again from the AI app.')); });
    return () => { live = false; };
  }, [id]);

  const decide = async (decision: 'allow' | 'deny') => {
    setBusy(true);
    try {
      const r = await api.post<{ redirect: string }>(`/ai-connector/consent/${encodeURIComponent(id)}`, { decision });
      window.location.assign(r.redirect);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const request = async () => {
    setBusy(true);
    try {
      await api.post('/ai-connector/me/request', { reason: `Connecting ${data?.app ?? 'an AI app'}` });
      setRequested(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const point = (icon: string, strong: string, rest: string) => (
    <li className="flex gap-2.5 items-start">
      <span className="mt-0.5 text-success"><Icon name={icon} size="sm" /></span>
      <span><b className="text-ink">{strong}</b> {rest}</span>
    </li>
  );

  return (
    <main className="min-h-screen bg-page box-border flex items-start justify-center px-4 py-10 sm:py-16">
      <div className="w-full max-w-[480px] bg-card border border-solid border-line rounded-card p-5 sm:p-8 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-control bg-primary text-on-primary flex items-center justify-center flex-none"><Icon name="Bot" /></span>
          <span className="text-copy font-semibold text-ink">The Conts ERP · AI Connector</span>
        </div>

        {error && <div role="alert" className="rounded-control border border-solid border-danger-line bg-danger-bg text-danger text-copy p-3">{error}</div>}
        {!error && !data && <p className="m-0 text-copy text-muted-ink">Loading…</p>}

        {data && !data.allowed && (
          <>
            <h1 className="m-0 text-[18px] font-semibold text-ink">The AI Connector is not turned on for your account</h1>
            <p className="m-0 text-copy text-muted-ink">Signed in as <b className="text-ink">{data.user.name}</b>. Ask for access; you can connect once management approves it.</p>
            {requested
              ? <p className="m-0 rounded-control bg-success-bg text-copy text-ink p-3">Request sent. Try connecting again from the AI app after it is approved.</p>
              : <Button variant="primary" size="touch" onClick={() => void request()} loading={busy} disabled={busy} disabledReason="Sending">Request access</Button>}
          </>
        )}

        {data?.allowed && (
          <>
            <h1 className="m-0 text-[18px] font-semibold text-ink">{data.app} wants to read The Conts ERP as you</h1>
            <p className="m-0 text-copy text-muted-ink">Signed in as <b className="text-ink">{data.user.name}</b></p>
            <ul className="m-0 p-0 list-none flex flex-col gap-3 text-copy text-muted-ink">
              {point('Check', 'Read only.', 'It can look things up. It cannot create, change or delete anything.')}
              {point('Check', 'Only what you can see.', 'The same screens and figures your own login shows you, nothing more.')}
              {point('Check', 'Recorded.', 'Management can see what was looked up and when, and can disconnect it.')}
              {point('Info', 'Sent to the AI app.', `What it reads is sent to ${data.app} to answer you. Stop any time on System > AI Connector.`)}
            </ul>
            <div className="flex flex-wrap gap-3">
              <Button variant="primary" size="touch" className="flex-1" onClick={() => void decide('allow')} disabled={busy} disabledReason="Sending">Allow</Button>
              <Button variant="secondary" size="touch" className="flex-1" onClick={() => void decide('deny')} disabled={busy} disabledReason="Sending">Cancel</Button>
            </div>
            {data.redirectHost && <p className="m-0 text-meta text-muted-ink">You will return to {data.redirectHost}.</p>}
          </>
        )}
      </div>
    </main>
  );
}
