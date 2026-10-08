import { useState } from 'react';
import { color } from '../../theme';
import { Card } from '../../components/Card';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Dialog, type DialogSpec } from '../../components/Dialog';
import Icon from '../../components/Icon';
import { StaleBanner, TableSkeleton } from '../../components/DataState';
import { useApi } from '../../lib/useApi';
import { api, ApiFailure, notifyFailure } from '../../lib/api';
import { useToast } from '../../components/Toast';
import { useSession } from '../../lib/session';
import { date, todayMyt } from '../../lib/format';
import { CentreModal, Labeled, Select } from './shared';

interface Credential {
  id: string; kind: string; label: string;
  /** Masked by the list endpoint, e.g. "••••17#". Empty = no code (or a field role). */
  secret: string;
  /** Dev sample only, so a reveal shows something with no backend. Never sent by the API. */
  fullSecret?: string;
  instruction: string; rotatesAfterStay: boolean; updatedAt: string;
  lastRevealedBy?: string | null; lastRevealedAt?: string | null;
}
interface Payload { data: Credential[]; generatedAt: string }

const KIND_LABEL: Record<string, string> = {
  smart_lock: 'Smart lock', key_box: 'Key box', guard_desk: 'Guard desk', lift_card: 'Lift card', wifi: 'Wi-Fi',
};
const KINDS = Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }));
/** Who may reveal, and so add, change or remove, a code: CREDENTIAL_ROLES in functions/_lib/credentials.ts. */
const EDIT_ROLES = ['management', 'operations_manager'];

const mask = (clear: string) => clear ? '•'.repeat(Math.max(2, clear.length - 3)) + clear.slice(-3) : '';
const FALLBACK: Payload = {
  generatedAt: '',
  data: [
    { id: 'a1', kind: 'smart_lock', label: 'Main door', fullSecret: '4417#', secret: mask('4417#'), instruction: 'Smart lock 4417#. Lobby via the guard — say The Conts.', rotatesAfterStay: true, updatedAt: '2026-09-13', lastRevealedBy: 'Nurul (Operations)', lastRevealedAt: '2026-09-18' },
    { id: 'a1w', kind: 'wifi', label: 'Guest Wi-Fi — VistaJaya_Guest', fullSecret: 'stayhappy88', secret: mask('stayhappy88'), instruction: 'Wi-Fi VistaJaya_Guest, password on the fridge card.', rotatesAfterStay: false, updatedAt: '2026-08-02', lastRevealedBy: null, lastRevealedAt: null },
    { id: 'a4', kind: 'guard_desk', label: 'Site office key', secret: '', instruction: 'Collect the key from the site office before 14:00.', rotatesAfterStay: false, updatedAt: '2026-09-04', lastRevealedBy: null, lastRevealedAt: null },
  ],
};

function safeDate(iso: string): string {
  if (!iso) return '—';
  const d = date(iso);
  return d === 'Invalid Date' ? iso : d;
}

function IconAction({ name, label, onClick }: { name: string; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
      className="inline-flex items-center justify-center w-[30px] h-[30px] flex-none rounded-control border border-solid border-line bg-card cursor-pointer p-0">
      <Icon name={name} size="sm" color={color.textMuted} />
    </button>
  );
}

export default function AccessTab({ unitId, unitLabel }: { unitId: string; unitLabel: string }) {
  const { data, loading, error, reload } = useApi<Payload>(`/access-credentials?unitId=${encodeURIComponent(unitId)}`, FALLBACK);
  const { user } = useSession();
  const toast = useToast();
  const canEdit = !!user && EDIT_ROLES.includes(user.role);

  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [localReveal, setLocalReveal] = useState<Record<string, { by: string; at: string }>>({});
  const [editing, setEditing] = useState<Credential | 'new' | null>(null);
  const [confirm, setConfirm] = useState<DialogSpec | null>(null);
  const [busy, setBusy] = useState(false);

  const rows = data?.data ?? [];

  /** A reveal is a read, but an audited one: the endpoint writes access.reveal to the audit log. */
  async function reveal(c: Credential) {
    let clear = import.meta.env.DEV ? (c.fullSecret ?? '') : '';
    try {
      const res = await api.get<{ secret?: string }>(`/access-credentials/${c.id}`, { reveal: true });
      if (res?.secret) clear = res.secret;
    } catch (e) {
      if (!clear) {
        toast({ tone: 'critical', title: 'Could not reveal the code.', body: e instanceof ApiFailure ? e.message : 'Try again in a moment.' });
        return;
      }
    }
    setRevealed(r => ({ ...r, [c.id]: clear }));
    setLocalReveal(m => ({ ...m, [c.id]: { by: user?.fullName ?? 'You', at: todayMyt() } }));
    toast({ tone: 'neutral', title: 'Access code revealed.', body: 'This was recorded in the audit log.' });
  }
  const remask = (c: Credential) => setRevealed(r => { const n = { ...r }; delete n[c.id]; return n; });
  async function copy(c: Credential) {
    const clear = revealed[c.id];
    if (!clear) return;
    try {
      await navigator.clipboard.writeText(clear);
      toast({ tone: 'neutral', title: 'Copied to clipboard.', body: 'Handle it with the same care as the code itself.' });
    } catch {
      toast({ tone: 'critical', title: 'Could not copy automatically.', body: 'Select the code and copy it by hand.' });
    }
  }

  async function save(body: Record<string, unknown>, existing: Credential | null) {
    try {
      if (existing) await api.patch(`/access-credentials/${existing.id}`, body);
      else await api.post('/access-credentials', { ...body, unitId });
      if (existing) remask(existing);
      setEditing(null);
      toast({ tone: 'success', title: existing ? 'Access updated.' : 'Access added.', body: `${String(body.label ?? existing?.label ?? '')} on ${unitLabel}. The change is in the audit log; the code is not.` });
      reload();
    } catch (e) { notifyFailure(e); }
  }
  function askDelete(c: Credential) {
    setConfirm({
      title: `Remove ${c.label}?`,
      body: `${KIND_LABEL[c.kind] ?? c.kind} on ${unitLabel}. Guests and cleaners stop getting its instruction straight away.`,
      meta: 'This cannot be undone. Add it again if it was removed by mistake.',
      confirmLabel: 'Remove', busyLabel: 'Removing…', danger: true,
      onConfirm: async () => {
        setBusy(true);
        try {
          await api.del(`/access-credentials/${c.id}`);
          toast({ tone: 'success', title: 'Access removed.', body: `${c.label} on ${unitLabel}.` });
          setConfirm(null); remask(c); reload();
        } catch (e) { notifyFailure(e); }
        finally { setBusy(false); }
      },
    });
  }

  return (
    <>
      {error && <StaleBanner message={`Showing the last list we have. ${error}`} onRetry={reload} />}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3 py-4 px-5 [border-bottom:1px_solid_var(--color-line-soft)]">
          <div className="flex flex-col gap-1 min-w-0">
            <span className="text-[16px] font-semibold">Access and keys</span>
            <span className="text-[12px] text-muted-ink">Codes are masked. Revealing one is recorded in the audit trail.</span>
          </div>
          {canEdit && <Button size="sm" variant="secondary" icon={<Icon name="Plus" size="sm" />} onClick={() => setEditing('new')}>Add access</Button>}
        </div>

        {loading && rows.length === 0 ? <TableSkeleton rows={3} cols={3} /> : rows.length === 0 ? (
          <div className="py-6 px-5 text-[13px] text-muted-ink">No access recorded for this unit yet.{canEdit ? ' Add the door code, key box or Wi-Fi so cleaners and guests get the right instruction.' : ''}</div>
        ) : rows.map(r => {
          const isRevealed = revealed[r.id] != null;
          const last = localReveal[r.id] ?? (r.lastRevealedBy ? { by: r.lastRevealedBy, at: r.lastRevealedAt ?? '' } : null);
          return (
            <div key={r.id} className="grid grid-cols-1 md:grid-cols-[minmax(140px,1fr)_minmax(200px,1.2fr)_minmax(180px,1.5fr)_auto] gap-x-[14px] gap-y-2 items-start md:items-center py-3 px-5 [border-bottom:1px_solid_var(--color-line-soft)]">
              <div className="flex flex-col gap-[3px] min-w-0">
                <span className="text-[13.5px] font-medium">{KIND_LABEL[r.kind] ?? r.kind}</span>
                <span className="text-[11.5px] text-muted-ink [overflow-wrap:anywhere]">{r.label}</span>
                {r.rotatesAfterStay && <span><Badge tone="info" label="Rotates after each stay" size="sm" /></span>}
              </div>
              <div className="min-w-0">
                {!r.secret ? (
                  <span className="text-[13px] text-muted-ink">No code</span>
                ) : isRevealed ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[13.5px] font-medium [overflow-wrap:anywhere]">{revealed[r.id]}</span>
                    <IconAction name="EyeOff" label={`Mask the code for ${r.label}`} onClick={() => remask(r)} />
                    <IconAction name="Copy" label={`Copy the code for ${r.label}`} onClick={() => copy(r)} />
                  </div>
                ) : (
                  <button type="button" onClick={() => reveal(r)} aria-label={`Reveal the code for ${r.label}`}
                    className="inline-flex items-center gap-[7px] h-[32px] px-[11px] py-0 rounded-control border border-solid border-line bg-card cursor-pointer [font:inherit] max-w-full">
                    <Icon name="Eye" size="sm" color={color.textMuted} />
                    <span className="font-mono">{r.secret}</span>
                    <span className="text-muted-ink font-medium">Reveal</span>
                  </button>
                )}
                <div className="text-[11px] text-faint mt-1">
                  Changed {safeDate(r.updatedAt)} · {last ? `last shown to ${last.by}${last.at ? ` ${safeDate(last.at)}` : ''}` : 'never revealed'}
                </div>
              </div>
              <span className="text-[12.5px] text-muted-ink text-pretty">{r.instruction}</span>
              {canEdit ? (
                <div className="flex gap-1.5">
                  <IconAction name="Pencil" label={`Edit ${r.label}`} onClick={() => setEditing(r)} />
                  <IconAction name="Trash2" label={`Remove ${r.label}`} onClick={() => askDelete(r)} />
                </div>
              ) : <span />}
            </div>
          );
        })}
      </Card>

      {editing && <CredentialModal initial={editing === 'new' ? null : editing} unitLabel={unitLabel} onClose={() => setEditing(null)} onSubmit={save} />}
      <Dialog spec={confirm} busy={busy} onClose={() => setConfirm(null)} />
    </>
  );
}

function CredentialModal({ initial, unitLabel, onClose, onSubmit }: { initial: Credential | null; unitLabel: string; onClose: () => void; onSubmit: (body: Record<string, unknown>, existing: Credential | null) => Promise<void> }) {
  const [kind, setKind] = useState(initial?.kind ?? 'smart_lock');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [secret, setSecret] = useState('');
  const [removeCode, setRemoveCode] = useState(false);
  const [instruction, setInstruction] = useState(initial?.instruction ?? '');
  const [rotates, setRotates] = useState(initial?.rotatesAfterStay ?? false);
  const [busy, setBusy] = useState(false);
  const ok = label.trim() !== '' && instruction.trim() !== '';
  const hadCode = !!initial?.secret;

  async function submit() {
    const body: Record<string, unknown> = { kind, label: label.trim(), instruction: instruction.trim(), rotatesAfterStay: rotates };
    // Only a typed or removed code is sent: a blank field on an edit keeps the stored one.
    if (!initial) body.secret = secret.trim();
    else if (removeCode) body.secret = '';
    else if (secret.trim()) body.secret = secret.trim();
    setBusy(true);
    try { await onSubmit(body, initial); } finally { setBusy(false); }
  }

  return (
    <CentreModal title={initial ? `Edit ${initial.label}` : 'Add access'} sub={`${unitLabel}. Codes are shown masked, and a code is never written to the audit log.`} onClose={onClose}
      footer={<><Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button><Button size="sm" variant="primary" loading={busy} disabled={!ok} disabledReason="Fill the name and the instruction" onClick={() => void submit()}>{initial ? 'Save' : 'Add access'}</Button></>}>
      <Labeled label="Type" hint="DROPDOWN"><Select label="Type" value={kind} onChange={setKind} options={KINDS} /></Labeled>
      <Field label="Name" placeholder="e.g. Main door" value={label} onChange={e => setLabel(e.target.value)} />
      <Field label={initial && hadCode ? 'New code' : 'Code'} placeholder={initial && hadCode ? 'Leave blank to keep the current code' : 'e.g. 4417#  (leave blank if there is none)'}
        value={secret} autoComplete="off" spellCheck={false} disabled={removeCode} onChange={e => setSecret(e.target.value)} />
      {initial && hadCode && (
        <label className="flex items-center gap-2 text-[13px] -mt-1">
          <input type="checkbox" checked={removeCode} onChange={e => { setRemoveCode(e.target.checked); if (e.target.checked) setSecret(''); }} />
          Remove the code (for example a guard desk that needs none)
        </label>
      )}
      <div className="flex flex-col gap-[7px]">
        <label htmlFor="credential-instruction" className="text-[length:var(--text-small)] font-medium text-muted-ink">Instruction given to guests and cleaners</label>
        <textarea id="credential-instruction" rows={3} value={instruction} onChange={e => setInstruction(e.target.value)} placeholder="e.g. Smart lock on the main door. Lobby via the guard — say The Conts."
          className="field-input w-full box-border min-h-[84px] py-2! resize-y" />
      </div>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={rotates} onChange={e => setRotates(e.target.checked)} />
        The code changes after each stay
      </label>
    </CentreModal>
  );
}
