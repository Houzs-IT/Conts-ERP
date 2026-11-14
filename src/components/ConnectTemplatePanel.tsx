import { useEffect, useMemo, useState } from 'react';
import { Button } from './Button';
import { Field } from './Field';
import { Select } from './Select';
import Icon from './Icon';
import { useToast } from './Toast';
import { api, errorMessage } from '../lib/api';
import { deliveryToast } from '../lib/bookingStatus';
import { cx } from '../lib/design-tokens';

/** Human labels for the Connect contact-field keys, in the order they are shown. */
const FIELD_LABELS: Record<string, string> = {
  unit_no: 'Unit', mailbox: 'Mailbox', mailbox_no: 'Mailbox no.', mailbox_passcode: 'Mailbox passcode',
  maindoor: 'Main door', maindoor2: 'Second access', wifi: 'Wi-Fi password', wifi_username: 'Wi-Fi name',
  checkin_date: 'Check-in', checkout_date: 'Checkout',
};

interface Preview {
  configured: boolean;
  reservationId: string;
  name: string;
  phone: string;
  attributes: Record<string, string>;
  missing: string[];
  fields: string[];
  automations: string[];
}

/**
 * "Send a WhatsApp template" — the Houzs Connect send, embedded in both guest-message modals
 * (Guests page and Reservations page). Fetches the filled template variables for the stay (codes
 * come back masked), lets the operator pick/enter the automation, and sends. It routes to WhatsApp
 * by the guest's phone for every channel, so OTA guests get the template too. Inert until Connect is
 * configured: when it isn't, the preview says so and the send button is disabled.
 */
export function ConnectTemplatePanel({ reservationId, guestId, guestName, onSent }: {
  reservationId?: string; guestId?: string; guestName: string; onSent?: () => void;
}) {
  const toast = useToast();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [automation, setAutomation] = useState('');
  const [busy, setBusy] = useState(false);

  const query = useMemo(() => (reservationId ? { reservationId } : guestId ? { guestId } : null), [reservationId, guestId]);

  useEffect(() => {
    if (!query) return;
    let live = true;
    setPreview(null); setError(null);
    api.get<Preview>('/connect/preview', query)
      .then(p => { if (live) setPreview(p); })
      .catch(e => { if (live) setError(errorMessage(e, 'The template details could not be loaded.')); });
    return () => { live = false; };
  }, [query]);

  async function send() {
    const name = automation.trim();
    if (!name || !query) return;
    setBusy(true);
    try {
      const r = await api.post<{ delivery?: string; reason?: string }>('/connect/send', { ...query, automation: name });
      toast(deliveryToast(r?.delivery, guestName || 'the guest', r?.reason));
      if (r?.delivery === 'sent') onSent?.();
    } catch (e) {
      toast({ tone: 'critical', title: 'Template was not sent.', body: errorMessage(e, 'Try again in a moment.') });
    }
    setBusy(false);
  }

  const rowClass = 'flex items-baseline justify-between gap-3 py-[3px]';
  const keyClass = 'text-meta text-muted-ink shrink-0';
  const valClass = 'text-meta text-ink text-right break-words';

  return (
    <div className="mt-1 pt-[14px] [border-top:1px_solid_var(--color-line-soft)] flex flex-col gap-[10px]">
      <div className="flex items-center gap-2">
        <Icon name="MessageSquare" size="sm" color="var(--color-muted-ink)" />
        <span className="text-meta font-medium text-ink">Or send a WhatsApp template</span>
      </div>
      <p className="m-0 text-meta text-muted-ink">
        A Meta-approved template through Houzs Connect — works outside the 24-hour window, and goes to the guest's WhatsApp on any channel.
      </p>

      {error && <p role="alert" className="m-0 text-meta text-danger">{error}</p>}

      {!error && !preview && <p className="m-0 text-meta text-faint">Loading the template details…</p>}

      {preview && (
        <>
          {!preview.configured && (
            <div className="py-[9px] px-[11px] rounded-control bg-page border border-solid border-line text-meta text-muted-ink">
              Houzs Connect isn't connected yet, so templates can't be sent. The details below are a preview of what will be sent once IT adds the Connect key.
            </div>
          )}

          <div className="py-[10px] px-[12px] rounded-control bg-page border border-solid border-line flex flex-col">
            <div className={rowClass}><span className={keyClass}>Name</span><span className={valClass}>{preview.name || '—'}</span></div>
            <div className={rowClass}><span className={keyClass}>WhatsApp</span><span className={valClass}>{preview.phone || <span className="text-danger">no phone on file</span>}</span></div>
            {preview.fields.map(k => (
              <div key={k} className={rowClass}>
                <span className={keyClass}>{FIELD_LABELS[k] ?? k}</span>
                <span className={cx(valClass, !preview.attributes[k] && 'text-faint')}>{preview.attributes[k] || '—'}</span>
              </div>
            ))}
          </div>
          <p className="m-0 text-meta text-faint">Door codes and Wi-Fi passwords are shown as •••• here; the real values are sent only to the guest.</p>

          <div className="flex flex-col gap-[6px]">
            {preview.automations.length > 0 ? (
              <Select label="Template" showLabel size="md" value={automation} onChange={setAutomation}
                placeholder="Choose a template…" options={preview.automations.map(a => ({ value: a, label: a }))} />
            ) : (
              <Field label="Template (automation name)" value={automation} onChange={e => setAutomation(e.target.value)}
                placeholder="e.g. Check-in Instructions" help="The exact Houzs Connect automation name to fire." />
            )}
          </div>

          <div className="flex justify-end">
            <Button type="button" size="sm" variant="primary" icon={<Icon name="Send" size="sm" />}
              loading={busy} disabled={!automation.trim() || !preview.configured || !preview.phone}
              disabledReason={!preview.configured ? 'Houzs Connect is not connected yet.' : !preview.phone ? 'This guest has no phone number on file.' : 'Choose a template first.'}
              onClick={send}>Send template</Button>
          </div>
        </>
      )}
    </div>
  );
}
