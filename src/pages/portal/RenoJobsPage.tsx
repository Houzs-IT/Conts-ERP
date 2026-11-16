import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import Icon from '../../components/Icon';
import { Button } from '../../components/Button';
import { EmptyState, Skeleton } from '../../components/States';
import { api, ApiFailure, errorMessage } from '../../lib/api';
import { color, radius, text, tone } from '../../theme';
import { usePortalText } from '../../lib/portalI18n';
import {
  CARPENTRY_LABEL, NO_ROOM_LABEL, WORKS_LABEL, formatCount, formatDayMonth, formatDoneDay, formatPlanDates, groupByRoom, isLineDone, isPlanLate, latestDoneDay, summarizeProject, tradeDayNumber,
  type RenoJobsResponse, type RenoLine, type RenoPlan, type RenoProgressResponse, type RenoProject, type RenoRoomGroup, type RenoTradeDay, type RenoTradeFinishResponse,
  type RenoTradeGroup, type RenoTradeStartResponse,
} from '../../lib/renoJobs';
import RenoJobSheet from './RenoJobSheet';
import RenoTradeSheet, { type RenoTradeMode } from './RenoTradeSheet';

const NOTICE_MS = 8000;
const NO_BRAND_CODE = 'NO_BRAND';
const NOTICE_CLEARANCE = 150;
const VISIBLE_DAYS = 3;
const TRADE_BUTTON_HEIGHT = 48;
const STALE_STATUSES: ReadonlySet<number> = new Set([404, 409]);

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

interface TradeNotice {
  kind: 'started' | 'finished';
  label: string;
}

type Notice = SavedNotice | TradeNotice;

interface TradeSheetState {
  mode: RenoTradeMode;
  trade: RenoTradeGroup;
  label: string;
}

interface TradeActions {
  canUpdate: boolean;
  onUpdate: (line: RenoLine) => void;
  onStart: (trade: RenoTradeGroup, label: string) => void;
  onFinish: (trade: RenoTradeGroup, label: string) => void;
}

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

function DayLog({ days }: { days: RenoTradeDay[] }) {
  const t = usePortalText().renoJobs;
  const [isAll, setIsAll] = useState(false);
  if (days.length === 0) return null;
  const shown = isAll ? days : days.slice(0, VISIBLE_DAYS);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {shown.map(day => (
        <span key={day.date} style={{ fontSize: text.copy, color: color.inkSecondary, overflowWrap: 'anywhere' }}>
          {t.dayLog(day.day, formatDayMonth(day.date) ?? day.date, day.photoCount, day.by.join(', '))}
        </span>
      ))}
      {days.length > VISIBLE_DAYS && (
        <Button variant="tertiary" size="touch" onClick={() => setIsAll(open => !open)} style={{ alignSelf: 'flex-start' }}>{isAll ? t.showLess : t.showAll}</Button>
      )}
    </div>
  );
}

function TradeSection({ trade, days, actions }: { trade: RenoTradeGroup; days: RenoTradeDay[]; actions: TradeActions }) {
  const t = usePortalText().renoJobs;
  const { canUpdate, onUpdate, onStart, onFinish } = actions;
  const { plan } = trade;
  const dates = plan ? formatPlanDates(plan) : null;
  const label = trade.label === CARPENTRY_LABEL ? t.carpentry : trade.label === WORKS_LABEL ? t.works : trade.label;
  const isLive = plan !== null && plan.status !== 'skipped';
  const state = isLive ? plan.state : null;
  const isWaiting = plan?.isWaitingForReceipt ?? false;
  const dayNumber = tradeDayNumber(plan?.startedOn ?? null);
  const startedDay = formatDayMonth(plan?.startedOn ?? null);
  const finishedDay = latestDoneDay(trade.tradeLines);
  const statusText = state === 'in_progress'
    ? [t.inProgress, dayNumber === null ? null : t.dayNumber(dayNumber), startedDay ? t.startedOn(startedDay) : null].filter(Boolean).join(' · ')
    : state === 'done'
      ? (finishedDay ? t.finishedOn(finishedDay) : t.done)
      : state === 'open' ? t.notStarted : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ fontSize: text.heading, fontWeight: 700, color: color.ink, overflowWrap: 'anywhere' }}>{label}</span>
          {dates && <span style={{ fontSize: text.meta, color: color.textMuted }}>{dates}</span>}
        </div>
        <PlanChip plan={plan} />
      </div>
      {statusText && <span style={{ fontSize: text.copy, fontWeight: 600, color: state === 'done' ? tone.success.fg : color.ink, overflowWrap: 'anywhere' }}>{statusText}</span>}
      {state === 'in_progress' && <DayLog days={days} />}
      {isWaiting && state === 'in_progress' && <span role="note" style={{ fontSize: text.copy, color: tone.info.fg, overflowWrap: 'anywhere' }}>{t.waitingReceipt}</span>}
      {canUpdate && state === 'open' && (
        <Button variant="primary" size="touch" onClick={() => onStart(trade, label)} style={{ width: '100%', minHeight: TRADE_BUTTON_HEIGHT }}>{t.startWork}</Button>
      )}
      {canUpdate && state === 'in_progress' && !isWaiting && (
        <Button variant="primary" size="touch" onClick={() => onFinish(trade, label)} style={{ width: '100%', minHeight: TRADE_BUTTON_HEIGHT, whiteSpace: 'normal', padding: '10px 18px' }}>{t.finishTrade(label)}</Button>
      )}
      {trade.lines.map(line => <LineCard key={line.id} line={line} canUpdate={canUpdate && state !== 'open'} onUpdate={onUpdate} />)}
    </div>
  );
}

function daysOf(tradeLog: RenoProject['tradeLog'], trade: RenoTradeGroup): RenoTradeDay[] {
  return tradeLog.find(entry => entry.planKey === trade.plan?.planKey)?.days ?? [];
}

function RoomSection({ room, tradeLog, isOpenAtStart, actions }: { room: RenoRoomGroup; tradeLog: RenoProject['tradeLog']; isOpenAtStart: boolean; actions: TradeActions }) {
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
          {room.trades.map(trade => <TradeSection key={trade.key} trade={trade} days={daysOf(tradeLog, trade)} actions={actions} />)}
          {room.carpentry && <TradeSection trade={room.carpentry} days={daysOf(tradeLog, room.carpentry)} actions={actions} />}
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

function ProjectView({ project, actions, failureText, onBack }: { project: RenoProject; actions: TradeActions; failureText: string | null; onBack: () => void }) {
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
      {rooms.map((room, index) => <RoomSection key={room.room} room={room} tradeLog={project.tradeLog} isOpenAtStart={index === 0} actions={actions} />)}
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
  const [tradeSheet, setTradeSheet] = useState<TradeSheetState | null>(null);
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
    if (!notice) return undefined;
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
      setNotice({ kind: 'saved', label: line.remark?.trim() || line.name, doneQty: result.doneQty, qty: line.qty });
      void load();
    } catch (error) {
      setSheetError(errorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const submitTrade = async ({ mode, trade, label }: TradeSheetState, photos: File[]): Promise<void> => {
    const taskId = trade.plan?.taskId;
    if (taskId === undefined) return;
    setIsSaving(true);
    setSheetError(null);
    try {
      const form = new FormData();
      photos.forEach(photo => form.append('photo', photo, photo.name));
      const path = `/field/site-work/trades/${taskId}/${mode}`;
      await api.post<RenoTradeFinishResponse | RenoTradeStartResponse>(path, form);
      setTradeSheet(null);
      setNotice({ kind: mode === 'finish' ? 'finished' : 'started', label });
      void load();
    } catch (error) {
      setSheetError(errorMessage(error));
      if (error instanceof ApiFailure && STALE_STATUSES.has(error.status)) void load();
    } finally {
      setIsSaving(false);
    }
  };

  const actions: TradeActions = {
    canUpdate: data?.areTicksReady ?? false,
    onUpdate: line => { setSheetError(null); setSheetLine(line); },
    onStart: (trade, label) => { setSheetError(null); setTradeSheet({ mode: 'start', trade, label }); },
    onFinish: (trade, label) => { setSheetError(null); setTradeSheet({ mode: 'finish', trade, label }); },
  };

  const openProject = data?.projects.find(project => String(project.id) === openProjectId) ?? null;
  const { canUpdate } = actions;

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
      return <ProjectView project={openProject} actions={actions} failureText={failure?.message ?? null} onBack={() => setSearchParams({})} />;
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

  const noticeText = ((): string => {
    if (!notice) return '';
    if (notice.kind === 'saved') return t.saved(notice.label, t.ofText(formatCount(notice.doneQty), formatCount(notice.qty)));
    return notice.kind === 'started' ? t.tradeStartedNotice(notice.label) : t.tradeFinishedNotice(notice.label);
  })();

  return (
    <>
      {body}
      {sheetLine && <RenoJobSheet line={sheetLine} isSaving={isSaving} errorText={sheetError} onCancel={() => setSheetLine(null)} onSave={(doneQty, photos) => void save(sheetLine, doneQty, photos)} />}
      {tradeSheet && <RenoTradeSheet mode={tradeSheet.mode} label={tradeSheet.label} lines={tradeSheet.trade.tradeLines} isSaving={isSaving} errorText={sheetError} onCancel={() => setTradeSheet(null)} onSubmit={photos => void submitTrade(tradeSheet, photos)} />}
      {notice && <div aria-hidden style={{ height: NOTICE_CLEARANCE }} />}
      {notice && (
        <div role="status" style={{
          position: 'fixed', left: 12, right: 12, bottom: 'calc(64px + env(safe-area-inset-bottom))', zIndex: 30, maxWidth: 536, margin: '0 auto', boxSizing: 'border-box',
          background: color.fillStrong, color: color.onFillStrong, borderRadius: radius.card, padding: '8px 8px 8px 14px', display: 'flex', alignItems: 'center', gap: 10, minHeight: 60,
        }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: text.copy, fontWeight: 600, overflowWrap: 'anywhere' }}>{noticeText}</span>
          <Button variant="tertiary" size="touch" onClick={() => setNotice(null)} style={{ color: color.onFillStrong }}>{t.ok}</Button>
        </div>
      )}
    </>
  );
}
