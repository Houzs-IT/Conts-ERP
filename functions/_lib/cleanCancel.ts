import { type Env, all, nowIso } from './db';
import { MYT_DATE } from './ops';
import { CLEAN_KINDS_SQL, CLEANING_CANCELLED } from './cleaning';
import { hasJobInvoices } from './jobProfit';

export interface CleaningJobActor { userId: string; fullName: string }

export interface CleaningJobSkip { id: string; unitNumber: string | null; reason: string }

export interface CancelledCleaningJobs { cancelled: number; skipped: CleaningJobSkip[] }

interface CancelCandidate {
  id: string; state: string; kind: string; title: string; unit_id: string | null; reservation_id: string | null;
  started_at: string | null; day: string; unit_number: string | null;
  files: number; damage: number; money: number; cleaners: string | null;
}

interface AuditEntry { task: string; action: string; table: string; id: string; before: string | null; after: string }

function whyKept(job: CancelCandidate): string | null {
  if (job.state === 'resolved') return 'already done';
  if (job.started_at || job.state === 'in_progress') return 'a cleaner started it; mark it done instead';
  if (Number(job.files) > 0) return 'it has photos or videos; mark it done instead';
  if (Number(job.damage) > 0) return 'damage was reported from it';
  if (Number(job.money) > 0) return 'money is already recorded on it';
  return null;
}

function auditEntriesFor(job: CancelCandidate, reason: string, isBulk: boolean): AuditEntry[] {
  const cancelled: AuditEntry = {
    task: job.id, action: 'task.cancel', table: 'tasks', id: job.id,
    before: JSON.stringify({ unitId: job.unit_id, unitNumber: job.unit_number, reservationId: job.reservation_id, kind: job.kind, title: job.title, day: job.day, state: job.state, cleaners: job.cleaners ?? null }),
    after: JSON.stringify({ reason, bulk: isBulk }),
  };
  if (!job.reservation_id) return [cancelled];
  return [cancelled, { task: job.id, action: CLEANING_CANCELLED, table: 'reservations', id: job.reservation_id, before: null, after: JSON.stringify({ taskId: job.id, reason, day: job.day }) }];
}

async function loadCandidates(env: Env, taskIds: string[], invoicedSql: string): Promise<Map<string, CancelCandidate>> {
  const day = MYT_DATE('COALESCE(t.scheduled_for, t.due_at, t.created_at)');
  const candidates = await all<CancelCandidate>(env, `
    SELECT t.id, t.state, t.kind, t.title, t.unit_id, t.reservation_id, t.started_at, ${day} AS day,
           COALESCE(COALESCE(NULLIF(u.unit_code, ''), u.unit_number), t.external_address) AS unit_number,
           (SELECT COUNT(*)::int FROM documents d WHERE d.task_id = t.id) AS files,
           (SELECT COUNT(*)::int FROM maintenance_issues m WHERE m.source_task_id = t.id) AS damage,
           (SELECT COUNT(*)::int FROM expenses e WHERE e.task_id = t.id${invoicedSql}) AS money,
           (SELECT string_agg(COALESCE(c.full_name, x.full_name), ', ') FROM task_cleaners tc LEFT JOIN cleaners c ON c.id = tc.cleaner_id
              LEFT JOIN users x ON x.id = tc.user_id WHERE tc.task_id = t.id) AS cleaners
    FROM tasks t LEFT JOIN units u ON u.id = t.unit_id
    WHERE t.id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) AND t.kind IN ${CLEAN_KINDS_SQL}`, JSON.stringify(taskIds));
  return new Map(candidates.map(candidate => [candidate.id, candidate]));
}

export async function cancelCleaningJobs(env: Env, actor: CleaningJobActor, taskIds: string[], reason: string): Promise<CancelledCleaningJobs> {
  const invoicedSql = (await hasJobInvoices(env)) ? ' OR e.invoice_task_id = t.id' : '';
  const candidates = await loadCandidates(env, taskIds, invoicedSql);
  const skipped: CleaningJobSkip[] = [];
  const eligible: CancelCandidate[] = [];
  for (const id of taskIds) {
    const job = candidates.get(id);
    if (!job) { skipped.push({ id, unitNumber: null, reason: 'not a cleaning job any more' }); continue; }
    const reasonKept = whyKept(job);
    if (reasonKept) skipped.push({ id, unitNumber: job.unit_number, reason: reasonKept });
    else eligible.push(job);
  }
  if (!eligible.length) return { cancelled: 0, skipped };

  const isBulk = taskIds.length > 1;
  const auditRows = await all<{ action: string; entity_id: string }>(env, `
    WITH gone AS (
      DELETE FROM tasks t WHERE t.id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) AND t.state != 'resolved' AND t.started_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.task_id = t.id)
        AND NOT EXISTS (SELECT 1 FROM maintenance_issues m WHERE m.source_task_id = t.id)
        AND NOT EXISTS (SELECT 1 FROM expenses e WHERE e.task_id = t.id${invoicedSql})
      RETURNING t.id)
    INSERT INTO audit_log (actor_id, actor_label, action, entity_table, entity_id, before_state, after_state, source, occurred_at)
    SELECT ?, ?, x->>'action', x->>'table', x->>'id', x->>'before', x->>'after', 'web', ?
    FROM jsonb_array_elements(?::text::jsonb) x JOIN gone ON gone.id = x->>'task'
    RETURNING action, entity_id`,
    JSON.stringify(eligible.map(job => job.id)), actor.userId, actor.fullName, nowIso(),
    JSON.stringify(eligible.flatMap(job => auditEntriesFor(job, reason, isBulk))));
  const goneIds = new Set(auditRows.filter(row => row.action === 'task.cancel').map(row => row.entity_id));
  for (const job of eligible) {
    if (!goneIds.has(job.id)) skipped.push({ id: job.id, unitNumber: job.unit_number, reason: 'it changed meanwhile; refresh and try again' });
  }
  return { cancelled: goneIds.size, skipped };
}
