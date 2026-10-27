import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';
import { useToast } from '../../components/Toast';
import { api } from '../../lib/api';

/** Who gets the sign-in, and which roster holds them (POST {rosterApi}/{id}/access). */
export interface AccessTarget { id: string; name: string; employeeId: string | null; rosterApi: string; jobs: string }

/** "Give app access" / "Reset PIN": the worker's employee ID (made on first access) and their first PIN, shown once. */
export function AccessModal({ target, given0, onClose, onDone }: {
  target: AccessTarget; given0?: { employeeId: string; pin: string }; onClose: () => void; onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // given0: the sign-in was just made by Add Employee, so the PIN is shown straight away.
  const [given, setGiven] = useState<{ employeeId: string; pin: string } | null>(given0 ?? null);
  const toast = useToast();
  const link = `${window.location.origin}/portal`;

  /** The sign-in as one message the manager pastes into WhatsApp or SMS. */
  async function copyMessage({ employeeId, pin }: { employeeId: string; pin: string }): Promise<void> {
    const text = `Hi ${target.name}, this is your sign-in for The Conts app.\n\n`
      + `1. On your phone, open ${link}\n2. Employee ID: ${employeeId}\n3. PIN: ${pin}\n\n`
      + 'The first time, it asks you to choose your own PIN.';
    try {
      await navigator.clipboard.writeText(text);
      toast({ tone: 'success', title: 'Copied.', body: `Paste it in a private message to ${target.name}.` });
    } catch {
      toast({ tone: 'warning', title: 'Could not copy. Give them the ID and PIN by hand.' });
    }
  }

  async function submit() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      setGiven(await api.post<{ employeeId: string; pin: string }>(`${target.rosterApi}/${target.id}/access`, {}));
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not give access. Try again in a moment.');
    } finally { setBusy(false); }
  }

  const title = given ? `Sign-in for ${target.name}` : target.employeeId ? `Reset PIN for ${target.name}` : `Give ${target.name} app access`;
  return (
    <Modal title={title} onClose={onClose}
      footer={given
        ? <>
            <Button size="sm" variant="secondary" onClick={() => void copyMessage(given)}>Copy message</Button>
            <Button size="sm" variant="primary" onClick={onClose}>Done</Button>
          </>
        : <>
            <Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button size="sm" variant="primary" loading={busy} onClick={() => void submit()}>{target.employeeId ? 'Reset PIN' : 'Give app access'}</Button>
          </>}>
      {given ? (
        <div className="flex flex-col gap-4 text-copy">
          <span>Give {target.name} these two. The PIN is shown only now.</span>
          <span className="flex gap-3 flex-wrap">
            <span className="flex flex-col gap-1">
              <span className="text-meta text-muted-ink">Employee ID</span>
              <span className="py-3 px-4 rounded-control bg-page border border-solid border-line text-[28px] font-semibold tabular-nums">{given.employeeId}</span>
            </span>
            <span className="flex flex-col gap-1">
              <span className="text-meta text-muted-ink">First PIN</span>
              <span className="py-3 px-4 rounded-control bg-page border border-solid border-line text-[28px] font-semibold tracking-[0.3em] tabular-nums">{given.pin}</span>
            </span>
          </span>
          <span className="text-meta text-muted-ink text-pretty">
            They open <span className="font-semibold text-ink">{link}</span> on their phone, type the number
            after EMP- and this PIN, and choose their own PIN the first time. Copy message puts all of this in one text to send them.
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <span className="text-meta text-muted-ink text-pretty">
            {target.employeeId
              ? `${target.name} keeps employee ID ${target.employeeId} and gets a new 6-digit PIN. Their old PIN stops working and they are signed out on every phone.`
              : `${target.name} gets the next employee ID (EMP-...) and a 6-digit PIN. In the field app they see only their own ${target.jobs}.`}
          </span>
          {error && <div role="alert" className="[border-left:2px_solid_var(--color-critical-line)] bg-critical-bg py-3 px-3.5 text-meta text-danger">{error}</div>}
        </div>
      )}
    </Modal>
  );
}
