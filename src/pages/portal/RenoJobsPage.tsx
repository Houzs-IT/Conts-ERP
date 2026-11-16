import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import Icon from '../../components/Icon';
import { Button } from '../../components/Button';
import { EmptyState, Skeleton } from '../../components/States';
import { api, ApiFailure, errorMessage } from '../../lib/api';
import { color, radius, text, tone } from '../../theme';
import { usePortalText } from '../../lib/portalI18n';
import {
  CARPENTRY_LABEL, NO_ROOM_LABEL, WORKS_LABEL, formatCount, formatDoneDay, formatPlanDates, groupByRoom, isLineDone, isPlanLate, summarizeProject,
  type RenoJobsResponse, type RenoLine, type RenoPlan, type RenoProgressResponse, type RenoProject, type RenoRoomGroup, type RenoTradeGroup,
} from '../../lib/renoJobs';
import RenoJobSheet from './RenoJobSheet';

const NOTICE_MS = 8000;
const NO_BRAND_CODE = 'NO_BRAND';
const NOTICE_CLEARANCE = 150;

interface LoadFailure {
  code: string;
  message: string;
}

interface SavedNotice {
  kind: 'saved';
  label: string;
  doneQty: number;
  qty: number;
}

interface ClosedNotice {
  kind: 'closed';
}

type Notice = SavedNotice | ClosedNotice;

const CARD: CSSProperties = {
  background: color.card, border: `1px solid ${color.border}`, borderRadius: radius.card, boxShadow: 'var(--shadow-card)', boxSizing: 'border-box',
};

function Chip({ label, kind }: { label: string; kind: 'critical' | 'success' | 'info' | 'neutral' }) {
  const { bg, fg } = tone[kind];
  return <span style={{ flex: 'none', background: bg, color: fg, fontSize: text.meta, fontWeight: 600, borderRadius: radius.pill, padding: '3px 10px', whiteSpace: 'nowrap' }}>{label}</span>;
}

function PlanChip({ plan }: { plan: RenoPlan | null }) {
  const t = usePortalText().renoJobs;
  if (!plan) return <Chip label={t.notPlanned} kind="neutral" />;
  const kind = isPlanLate(plan) ? 'critical' : plan.status === 'done' ? 'success' : plan.status === 'in_progress' ? 'info' : 'neutral';
  return <Chip label={t.planStatus[plan.status]} kind={kind} />;
}

function ProgressBar({ done, total, isFull }: { done: number; total: number; isFull: boolean }) {
  const percent = total > 0 ? Math.min(100, (done / total) * 100) : 0;
  return (
    <div aria-hidden style={{ height: 8, borderRadius: radius.pill, background: color.sunken, overflow: 'hidden' }}>
      <div style={{ width: `${percent}%`, height: '100%', background: isFull ? tone.success.line : color.primary }} />
    </div>
  );
}

function LineCard({ line, canUpdate, onUpdate }: { line: RenoLine; canUpdate: boolean; onUpdate: (line: RenoLine) => void }) {
  const t = usePortalText().renoJobs;
  const remark = line.remark?.trim();
  const isDone = isLineDone(line);
  const doneDay = formatDoneDay(line.doneAt);
  const progress = t.ofText(formatCount(line.doneQty), formatCount(line.qty));
  return (
    <div style={{ ...CARD, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ fontSize: text.heading, fontWeight: 700, color: color.ink, overflowWrap: 'anywhere', lineHeight: 1.3 }}>{remark || line.name}</span>
      <span style={{ fontSize: text.meta, color: color.textMuted, overflowWrap: 'anywhere' }}>
        {remark ? `${line.name} · ` : ''}{line.itemCode}
      </span>
      <span style={{ fontSize: text.copy, color: color.inkSecondary }}>{t.qty(formatCount(line.qty), line.uom)}</span>
      {line.photoCount > 0 && <span style={{ fontSize: text.meta, color: color.textMuted }}>{t.photos(line.photoCount)}</span>}
      <ProgressBar done={line.doneQty} total={line.qty} isFull={isDone} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ fontSize: text.copy, fontWeight: 600, color: isDone ? tone.success.fg : color.ink }}>
          {isDone ? (doneDay ? t.doneOn(doneDay) : t.done) : t.doneCount(progress)}
        </span>
        {canUpdate && <Button variant="secondary" size="touch" onClick={() => onUpdate(line)} aria-label={t.updateLine(remark || line.name)}>{t.update}</Button>}
      </div>
    </div>
  );
}

function TradeSection({ trade, canUpdate, onUpdate }: { trade: RenoTradeGroup; canUpdate: boolean; onUpdate: (line: RenoLine) => void }) {
  const t = usePortalText().renoJobs;
  const dates = trade.plan ? formatPlanDates(trade.plan) : null;
  const label = trade.label === CARPENTRY_LABEL ? t.carpentry : trade.label === WORKS_LABEL ? t.works : trade.label;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ fontSize: text.heading, fontWeight: 700, color: color.ink }}>{label}</span>
          {dates && <span style={{ fontSize: text.meta, color: color.textMuted }}>{dates}</span>}
        </div>
        <PlanChip plan={trade.plan} />
      </div>
      {trade.lines.map(line => <LineCard key={line.id} line={line} canUpdate={canUpdate} onUpdate={onUpdate} />)}
    </div>
  );
}

function RoomSection({ room, isOpenAtStart, canUpdate, onUpdate }: { room: RenoRoomGroup; isOpenAtStart: boolean; canUpdate: boolean; onUpdate: (line: RenoLine) => void }) {
  const t = usePortalText().renoJobs;
  const [isOpen, setIsOpen] = useState(isOpenAtStart);
  const doneCount = room.lines.filter(isLineDone).length;
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <button type="button" aria-expanded={isOpen} onClick={() => setIsOpen(open => !open)}
        style={{ ...CARD, minHeight: 56, padding: '0 14px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', textAlign: 'left', width: '100%' }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: text.heading, fontWeight: 700, color: color.ink, overflowWrap: 'anywhere' }}>{room.room === NO_ROOM_LABEL ? t.noRoom : room.room}</span>
        <span style={{ fontSize: text.meta, color: color.textMuted, whiteSpace: 'nowrap' }}>{t.roomDone(doneCount, room.lines.length)}</span>
        <Icon name={isOpen ? 'ChevronUp' : 'ChevronDown'} size="nav" />
      </button>
      {isOpen && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {room.trades.map(trade => <TradeSection key={trade.key} trade={trade} canUpdate={canUpdate} onUpdate={onUpdate} />)}
          {room.carpentry && <TradeSection trade={room.carpentry} canUpdate={canUpdate} onUpdate={onUpdate} />}
        </div>
      )}
    </section>
  );
}

function ProjectCard({ project, onOpen }: { project: RenoProject; onOpen: () => void }) {
  const t = usePortalText().renoJobs;
  const { worksCount, builtInCount, doneLineCount, lineCount, isLate } = summarizeProject(project);
  return (
    <button type="button" onClick={onOpen} style={{ ...CARD, width: '100%', minHeight: 44, padding: 14, display: 'flex', flexDirection: 'column', gap: 8, cursor: 'pointer', textAlign: 'left' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: text.heading, fontWeight: 700, color: color.ink, overflowWrap: 'anywhere' }}>{project.name}</span>
        {isLate && <Chip label={t.late} kind="critical" />}
      </div>
      <span style={{ fontSize: text.meta, color: color.textMuted }}>{project.brand ?? ''}</span>
      <span style={{ fontSize: text.copy, color: color.inkSecondary }}>{t.worksBuiltIn(worksCount, builtInCount)}</span>
      <ProgressBar done={doneLineCount} total={lineCount} isFull={lineCount > 0 && doneLineCount === lineCount} />
      <span style={{ fontSize: text.copy, fontWeight: 600, color: color.ink }}>{t.linesDone(doneLineCount, lineCount)}</span>
    </button>
  );
}

function ProjectView({ project, canUpdate, failureText, onBack, onUpdate }: { project: RenoProject; canUpdate: boolean; failureText: string | null; onBack: () => void; onUpdate: (line: RenoLine) => void }) {
  const t = usePortalText().renoJobs;
  const rooms = groupByRoom(project);
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button type="button" onClick={onBack} aria-label={t.backToProjects}
          style={{ width: 44, height: 44, flex: 'none', display: 'grid', placeItems: 'center', borderRadius: radius.control, border: `1px solid ${color.border}`, background: color.card, color: color.ink, cursor: 'pointer', padding: 0 }}>
          <Icon name="ChevronLeft" size="nav" />
        </button>
        <h1 style={{ margin: 0, fontSize: text.title, fontWeight: 700, color: color.ink, overflowWrap: 'anywhere', minWidth: 0 }}>{project.name}</h1>
      </div>
      {failureText && <span role="alert" style={{ fontSize: text.copy, color: tone.critical.fg }}>{failureText}</span>}
      {rooms.map((room, index) => <RoomSection key={room.room} room={room} isOpenAtStart={index === 0} canUpdate={canUpdate} onUpdate={onUpdate} />)}
    </>
  );
}

export default function RenoJobsPage() {
  const t = usePortalText().renoJobs;
  const [searchParams, setSearchParams] = useSearchParams();
  const openProjectId = searchParams.get('project');
  const [data, setData] = useState<RenoJobsResponse | null>(null);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sheetLine, setSheetLine] = useState<RenoLine | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setData(await api.get<RenoJobsResponse>('/field/site-work/jobs'));
      setFailure(null);
    } catch (error) {
      setFailure({ code: error instanceof ApiFailure ? error.code : '', message: errorMessage(error) });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (notice?.kind !== 'saved') return undefined;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const patchDoneQty = (lineId: string, doneQty: number, photoCount: number): void => {
    setData(current => current && { ...current, projects: current.projects.map(project => ({ ...project, lines: project.lines.map(line => (line.id === lineId ? { ...line, doneQty, photoCount } : line)) })) });
  };

  const save = async (line: RenoLine, doneQty: number, photos: File[]): Promise<void> => {
    setIsSaving(true);
    setSheetError(null);
    try {
      const form = new FormData();
      form.set('data', JSON.stringify({ doneQty }));
      photos.forEach(photo => form.append('photo', photo, photo.name));
      const result = await api.post<RenoProgressResponse>(`/field/site-work/lines/${encodeURIComponent(line.id)}/progress`, form);
      patchDoneQty(line.id, result.doneQty, result.photoCount);
      setSheetLine(null);
      setNotice(result.completedTaskIds.length > 0
        ? { kind: 'closed' }
        : { kind: 'saved', label: line.remark?.trim() || line.name, doneQty: result.doneQty, qty: line.qty });
      void load();
    } catch (error) {
      setSheetError(errorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const openProject = data?.projects.find(project => String(project.id) === openProjectId) ?? null;
  const canUpdate = data?.areTicksReady ?? false;

  const body = ((): ReactNode => {
    if (isLoading && !data) {
      return <><Skeleton height={120} radius={14} /><Skeleton height={120} radius={14} /></>;
    }
    if (failure?.code === NO_BRAND_CODE) {
      return <EmptyState icon="ClipboardList" title={t.noBrandTitle} body={failure.message} />;
    }
    if (!data) {
      return <EmptyState icon="CircleAlert" title={t.loadFailTitle} body={failure?.message} action={{ label: t.tryAgain, onClick: () => { setIsLoading(true); void load(); } }} forceAction />;
    }
    if (openProject) {
      return <ProjectView project={openProject} canUpdate={canUpdate} failureText={failure?.message ?? null} onBack={() => setSearchParams({})} onUpdate={line => { setSheetError(null); setSheetLine(line); }} />;
    }
    return (
      <>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <h1 style={{ margin: 0, fontSize: text.title, fontWeight: 700, color: color.ink }}>{t.title}</h1>
          <span style={{ fontSize: text.copy, color: color.textMuted }}>{data.brand}</span>
        </div>
        {!canUpdate && <span role="note" style={{ fontSize: text.copy, color: color.textMuted }}>{t.notReady}</span>}
        {failure && <span role="alert" style={{ fontSize: text.copy, color: tone.critical.fg }}>{failure.message}</span>}
        {data.projects.length === 0
          ? <EmptyState icon="ClipboardList" title={t.noProjects} body={t.noProjectsBody} />
          : data.projects.map(project => <ProjectCard key={project.id} project={project} onOpen={() => setSearchParams({ project: String(project.id) })} />)}
      </>
    );
  })();

  return (
    <>
      {body}
      {sheetLine && <RenoJobSheet line={sheetLine} isSaving={isSaving} errorText={sheetError} onCancel={() => setSheetLine(null)} onSave={(doneQty, photos) => void save(sheetLine, doneQty, photos)} />}
      {notice && <div aria-hidden style={{ height: NOTICE_CLEARANCE }} />}
      {notice && (
        <div role="status" style={{
          position: 'fixed', left: 12, right: 12, bottom: 'calc(64px + env(safe-area-inset-bottom))', zIndex: 30, maxWidth: 536, margin: '0 auto', boxSizing: 'border-box',
          background: color.fillStrong, color: color.onFillStrong, borderRadius: radius.card, padding: '8px 8px 8px 14px', display: 'flex', alignItems: 'center', gap: 10, minHeight: 60,
        }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: text.copy, fontWeight: 600, overflowWrap: 'anywhere' }}>
            {notice.kind === 'saved' ? t.saved(notice.label, t.ofText(formatCount(notice.doneQty), formatCount(notice.qty))) : t.tradeClosedNotice}
          </span>
          <Button variant="tertiary" size="touch" onClick={() => setNotice(null)} style={{ color: color.onFillStrong }}>{t.ok}</Button>
        </div>
      )}
    </>
  );
}
