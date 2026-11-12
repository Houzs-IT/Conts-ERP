import { useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { StaleBanner } from '../../components/DataState';
import { Skeleton } from '../../components/States';
import { useToast } from '../../components/Toast';
import { useApi } from '../../lib/useApi';
import { api, errorMessage } from '../../lib/api';
import type { JobTimesPayload } from '../../../functions/api/employees/job-times';

type Draft = Record<string, string>;

const toDraft = (minutes: JobTimesPayload['minutes']): Draft =>
  Object.fromEntries(Object.entries(minutes).map(([card, value]) => [card, String(value)]));

const minutesProblem = (text: string, maxMinutes: number): string | undefined => {
  const minutes = Number(text);
  return text.trim() !== '' && Number.isInteger(minutes) && minutes >= 0 && minutes <= maxMinutes
    ? undefined : `Whole minutes, 0 to ${maxMinutes}.`;
};

interface CardGroupProps {
  title: string;
  note: string;
  cards: JobTimesPayload['cleaning'];
  draft: Draft;
  maxMinutes: number;
  canEdit: boolean;
  onChange: (card: string, text: string) => void;
}

function CardGroup({ title, note, cards, draft, maxMinutes, canEdit, onChange }: CardGroupProps) {
  return (
    <section className="bg-card rounded-card border border-solid border-line-soft shadow-[var(--shadow-card)] px-5 py-4 flex flex-col">
      <span className="flex flex-col gap-0.5 pb-2">
        <span className="text-heading font-bold">{title}</span>
        <span className="text-meta text-muted-ink">{note}</span>
      </span>
      {cards.map(({ key, label }) => (
        <div key={key} className="grid grid-cols-[minmax(0,1fr)_132px] items-center gap-3 py-2 [border-top:1px_solid_var(--color-line-soft)]">
          <span className="font-semibold">{label}</span>
          <Field aria-label={`${label} standard minutes`} numeric inputMode="numeric" value={draft[key] ?? ''} disabled={!canEdit}
            error={minutesProblem(draft[key] ?? '', maxMinutes)} onChange={event => onChange(key, event.target.value)}
            trailing={<span className="text-meta text-muted-ink">min</span>} />
        </div>
      ))}
    </section>
  );
}

export default function StandardTimesTab() {
  const toast = useToast();
  const { data, error, reload } = useApi<JobTimesPayload>('/employees/job-times');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  useEffect(() => { if (data) setDraft(toDraft(data.minutes)); }, [data]);

  const saved = data ? toDraft(data.minutes) : null;
  const hasChanges = !!draft && !!saved && Object.keys(saved).some(card => draft[card] !== saved[card]);
  const hasProblem = !!draft && !!data && Object.values(draft).some(text => minutesProblem(text, data.maxMinutes));
  const setCard = (card: string, text: string): void => setDraft(current => ({ ...current, [card]: text }));

  async function save(): Promise<void> {
    if (!draft) return;
    setIsSaving(true);
    try {
      const minutes = Object.fromEntries(Object.entries(draft).map(([card, text]) => [card, Number(text)]));
      await api.put('/employees/job-times', { minutes });
      toast({ tone: 'success', title: 'Standard times saved.', body: 'Employee Performance uses them straight away.' });
      reload();
    } catch (saveError) {
      toast({ tone: 'critical', title: 'Not saved.', body: errorMessage(saveError, 'Try again in a moment.') });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 max-w-[720px]">
      {error && <StaleBanner message={error} onRetry={reload} />}
      <section className="bg-card rounded-card border border-solid border-line-soft shadow-[var(--shadow-card)] px-5 py-4 flex flex-col gap-0.5">
        <span className="text-heading font-bold tracking-[-0.005em]">Standard Times</span>
        <span className="text-meta text-muted-ink">
          How many minutes each job card should take. Employee Performance compares this with the time from Start to Done on each job,
          so you see who finishes early or late. A card left at 0 is not counted until you set it.
        </span>
      </section>
      {!data || !draft ? <Skeleton height={320} /> : (
        <>
          <CardGroup title="Maintenance" note="One time per repair category." cards={data.repairs} draft={draft} maxMinutes={data.maxMinutes} canEdit={data.mayEdit} onChange={setCard} />
          <CardGroup title="Cleaning" note="One time each for Basic and Deep clean jobs." cards={data.cleaning} draft={draft} maxMinutes={data.maxMinutes} canEdit={data.mayEdit} onChange={setCard} />
          {data.mayEdit ? (
            <div className="flex justify-end gap-2">
              {hasChanges && saved && <Button size="sm" variant="secondary" disabled={isSaving} onClick={() => setDraft(saved)}>Discard</Button>}
              <Button size="sm" variant="primary" loading={isSaving} disabled={!hasChanges || hasProblem}
                disabledReason={hasProblem ? 'Fix the times marked in red.' : 'Change a time first.'} onClick={() => void save()}>Save times</Button>
            </div>
          ) : <span className="text-meta text-muted-ink">Only management changes the standard times.</span>}
        </>
      )}
    </div>
  );
}
