import { useEffect, useState } from 'react';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { StatusBadge } from '../../components/StatusBadge';
import { TableSkeleton } from '../../components/DataState';
import { useToast } from '../../components/Toast';
import { useApi } from '../../lib/useApi';
import { api, ApiFailure, errorMessage } from '../../lib/api';
import { date } from '../../lib/format';

/** Settings > Agreement template (staff sheet UNIT, 17 Oct 2026): the management agreement the contract generator
 *  fills in ("Generate agreement" on a unit's Contract tab). Each save is a new version; older ones are kept. The
 *  seeded text is a neutral placeholder until the company pastes its own agreement here. */

interface Placeholder { key: string; label: string; where: string; optional?: boolean }
interface Payload {
  ready: boolean; placeholders: Placeholder[];
  current: { id: string; version: number; title: string; body: string; createdAt: string; createdBy: string | null } | null;
  versions: { id: string; version: number; title: string; createdAt: string; createdBy: string | null; chars: number }[];
}

export default function AgreementTemplateSettings({ readOnly }: { readOnly: boolean }) {
  const { data, loading, error, reload } = useApi<Payload>('/settings/agreement-template');
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  useEffect(() => { if (data?.current) { setTitle(data.current.title); setBody(data.current.body); } }, [data?.current?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = !!data?.current && (title !== data.current.title || body !== data.current.body);

  async function save() {
    setBusy(true);
    try {
      const r = await api.post<{ version: number }>('/settings/agreement-template', { title, body });
      toast({ tone: 'success', title: `Agreement template saved as version ${r.version}.`, body: 'Agreements generated from now on use it. Earlier versions are kept.' });
      setFields({}); reload();
    } catch (e) {
      if (e instanceof ApiFailure && e.fields) setFields(e.fields);
      toast({ tone: 'critical', title: 'Template was not saved.', body: errorMessage(e) });
    } finally { setBusy(false); }
  }
  function insert(key: string) {
    const el = document.getElementById('agreement-body') as HTMLTextAreaElement | null;
    const at = el?.selectionStart ?? body.length;
    setBody(b => `${b.slice(0, at)}{{${key}}}${b.slice(at)}`);
  }

  if (loading && !data) return <Card><TableSkeleton rows={5} cols={2} /></Card>;
  if (error && !data) return <Card><div className="p-6 text-copy text-muted-ink">{error}</div></Card>;
  if (!data?.ready) return <Card><div className="p-6 text-copy text-muted-ink">The agreement template needs the latest database update. Ask an administrator to apply it.</div></Card>;
  const placeholderText = /PLACEHOLDER TEMPLATE/.test(data.current?.body ?? '');
  return (
    <div className="flex flex-col gap-4">
      {placeholderText && (
        <div className="py-[10px] px-[14px] rounded-control bg-gold-tint text-copy">This is a placeholder agreement. Paste the company's own agreement wording below and put {'{{placeholders}}'} where the details go.</div>
      )}
      <Card className="@container">
        <div className="grid gap-4 p-5 @3xl:grid-cols-[minmax(0,1fr)_260px]">
          <fieldset disabled={readOnly} className="m-0 p-0 border-0 min-w-0 flex flex-col gap-3">
            <Field label="Title" value={title} maxLength={160} error={fields.title} onChange={e => setTitle(e.target.value)} />
            <label className="flex flex-col gap-1.5">
              <span className="text-meta font-medium text-muted-ink">Agreement text</span>
              <textarea id="agreement-body" aria-label="Agreement text" value={body} rows={22} onChange={e => setBody(e.target.value)}
                className="field-input h-auto! py-2.5 leading-[1.5] resize-y min-h-[320px] font-mono text-meta!" />
              {fields.body ? <span className="text-meta text-critical">{fields.body}</span>
                : <span className="text-caption text-muted-ink">A line starting with "# " is a heading. A blank line starts a new paragraph. {'{{owner_name}}'} and the others are filled from the unit, owner and contract.</span>}
            </label>
          </fieldset>
          <div className="flex flex-col gap-2 min-w-0">
            <span className="text-meta font-semibold">Placeholders</span>
            <span className="text-caption text-muted-ink">{readOnly ? 'What the template can use.' : 'Click one to put it where the cursor is.'}</span>
            <div className="flex flex-col gap-1 max-h-[420px] overflow-y-auto">
              {data.placeholders.map(p => (
                <button key={p.key} type="button" disabled={readOnly} onClick={() => insert(p.key)} title={p.where ? `From ${p.where}` : undefined}
                  className="text-left p-1.5 rounded-control bg-transparent border-0 cursor-pointer hover:bg-muted disabled:cursor-default [font-family:inherit]">
                  <span className="block text-meta font-mono text-ink">{`{{${p.key}}}`}</span>
                  <span className="block text-caption text-muted-ink">{p.label}{p.optional ? ' (optional)' : ''}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        {!readOnly && (
          <div className="flex items-center justify-end gap-2 flex-wrap px-5 py-3 bg-muted [border-top:1px_solid_var(--color-line-soft)]">
            {dirty && <StatusBadge tone="warning" label="Unsaved changes" size="sm" />}
            {dirty && <Button variant="tertiary" size="sm" onClick={() => { setTitle(data.current!.title); setBody(data.current!.body); setFields({}); }} disabled={busy}>Discard</Button>}
            <Button variant="primary" size="sm" onClick={() => void save()} loading={busy} disabled={!dirty} disabledReason="No changes to save.">Save as new version</Button>
          </div>
        )}
      </Card>
      <Card>
        <div className="py-3 px-5 [border-bottom:1px_solid_var(--color-line-soft)] text-copy font-semibold">Versions</div>
        {data.versions.map(v => (
          <div key={v.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5 px-5 [border-top:1px_solid_var(--color-line-soft)] first:[border-top:none] text-meta">
            <span className="min-w-0"><span className="font-semibold">Version {v.version}</span> · {v.title}{v.version === data.current?.version ? ' · in use' : ''}</span>
            <span className="text-muted-ink">{date(v.createdAt)}{v.createdBy ? ` · ${v.createdBy}` : ''}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}
