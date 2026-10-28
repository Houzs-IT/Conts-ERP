/* Calls for the Beta Home and Calendar screens (docs/superpowers/plans/2026-10-23-beta-project-workspace.md,
   section 10). Shapes mirror the board routes in engine/backend/src/routes/renovationBeta.ts.

   NAMING RULE: every Beta query key starts with "renovation-beta" (so "uq", "renovation-beta", ... once useQuery builds
   it). That name is what disk saving (lib/query-persist.ts isBetaKey), sign-out clearing and invalidateBeta all match.
   A Beta query named any other way is not saved, not cleared on sign-out and not refreshed after a write. */

import type { QueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { buildQueryKey } from "../../hooks/useQuery";
import { simpleApi } from "../projects/renovation/simpleApi";
import { betaApi } from "./renovationBetaApi";

export type DesignKind = "3d" | "2d";
export type AppointmentKind = "site_measure" | "carpentry_measure" | "site_briefing";
export type EventType = "client" | "measure" | "briefing" | "meeting" | "w3d" | "w2d" | "amend" | "po" | "update";

/** Every person of the company. `offered` (the project page's rule, routes/renovationProject.ts GET /people) is true
    only for people linked to an active user account; position and department come from that account. Older servers
    send neither, and then every person is offered. */
export interface BetaBoardPerson { id: number; name: string; roles: string[]; position?: string | null; department?: string | null; offered?: boolean }
export interface BetaBoardRef { id: number; name: string }

export interface BetaBoardAppointment {
  kind: AppointmentKind;
  onDate: string;
  atTime: string | null;
  personId: number | null;
  withText: string | null;
  doneAt: string | null;
}

export type BetaBoardPayment = { state: "hidden" } | { state: "none" } | { state: "ok"; label: string; outstandingSen?: number };

export interface BetaBoardProject {
  id: number;
  code: string | null;
  name: string;
  building: string | null;
  unitNo: string | null;
  customerName: string | null;
  salesName: string | null;
  createdOn: string | null;
  /** When the project was made (ISO); absent from an older server. */
  createdAt?: string | null;
  /** The project's sales order numbers, for the list's search. */
  soDocNos?: string[];
  handoverOn: string | null;
  lead: BetaBoardRef | null;
  /** The first of people3d / people2d. */
  person3d: BetaBoardRef | null;
  person2d: BetaBoardRef | null;
  /** Everyone drawing the 3D / the 2D, in the order picked (migration 0148). Older servers send only person3d/person2d. */
  people3d?: BetaBoardRef[];
  people2d?: BetaBoardRef[];
  sitePic: BetaBoardRef | null;
  measuredOn: string | null;
  start3dOn: string | null;
  start2dOn: string | null;
  poDoneOn: string | null;
  files: Array<{ id: number; kind: DesignKind; version: number; submittedOn: string }>;
  notes: Array<{ id: number; kind: DesignKind; notedOn: string; closedOn: string | null; days: number | null }>;
  reviews: Array<{ fileId: number; sentOn: string | null; approvedOn: string | null }>;
  appointments: BetaBoardAppointment[];
  payment: BetaBoardPayment;
}

export interface BetaBoardEvent {
  id: number;
  projectId: number | null;
  onDate: string;
  atTime: string | null;
  type: string;
  note: string | null;
  personId: number | null;
  done: boolean;
}

export interface BetaBoard {
  today: string;
  mePersonId: number | null;
  settings: { design3dDays: number; design2dDays: number; amendmentDays: number };
  people: BetaBoardPerson[];
  projects: BetaBoardProject[];
  events: BetaBoardEvent[];
}

export interface BoardRange { from: string; to: string }

export interface DesignPatch {
  start3dOn?: string | null;
  start2dOn?: string | null;
  poDoneOn?: string | null;
  /** Everyone drawing the 3D / the 2D, in order; an empty list clears it. */
  person3dIds?: number[];
  person2dIds?: number[];
}

export interface AppointmentBody { onDate: string; atTime: string | null; personId: number | null; withText: string | null }

export interface EventBody {
  projectId: number | null;
  onDate: string;
  atTime: string | null;
  type: EventType;
  note: string | null;
  personId: number | null;
}

/** The one query key of the board. Home, Calendar and the workspace all use it, so one write refreshes them all. */
export function boardKey(range?: BoardRange, projectId?: number): ReadonlyArray<string | number> {
  return ["renovation-beta", "board", range?.from ?? "", range?.to ?? "", projectId ?? 0];
}

/** What the workspace can show at once from the Home board already in the cache: the one project, its people and
    settings, and its own events. Home and the workspace both ask the server for the default date window, so the events
    cover the same days. `at` is the Home answer's own age, so a stale or disk-restored copy still refetches on mount.
    A Home answer a write has invalidated keeps its old data until the refetch lands, so it is seeded as stale (`at` 1):
    the screen paints at once and the mount refetches, never serving the pre-write answer as fresh.
    Undefined when Home was never loaded or does not list the project (the real fetch then answers, 404 included). */
export function projectBoardFromHome(queryClient: QueryClient, projectId: number): { data: BetaBoard; at: number } | undefined {
  const home = queryClient.getQueryState<BetaBoard>(buildQueryKey(boardKey()));
  const project = home?.data?.projects.find((x) => x.id === projectId);
  if (!home?.data || !project) return undefined;
  return { data: { ...home.data, projects: [project], events: home.data.events.filter((e) => e.projectId === projectId) }, at: home.isInvalidated ? 1 : home.dataUpdatedAt };
}

/** Refetch everything Beta shows (the board and the workspace queries) after a write. */
export function invalidateBeta(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: buildQueryKey(["renovation-beta"]) });
}

/** The browser remembers the last project opened in Beta, so the Projects menu entry can return to it. */
export const LAST_PROJECT_KEY = "beta:lastProject";

export function rememberLastProject(id: number): void {
  try {
    window.localStorage.setItem(LAST_PROJECT_KEY, String(id));
  } catch {
    /* storage can be blocked; the Projects entry then opens Home */
  }
}

export function forgetLastProject(): void {
  try {
    window.localStorage.removeItem(LAST_PROJECT_KEY);
  } catch {
    /* nothing to forget when storage is blocked */
  }
}

export function readLastProject(): number | null {
  try {
    const n = Number(window.localStorage.getItem(LAST_PROJECT_KEY));
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

type Ok = Promise<{ ok: true }>;
const B = "/api/beta";

export const boardApi = {
  /** The whole board, or with `projectId` just that project (the workspace). `range` limits the calendar events. */
  board: (range?: BoardRange, projectId?: number): Promise<BetaBoard> => {
    const qs = [range ? `from=${range.from}&to=${range.to}` : "", projectId ? `projectId=${projectId}` : ""].filter(Boolean).join("&");
    return api.get<BetaBoard>(qs ? `${B}/board?${qs}` : `${B}/board`);
  },
  saveDesign: (projectId: number, b: DesignPatch): Ok => api.put<{ ok: true }>(`${B}/projects/${projectId}/design`, b),
  saveNoteDays: (noteId: number, days: number): Ok => api.put<{ ok: true }>(`${B}/design-notes/${noteId}/days`, { days }),
  saveAppointment: (projectId: number, kind: AppointmentKind, b: AppointmentBody): Ok =>
    api.put<{ ok: true }>(`${B}/projects/${projectId}/appointments/${kind}`, b),
  appointmentDone: (projectId: number, kind: AppointmentKind): Ok =>
    api.post<{ ok: true }>(`${B}/projects/${projectId}/appointments/${kind}/done`, {}),
  deleteAppointment: (projectId: number, kind: AppointmentKind): Ok =>
    api.del<{ ok: true }>(`${B}/projects/${projectId}/appointments/${kind}`),
  addEvent: (b: EventBody): Promise<{ id: number }> => api.post<{ id: number }>(`${B}/events`, b),
  saveEvent: (id: number, b: Partial<EventBody> & { done?: boolean }): Ok => api.patch<{ ok: true }>(`${B}/events/${id}`, b),
  deleteEvent: (id: number): Ok => api.del<{ ok: true }>(`${B}/events/${id}`),
};

/** "PO done": the PO date of the project's Beta design row, set to the given day. */
export function markPoDone(projectId: number, today: string): Promise<{ ok: true }> {
  return boardApi.saveDesign(projectId, { poDoneOn: today });
}

export interface AmendmentInput {
  kind: DesignKind;
  startOn: string;
  days: number;
  note: string;
  /** The days the server falls back to when a round has no row. */
  defaultDays: number;
}

/** "+ Amendment": the existing design note, then the round's length when it is not the default. */
export async function addAmendment(projectId: number, a: AmendmentInput): Promise<void> {
  const { id } = await simpleApi.addDesignNote(projectId, {
    kind: a.kind, notedOn: a.startOn, requestedByPersonId: null, requestedByText: null, note: a.note,
  });
  if (a.days !== a.defaultDays) await boardApi.saveNoteDays(id, a.days);
}

export interface AssignInput {
  /** Only sent when the project has no design lead yet. */
  designerPersonId?: number;
  /** Only sent when the site PIC changed. */
  picPersonId?: number | null;
  person3dIds: number[];
  person2dIds: number[];
}

/** Assign: the design lead and site PIC on the project, the 3D and 2D people on the Beta design row. */
export async function assignPeople(projectId: number, a: AssignInput): Promise<void> {
  const { designerPersonId, picPersonId } = a;
  if (designerPersonId !== undefined || picPersonId !== undefined) {
    await simpleApi.setPeople(projectId, { ...(designerPersonId !== undefined ? { designerPersonId } : {}), ...(picPersonId !== undefined ? { picPersonId } : {}) });
  }
  await boardApi.saveDesign(projectId, { person3dIds: a.person3dIds, person2dIds: a.person2dIds });
}

/** "Client approved": the section 9 approval on the newest file of that kind. */
export async function approveNewest(
  project: BetaBoardProject,
  kind: DesignKind,
  approvedOn: string,
  approvedByName: string,
): Promise<void> {
  const newest = project.files.filter((f) => f.kind === kind).sort((a, b) => b.version - a.version)[0];
  if (!newest) throw new Error(`There is no ${kind.toUpperCase()} file yet. Upload it in Drawings first.`);
  await betaApi.designApproval(newest.id, { approvedOn, approvedByName });
}
