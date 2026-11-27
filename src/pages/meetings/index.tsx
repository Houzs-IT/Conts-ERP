import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { api, openLoadedTab } from "./kit-api";
import { refreshMeetingsUnread } from "../../lib/meetingsUnread";
import { TabStrip } from "./kit";
import { useElementWidth } from "./useElementWidth";
import { MeetingsToolbar } from "./MeetingsToolbar";
import { MeetingsFilters, MeetingsFilterSheet } from "./MeetingsFilters";
import { cx as cn } from "../../lib/design-tokens";
import {
  DAY, MONTH_NAMES, addDays, atHour, draftBody, draftFrom, emptyDraft, fmtDay, fmtDayLong, isMeetingsTab, isoDay, isView, VIEWS, ms, nextStart, peopleOf, readConflict, startOfDay, startOfWeek,
  meetingColor, type Bootstrap, type CalView, type ColorBy, type ConflictReply, type Draft, type GuestLink, type Meeting, type MeetingsTab, type Notice, type Room, bestRoom } from "../../lib/meetings";
import { ListView, MiniMonth, MonthView, RoomsTimeline, TimeGrid } from "./MeetingsCalendar";
import { ConflictDialog, MeetingDetail, MeetingEditor, QuickBook, ScopeQuestion, type MeetingFile } from "./MeetingsDialogs";
import { BOOK_CTA, BTN, roomForm, type RoomForm } from "./ui";
import { EmailPage, LinkDialog, LinksPage, LogPage, MyMeetings, RoomDialog, RoomsPage, type LinkForm } from "./MeetingsAdmin";

/**
 * Meetings — the meeting rooms every company shares, Google Calendar style.
 *
 * The rooms, meetings and guest links live in the Houzs IT Hub (backend
 * routes/meetings.ts relays every call), so a colleague in Hookka ERP sees what is
 * booked here. The hub decides every rule (a person or room already booked, the
 * room's gap, closed dates, longest booking); this page draws its answer, including
 * the conflict dialog it builds from a 409.
 *
 * URL is state: ?tab=calendar|mine|rooms|links|email|log, &view=day|week|month|rooms|list,
 * &date=YYYY-MM-DD. Polling, not WebSockets: the calendar re-reads every minute.
 */

const POLL_MS = 60_000;
const COMPACT_CALENDAR_PX = 760;
const COLOR_KEY = "meetings.colorBy";
const fresh = <T,>(path: string) => api.get<T>(path, { signal: new AbortController().signal });
const message = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Please try again.");

function rangeFor(view: CalView, anchor: number): [number, number] {
  if (view === "day" || view === "rooms") return [startOfDay(anchor), startOfDay(anchor) + DAY];
  if (view === "week") return [startOfWeek(anchor), startOfWeek(anchor) + 7 * DAY];
  if (view === "list") return [startOfDay(anchor) - 7 * DAY, startOfDay(anchor) + 49 * DAY];
  const a = new Date(anchor);
  const first = startOfWeek(new Date(a.getFullYear(), a.getMonth(), 1).getTime());
  return [first, first + 35 * DAY];
}

export function Meetings({ erpName = "Houzs ERP", embedded = false }: { erpName?: string; embedded?: boolean }) {
  const [params, setParams] = useSearchParams();
  const tab: MeetingsTab = isMeetingsTab(params.get("tab")) ? (params.get("tab") as MeetingsTab) : "calendar";
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null);
  const rootWidth = useElementWidth(rootEl);
  // Below this width 7 days (plus the sidebar on wide screens) leave each day too narrow to read, so show one day.
  const isCompact = rootWidth > 0 ? rootWidth < COMPACT_CALENDAR_PX : typeof window !== "undefined" && window.innerWidth < 768;
  const shownViews: readonly CalView[] = isCompact ? VIEWS.filter((v) => v !== "week") : VIEWS;
  const viewParam = params.get("view");
  const view: CalView = isView(viewParam) && shownViews.includes(viewParam) ? viewParam : isCompact ? "day" : "week";
  const dateParam = params.get("date");
  const [today] = useState(() => startOfDay(Date.now()));
  const anchor = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? new Date(`${dateParam}T00:00:00`).getTime() : today;
  const patch = useCallback((p: Record<string, string | null>) => {
    setParams((prev) => {
      const n = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(p)) { if (v === null) n.delete(k); else n.set(k, v); }
      return n;
    }, { replace: true });
  }, [setParams]);
  const setAnchor = (t: number) => patch({ date: isoDay(t) });

  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [calError, setCalError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [tick, setTick] = useState(0);
  const [colorBy, setColorBy] = useState<ColorBy>(() => { try { return (localStorage.getItem(COLOR_KEY) ?? "room") as ColorBy; } catch { return "room"; } });
  const [roomFilter, setRoomFilter] = useState<Record<number, boolean>>({});
  const [onlyMine, setOnlyMine] = useState(false);
  const [overlay, setOverlay] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<{ m: Meeting; x: number; y: number; history: { at: string; who: string; text: string }[] | null; files: MeetingFile[] } | null>(null);
  const [quick, setQuick] = useState<Draft | null>(null);
  const [editor, setEditor] = useState<{ draft: Draft; isNew: boolean } | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [conflict, setConflict] = useState<{ reply: ConflictReply; draft: Draft; isNew: boolean } | null>(null);
  const [scopeAsk, setScopeAsk] = useState<{ act: "save" | "cancel"; draft: Draft; m: Meeting } | null>(null);
  const [mine, setMine] = useState<{ meetings: Meeting[]; notifications: Notice[] } | null>(null);
  const [mineError, setMineError] = useState<string | null>(null);
  const [links, setLinks] = useState<GuestLink[] | null>(null);
  const [log, setLog] = useState<{ at: string; who: string; text: string }[] | null>(null);
  const [logError, setLogError] = useState<string | null>(null);
  const [roomEdit, setRoomEdit] = useState<{ form: RoomForm; future: number } | null>(null);
  const [linkEdit, setLinkEdit] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const flash = useCallback((t: string) => setToast(t), []);
  const showError = useCallback((e: unknown) => setToast(message(e)), []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 8000); return () => clearTimeout(t); }, [toast]);
  useEffect(() => { try { localStorage.setItem(COLOR_KEY, colorBy); } catch { /* a private window keeps the default */ } }, [colorBy]);
  useEffect(() => { const t = setInterval(() => { setNow(Date.now()); setTick((n) => n + 1); }, POLL_MS); return () => clearInterval(t); }, []);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    fresh<Bootstrap>("/api/meetings/bootstrap").then((b) => { if (live) { setBoot(b); setBootError(null); } }).catch((e) => live && setBootError(message(e)));
    return () => { live = false; };
  }, [tick]);

  const [from, to] = rangeFor(view, anchor);
  useEffect(() => {
    let live = true;
    const qs = `from=${encodeURIComponent(new Date(from).toISOString())}&to=${encodeURIComponent(new Date(to).toISOString())}`;
    fresh<{ meetings: Meeting[] }>(`/api/meetings/calendar?${qs}`).then((r) => { if (live) { setMeetings(r.meetings); setCalError(null); } }).catch((e) => live && setCalError(message(e)));
    return () => { live = false; };
  }, [from, to, tick]);

  useEffect(() => {
    if (tab !== "mine") return;
    let live = true;
    fresh<{ meetings: Meeting[]; notifications: Notice[] }>("/api/meetings/mine")
      .then((r) => { if (!live) return; setMine(r); setMineError(null); if (r.notifications.some((n) => !n.read)) api.post("/api/meetings/notifications/read").then(refreshMeetingsUnread).catch((e) => console.warn("[meetings] could not mark notifications read", e)); })
      .catch((e) => live && setMineError(message(e)));
    return () => { live = false; };
  }, [tab, tick]);
  useEffect(() => {
    if (tab !== "links") return;
    fresh<{ links: GuestLink[] }>("/api/meetings/links").then((r) => setLinks(r.links)).catch((e) => showError(e));
  }, [tab, tick, flash]);
  useEffect(() => {
    if (tab !== "log" || !boot?.canManage) return;
    fresh<{ log: { at: string; who: string; text: string }[] }>("/api/meetings/log").then((r) => { setLog(r.log); setLogError(null); }).catch((e) => setLogError(message(e)));
  }, [tab, tick, boot?.canManage]);

  const me = boot?.me ?? "";
  const rooms: Room[] = boot?.rooms ?? [];
  const people = useMemo(() => new Map((boot?.people ?? []).map((p) => [p.key, p])), [boot]);
  const companies = useMemo(() => [...new Set((boot?.people ?? []).map((p) => p.company).filter(Boolean))].sort(), [boot]);
  const colorOf = useCallback((m: Meeting) => meetingColor(m, colorBy, me, rooms, people, companies), [colorBy, me, rooms, people, companies]);
  const canChange = useCallback((m: Meeting) => m.organizer === me || m.bookedBy === me, [me]);
  const shown = meetings.filter((m) => {
    if (m.roomId && roomFilter[m.roomId] === false) return false;
    if (onlyMine && !peopleOf(m).includes(me) && !overlay.some((o) => peopleOf(m).includes(o))) return false;
    if (query) {
      const hay = `${m.title} ${peopleOf(m).map((k) => people.get(k)?.name ?? k).join(" ")} ${rooms.find((r) => r.id === m.roomId)?.name ?? ""} ${m.guest?.name ?? ""}`.toLowerCase();
      if (!hay.includes(query.toLowerCase())) return false;
    }
    return true;
  });
  const busyRoomsFor = (d: Draft) => new Set(meetings.filter((m) => m.id !== d.id && m.roomId && m.status !== "ended" && ms(m.start) < d.end && d.start < ms(m.end)).map((m) => m.roomId as number));
  const shownRooms = rooms.filter((r) => roomFilter[r.id] !== false);
  const freeRoomFor = (s: number, e: number) =>
    bestRoom(shownRooms.length ? shownRooms : rooms, 1, new Set(meetings.filter((m) => m.roomId && m.status !== "ended" && ms(m.start) < e && s < ms(m.end)).map((m) => m.roomId as number)))?.id ?? null;

  const uploadFiles = async (meetingId: number) => {
    if (!pendingFiles.length) return;
    const form = new FormData();
    for (const f of pendingFiles) form.append("files", f, f.name);
    await api.postForm(`/api/meetings/meetings/${meetingId}/files`, form);
    setPendingFiles([]);
  };

  /** Save a new or changed meeting; a conflict opens its dialog instead. */
  const save = async (d: Draft, isNew: boolean, scope: "one" | "following" = "one") => {
    setSaving(true);
    try {
      if (isNew) {
        const r = await api.post<{ ids: number[]; created: number; skipped: number }>("/api/meetings/meetings", draftBody(d));
        if (r.ids[0]) await uploadFiles(r.ids[0]).catch((e) => flash(`Booked, but the files did not upload: ${message(e)}`));
        flash(r.created > 1 ? `Booked ${r.created} meetings${r.skipped ? `; ${r.skipped} skipped because a room or person was busy` : ""}` : `Booked ${d.title || "(No title)"}`);
      } else {
        const r = await api.patch<{ changed: number; skipped: number }>(`/api/meetings/meetings/${d.id}`, { ...draftBody(d), scope });
        if (d.id) await uploadFiles(d.id).catch((e) => flash(`Saved, but the files did not upload: ${message(e)}`));
        flash(r.skipped ? `Saved ${r.changed}; ${r.skipped} later meetings kept their time because someone was busy` : `Saved ${d.title}`);
      }
      setQuick(null);
      setEditor(null);
      setConflict(null);
      reload();
    } catch (e) {
      const c = readConflict(e);
      if (c) setConflict({ reply: c, draft: d, isNew });
      else showError(e);
    } finally {
      setSaving(false);
    }
  };

  const act = async (m: Meeting, what: "start" | "end" | "cancel", scope: "one" | "following" = "one") => {
    setSaving(true);
    try {
      await api.post(`/api/meetings/meetings/${m.id}/${what}`, what === "cancel" ? { scope } : {});
      flash(what === "start" ? `Started ${m.title}` : what === "end" ? `Ended ${m.title}. The room is free from now.` : `Cancelled ${m.title}. Everyone in it was told.`);
      setDetail(null);
      reload();
    } catch (e) {
      showError(e);
    } finally {
      setSaving(false);
    }
  };

  const openMeeting = async (m: Meeting, x: number, y: number) => {
    setDetail({ m, x, y, history: null, files: [] });
    try {
      const r = await fresh<{ meeting: Meeting; history: { at: string; who: string; text: string }[]; files: MeetingFile[] }>(`/api/meetings/meetings/${m.id}`);
      setDetail((cur) => (cur && cur.m.id === m.id ? { ...cur, m: r.meeting, history: r.history, files: r.files } : cur));
    } catch { /* the popover still shows what the calendar had */ }
  };

  const newDraft = (s?: number, e?: number, roomId?: number | null) => {
    const start = s ?? nextStart(now, anchor);
    const end = e ?? start + 3_600_000;
    return emptyDraft(me, start, end, roomId !== undefined ? roomId : freeRoomFor(start, end));
  };

  const saveRoom = async (f: RoomForm) => {
    setSaving(true);
    setDialogError(null);
    try {
      const body = { name: f.name, location: f.location, address: f.address, floor: f.floor, seats: f.seats, equipment: f.equipment, days: f.days, openFrom: f.openFrom, openTo: f.openTo, color: f.color, bufferMin: f.bufferMin, maxHours: f.maxHours, advanceDays: f.advanceDays, active: f.active, closures: f.closures };
      if (f.id) await api.patch(`/api/meetings/rooms/${f.id}`, body); else await api.post("/api/meetings/rooms", body);
      flash(`Saved room ${f.name}`);
      setRoomEdit(null);
      reload();
    } catch (e) { setDialogError(message(e)); } finally { setSaving(false); }
  };
  const saveLink = async (l: LinkForm) => {
    setSaving(true);
    setDialogError(null);
    try {
      await api.post("/api/meetings/links", l);
      flash("Link created. Copy it from the list below.");
      setLinkEdit(false);
      reload();
    } catch (e) { setDialogError(message(e)); } finally { setSaving(false); }
  };

  const unread = boot?.unread ?? 0;
  const tabs = [
    { value: "calendar" as const, label: "Calendar" },
    { value: "mine" as const, label: unread ? `My meetings · ${unread}` : "My meetings" },
    { value: "rooms" as const, label: `Rooms · ${rooms.filter((r) => r.active).length}` },
    { value: "links" as const, label: "Guest links" },
    { value: "email" as const, label: "Email and WhatsApp", show: !!boot?.canManage },
    { value: "log" as const, label: "Change log", show: !!boot?.canManage },
  ];
  const step = (dir: number) => {
    if (view === "month") { const d = new Date(anchor); d.setMonth(d.getMonth() + dir, 1); setAnchor(d.getTime()); }
    else setAnchor(addDays(anchor, dir * (view === "week" ? 7 : view === "list" ? 7 : 1)));
  };
  const title = view === "day" || view === "rooms" ? (isCompact ? fmtDay(anchor) : fmtDayLong(anchor)) : `${MONTH_NAMES[new Date(view === "week" ? startOfWeek(anchor) + 3 * DAY : anchor).getMonth()]} ${new Date(anchor).getFullYear()}`;
  const days = view === "day" ? [startOfDay(anchor)] : Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i));
  const filterProps = {
    rooms, roomFilter, onRoomFilter: setRoomFilter, colorBy, onColorBy: setColorBy, companies, onlyMine, onOnlyMine: setOnlyMine,
    overlay, onOverlay: setOverlay, me, people, peopleList: boot?.people ?? [], onGuestLinks: () => patch({ tab: "links" }),
  };
  const cal = { meetings: shown, rooms, people, colorOf, now, onOpen: (m: Meeting, x: number, y: number) => void openMeeting(m, x, y) };

  if (bootError && !boot) {
    return <div className="p-6"><h1 className="mb-2 text-[22px] font-bold">Meetings</h1><p className="text-danger">{bootError}</p><button type="button" className={cn(BTN, "mt-3")} onClick={reload}>Try again</button></div>;
  }

  return (
    <div ref={setRootEl} className="flex min-h-0 flex-col" style={{ "--meet-mine": "var(--color-primary)", height: embedded ? "100%" : "calc(100dvh - 64px)" } as CSSProperties}>
      <div className={cn("px-4 sm:px-6", embedded ? "pt-1" : "pt-4")}>
        {!embedded && <h1 className="text-[22px] font-bold text-ink">Meetings</h1>}
        {!embedded && <p className="mb-2 text-[13px] text-muted-ink">Meeting rooms shared by every company. Book anyone from any company; they see it in their own ERP.</p>}
        <TabStrip value={tab} onChange={(v) => patch({ tab: v === "calendar" ? null : v })} options={tabs} className="mb-0" />
      </div>
      {tab === "calendar" && (
        <div className="flex min-h-0 flex-1 flex-col">
          <MeetingsToolbar isCompact={isCompact} title={title} view={view} views={shownViews} query={query} unread={unread}
            onToday={() => setAnchor(startOfDay(Date.now()))} onStep={step} onView={(v) => patch({ view: v })}
            onQuery={(q) => { setQuery(q); if (q) patch({ view: "list" }); }} onInbox={() => patch({ tab: "mine" })}
            activeFilterCount={rooms.filter((r) => r.active && roomFilter[r.id] === false).length + overlay.length + (onlyMine && !overlay.length ? 1 : 0)} onFilters={() => setIsFilterSheetOpen(true)} />
          {calError && <div className="bg-danger-bg px-4 py-2 text-[13px] text-danger">The calendar could not be loaded: {calError}</div>}
          <div className="flex min-h-0 flex-1">
            <aside className="meet-scroll hidden w-[248px] flex-none content-start gap-3.5 overflow-y-auto px-3.5 pb-3.5 pt-1 lg:grid">
              <button type="button" onClick={() => setEditor({ draft: newDraft(), isNew: true })} className={cn(BOOK_CTA, "h-11 w-full flex-none")}>
                <Plus size={18} aria-hidden="true" />Book a room
              </button>
              <MiniMonth key={`${new Date(anchor).getFullYear()}-${new Date(anchor).getMonth()}`} anchor={anchor} week={view === "week"} onPick={setAnchor} />
              <MeetingsFilters density="rail" {...filterProps} />
              <p className="text-[12px] leading-[17px] text-faint">Drag across empty time to book. Drag a meeting to move it, drag its bottom edge to change the length.</p>
            </aside>
            <section className="mx-2 mb-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-card lg:ml-0" aria-label="Calendar">
              {(view === "day" || view === "week") && (
                <TimeGrid {...cal} days={days} me={me} canChange={canChange}
                  onCreate={(s, e) => setQuick(newDraft(s, e))}
                  onMove={(m, s, e) => void save({ ...draftFrom(m), start: s, end: e }, false)} />
              )}
              {view === "month" && <MonthView {...cal} anchor={anchor} onDay={(d) => { setAnchor(d); patch({ view: "day" }); }} onCreate={(d) => setEditor({ draft: newDraft(atHour(d, 10), atHour(d, 11)), isNew: true })} />}
              {view === "rooms" && <RoomsTimeline {...cal} day={startOfDay(anchor)} onCreate={(s, e, rid) => setQuick(newDraft(s, e, rid))} />}
              {view === "list" && <ListView {...cal} query={query} />}
            </section>
          </div>
          <button type="button" onClick={() => setEditor({ draft: newDraft(), isNew: true })} className={cn(BOOK_CTA, "fixed bottom-[calc(92px+env(safe-area-inset-bottom))] right-4 z-30 h-12 px-5 shadow-lg lg:hidden")}><Plus size={18} aria-hidden="true" />Book a room</button>
        </div>
      )}
      {tab !== "calendar" && (
        <div className="flex-1 overflow-auto px-4 pb-10 pt-4 sm:px-6">
          {tab === "mine" && <MyMeetings meetings={mine?.meetings ?? null} notices={mine?.notifications ?? []} rooms={rooms} people={people} me={me} now={now} error={mineError}
            onOpen={(m) => { patch({ tab: null, view: "week", date: new Date(ms(m.start)).toISOString().slice(0, 10) }); void openMeeting(m, window.innerWidth / 2, 200); }} />}
          {tab === "rooms" && <RoomsPage rooms={rooms} meetings={meetings} now={now} canManage={!!boot?.canManage}
            onAdd={() => { setDialogError(null); setRoomEdit({ form: roomForm(null, rooms.length), future: 0 }); }}
            onEdit={(r) => { setDialogError(null); setRoomEdit({ form: roomForm(r, rooms.length), future: meetings.filter((m) => m.roomId === r.id && ms(m.start) > now).length }); }}
            onBook={(r) => { patch({ tab: null, view: "rooms" }); setEditor({ draft: newDraft(undefined, undefined, r.id), isNew: true }); }} />}
          {tab === "links" && <LinksPage links={links} rooms={rooms} people={people} origin={window.location.origin} flash={flash}
            onCreate={() => { setDialogError(null); setLinkEdit(true); }}
            onToggle={async (l) => { try { await api.patch(`/api/meetings/links/${l.id}`, { active: !l.active }); reload(); } catch (e) { showError(e); } }} />}
          {tab === "email" && <EmailPage erpName={erpName} />}
          {tab === "log" && <LogPage log={log} people={people} error={logError} />}
        </div>
      )}

      {detail && (
        <MeetingDetail m={detail.m} rooms={rooms} people={people} me={me} x={detail.x} y={detail.y} color={colorOf(detail.m)} history={detail.history} files={detail.files}
          canChange={canChange(detail.m)} busy={saving} onClose={() => setDetail(null)}
          onFile={(f) => { openLoadedTab(() => api.fetchBlobUrl(`/api/meetings/meetings/${detail.m.id}/files/${f.id}`, f.mime_type), 60_000).catch((e) => showError(e)); }}
          onEdit={() => { setPendingFiles([]); setEditor({ draft: draftFrom(detail.m), isNew: false }); setDetail(null); }}
          onCancel={() => (detail.m.seriesId ? setScopeAsk({ act: "cancel", draft: draftFrom(detail.m), m: detail.m }) : void act(detail.m, "cancel"))}
          onStart={() => void act(detail.m, "start")} onEnd={() => void act(detail.m, "end")} />
      )}
      {isFilterSheetOpen && tab === "calendar" && (
        <MeetingsFilterSheet {...filterProps} onClose={() => setIsFilterSheetOpen(false)}
          monthPicker={<MiniMonth key={`${new Date(anchor).getFullYear()}-${new Date(anchor).getMonth()}`} anchor={anchor} week={view === "week"} isTouch onPick={(d) => { setAnchor(d); setIsFilterSheetOpen(false); }} />} />
      )}
      {quick && <QuickBook draft={quick} rooms={rooms} people={boot?.people ?? []} busyRooms={busyRoomsFor(quick)} saving={saving} onClose={() => setQuick(null)} onMore={(d) => { setQuick(null); setPendingFiles([]); setEditor({ draft: d, isNew: true }); }} onSave={(d) => void save(d, true)} />}
      {editor && (
        <MeetingEditor draft={editor.draft} isNew={editor.isNew} me={me} rooms={rooms} people={boot?.people ?? []} peopleMap={people} meetings={meetings} now={now}
          makeMeet={boot?.meetConnected ? () => api.post<{ url: string }>("/api/meetings/meet-link").then((r) => r.url) : null}
          busyRooms={busyRoomsFor(editor.draft)} saving={saving} pendingFiles={pendingFiles} onFiles={setPendingFiles} onClose={() => setEditor(null)}
          onSave={(d) => {
            const orig = meetings.find((m) => m.id === d.id);
            if (!editor.isNew && d.seriesId && orig) setScopeAsk({ act: "save", draft: d, m: orig });
            else void save(d, editor.isNew);
          }} />
      )}
      {conflict && <ConflictDialog reply={conflict.reply} draft={conflict.draft} rooms={rooms} people={people} onClose={() => setConflict(null)} onApply={(d) => void save(d, conflict.isNew)} />}
      {scopeAsk && (
        <ScopeQuestion title={scopeAsk.m.title} act={scopeAsk.act} onClose={() => setScopeAsk(null)}
          onPick={(scope) => { const a = scopeAsk; setScopeAsk(null); if (a.act === "cancel") void act(a.m, "cancel", scope); else void save(a.draft, false, scope); }} />
      )}
      {roomEdit && <RoomDialog initial={roomEdit.form} locations={[...new Set(rooms.map((r) => r.location).filter(Boolean))]} futureBookings={roomEdit.future} saving={saving} error={dialogError} onClose={() => setRoomEdit(null)} onSave={(f) => void saveRoom(f)} />}
      {linkEdit && <LinkDialog rooms={rooms} people={boot?.people ?? []} me={me} saving={saving} error={dialogError} onClose={() => setLinkEdit(false)} onSave={(l) => void saveLink(l)} />}
      {toast && <div role="status" className="fixed bottom-5 left-1/2 z-[60] max-w-[calc(100vw-32px)] -translate-x-1/2 rounded-card bg-ink px-4 py-2.5 text-[13.5px] text-card shadow-lg">{toast}</div>}
    </div>
  );
}
