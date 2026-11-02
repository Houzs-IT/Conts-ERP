import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Menu } from '../../components/Select';
import Icon from '../../components/Icon';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { useApi } from '../../lib/useApi';
import { api, errorMessage, ApiFailure } from '../../lib/api';

export interface SavedReply { id: string; title: string; body: string; updatedAt: string; createdByName: string | null }

export function useSavedReplies() {
  return useApi<{ data: SavedReply[] }>('/messages/saved-replies');
}

/** The "Saved replies" button beside the reply box: pick one to put its text in the box, or manage the list. */
export function SavedRepliesMenu({ replies, onInsert, onManage, canEdit }: {
  replies: SavedReply[]; onInsert: (body: string) => void; onManage: () => void; canEdit: boolean;
}) {
  return (
    <Menu label="Saved replies" align="left"
      trigger={<span className="inline-flex items-center gap-1.5 h-9 px-3 rounded-control border border-solid border-line bg-card text-copy text-ink"><Icon name="MessageCircle" size="sm" />Saved replies</span>}
      items={[
        ...replies.map(r => ({ key: r.id, label: r.title, hint: r.body.length > 70 ? `${r.body.slice(0, 70)}…` : r.body, onSelect: () => onInsert(r.body) })),
        { key: '__manage', label: replies.length ? 'Manage saved replies' : 'Add a saved reply', icon: 'Settings',
          hint: 'Create, change or delete the replies everyone can use', disabledReason: canEdit ? undefined : 'Only people who can send messages can change these.', onSelect: onManage },
      ]} />
  );
}

/** Create, change and delete saved replies. Shared by everyone who works in Messages. */
export function SavedRepliesManager({ replies, onClose, onChanged }: { replies: SavedReply[]; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [confirmEl, ask] = useConfirm();
  const [editing, setEditing] = useState<{ id: string | null; title: string; body: string } | null>(replies.length ? null : { id: null, title: '', body: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!editing) return;
    setBusy(true);
    try {
      if (editing.id) await api.patch(`/messages/saved-replies/${editing.id}`, { title: editing.title, body: editing.body });
      else await api.post('/messages/saved-replies', { title: editing.title, body: editing.body });
      toast({ tone: 'success', title: editing.id ? 'Saved reply changed.' : 'Saved reply added.' });
      setEditing(null); setErrors({});
      onChanged();
    } catch (e) {
      if (e instanceof ApiFailure && e.fields) setErrors(e.fields);
      toast({ tone: 'critical', title: 'Not saved.', body: errorMessage(e) });
    } finally { setBusy(false); }
  }

  async function remove(r: SavedReply) {
    const ok = await ask({ title: `Delete "${r.title}"?`, body: 'Nobody will be able to insert it any more. Messages already sent with it do not change.', confirmLabel: 'Delete saved reply', danger: true });
    if (ok === null) return;
    try {
      await api.del(`/messages/saved-replies/${r.id}`);
      toast({ tone: 'success', title: 'Saved reply deleted.' });
      onChanged();
    } catch (e) { toast({ tone: 'critical', title: 'Not deleted.', body: errorMessage(e) }); }
  }

  return (
    <Modal title="Saved replies" sub="Short replies anyone in Messages can insert, then change before sending." onClose={onClose} width={560}
      footer={editing
        ? <><Button variant="secondary" onClick={() => { setEditing(null); setErrors({}); }}>Back</Button><Button variant="primary" loading={busy} onClick={save}>{editing.id ? 'Save changes' : 'Add saved reply'}</Button></>
        : <><Button variant="secondary" onClick={onClose}>Done</Button><Button variant="primary" icon={<Icon name="Plus" size="sm" />} onClick={() => setEditing({ id: null, title: '', body: '' })}>New saved reply</Button></>}>
      {confirmEl}
      {editing ? (
        <div className="flex flex-col gap-3">
          <Field label="Name" value={editing.title} maxLength={80} autoFocus onChange={e => setEditing({ ...editing, title: e.target.value })} error={errors.title} placeholder="e.g. Early check-in" />
          <label className="flex flex-col gap-1.5">
            <span className="text-meta font-medium text-muted-ink">Reply</span>
            <textarea value={editing.body} maxLength={2000} rows={6} onChange={e => setEditing({ ...editing, body: e.target.value })}
              className="w-full box-border px-3 py-2.5 [font-family:inherit] text-copy text-ink bg-card border border-solid border-line rounded-control outline-none resize-y" />
            {errors.body && <span className="text-meta text-danger">{errors.body}</span>}
          </label>
        </div>
      ) : replies.length === 0 ? (
        <p className="m-0 text-copy text-muted-ink">No saved replies yet.</p>
      ) : (
        <ul className="m-0 p-0 list-none flex flex-col">
          {replies.map(r => (
            <li key={r.id} className="flex items-start gap-3 py-3 [border-bottom:1px_solid_var(--color-line-soft)]">
              <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                <span className="text-copy font-semibold">{r.title}</span>
                <span className="text-meta text-muted-ink whitespace-pre-line [overflow-wrap:anywhere]">{r.body}</span>
              </div>
              <div className="flex gap-1.5 flex-none">
                <Button size="sm" variant="secondary" onClick={() => setEditing({ id: r.id, title: r.title, body: r.body })}>Edit</Button>
                <Button size="sm" variant="secondary" onClick={() => remove(r)} aria-label={`Delete ${r.title}`}><Icon name="Trash2" size="sm" /></Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
