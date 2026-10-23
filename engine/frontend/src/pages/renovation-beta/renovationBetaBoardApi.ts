/* Calls for the Beta Home and Calendar screens (docs/superpowers/plans/2026-10-23-beta-project-workspace.md,
   section 10). Shapes mirror the board routes in engine/backend/src/routes/renovationBeta.ts. */

import { api } from "../../api/client";
import { simpleApi } from "../projects/renovation/simpleApi";
import { betaApi } from "./renovationBetaApi";

export type DesignKind = "3d" | "2d";
export type AppointmentKind = "site_measure" | "carpentry_measure" | "site_briefing";
export type EventType = "client" | "measure" | "briefing" | "meeting" | "w3d" | "w2d" | "amend" | "po" | "update";

export interface BetaBoardPerson { id: number; name: string; roles: string[] }
export interface BetaBoardRef { id: number; name: string }

export interface BetaBoardAppointment {
  kind: AppointmentKind;
  onDate: string;
  atTime: string | null;
  personId: number | null;
  withText: string | null;
  doneAt: string | null;
}

export type BetaBoardPayment = { state: "hidden" } | { state: "none" } | { state: "ok"; label: string };

export interface BetaBoardProject {
  id: number;
  code: string | null;
  name: string;
  building: string | null;
  unitNo: string | null;
  customerName: string | null;
  salesName: string | null;
  createdOn: string | null;
  handoverOn: string | null;
  lead: BetaBoardRef | null;
  person3d: BetaBoardRef | null;
  person2d: BetaBoardRef | null;
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
  person3dId?: number | null;
  person2dId?: number | null;
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

type Ok = Promise<{ ok: true }>;
const B = "/api/beta";

export const boardApi = {
  board: (range?: BoardRange): Promise<BetaBoard> =>
    api.get<BetaBoard>(range ? `${B}/board?from=${range.from}&to=${range.to}` : `${B}/board`),
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
  person3dId: number | null;
  person2dId: number | null;
}

/** Assign: the design lead and site PIC on the project, the 3D and 2D people on the Beta design row. */
export async function assignPeople(projectId: number, a: AssignInput): Promise<void> {
  const { designerPersonId, picPersonId } = a;
  if (designerPersonId !== undefined || picPersonId !== undefined) {
    await simpleApi.setPeople(projectId, { ...(designerPersonId !== undefined ? { designerPersonId } : {}), ...(picPersonId !== undefined ? { picPersonId } : {}) });
  }
  await boardApi.saveDesign(projectId, { person3dId: a.person3dId, person2dId: a.person2dId });
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
