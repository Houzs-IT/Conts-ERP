/* Credit and debit notes (owner 2026-09-05 / 2026-09-12; docs/bugs/0827):
   CN and DN to a customer, SCN from a supplier — raised as drafts, posted
   through the one gate, cancelled by contra. The server half is
   backend/src/scm/routes/credit-notes.ts. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authedFetch } from './authed-fetch';
import { idempotentInit } from '../../../lib/idempotency';
import { retryUnlessClientError } from '../../../lib/retryPolicy';

export type NoteKind = 'CN' | 'DN' | 'SCN';
export type NoteStatus = 'DRAFT' | 'POSTED' | 'CANCELLED';

export type CreditNote = {
  id: string; note_number: string; kind: NoteKind;
  party_type: 'CUSTOMER' | 'SUPPLIER'; party_code: string | null; party_name: string | null;
  supplier_id: string | null; so_doc_no: string | null; sales_invoice_id: string | null;
  ap_invoice_id: string | null; purchase_invoice_id: string | null; source_doc_no: string | null;
  /** The final invoice's number when the note answers one — read for the print (docs/bugs/0834). */
  sales_invoice_number?: string | null;
  note_date: string; total_sen: number; reason: string | null; notes: string | null;
  status: NoteStatus; je_no: string | null;
  created_at: string; created_by: string | null; posted_at: string | null; cancelled_at: string | null;
  /** A posted CN / SCN on the list: what its knock-offs used, and the credit left. */
  appliedSen?: number; unusedSen?: number;
  /** A customer note that answers a deposit invoice knocks off nothing. */
  depositPaper?: DepositPaperKind | null;
};
export type CreditNoteLine = { id: string; line_no: number; description: string | null; account_code: string; amount_sen: number };
export type CreditNoteLineInput = { description?: string | null; accountCode?: string | null; amountSen: number };
export type CreditNoteCreate = {
  kind: NoteKind; noteDate: string; reason?: string | null; sourceDocNo?: string | null; notes?: string | null;
  soDocNo?: string | null; salesInvoiceId?: string | null; partyName?: string | null; partyCode?: string | null;
  supplierId?: string | null; lines: CreditNoteLineInput[];
  /** The knock-off ticks — the draft's plan, carried out by the post. */
  allocations?: KnockOffTarget[];
};

/* Knock off like an AP Payment (ported from Houzs ERP) — one row per invoice the
   note can take from: a supplier's purchase (PI) / AP (API) invoices, a
   customer's sales invoices (SI). */
export type CreditDocKind = 'PI' | 'API' | 'SI';
/** Why a customer note knocks off nothing: it closed a deposit invoice at the
    final invoice, or took a deposit back for a refund or a move. */
export type DepositPaperKind = 'closes' | 'refund' | 'move';
export type CreditAllocation = {
  id: string; kind: CreditDocKind; docId: string; number: string | null;
  docDate?: string | null; docTotalSen?: number | null;
  amountSen: number; appliedSen: number; createdAt: string | null; createdBy: string | null;
};
export type KnockOffRow = {
  kind: CreditDocKind; id: string; number: string; invoiceRef: string | null; invoiceDate: string | null;
  totalSen: number;
  /** What the invoice owes before THIS note — the most the note can take from it. */
  owedSen: number;
  /** What this note takes off it: applied once posted, planned while a draft. */
  noteSen: number;
  status: string;
};
export type KnockOffTarget = { kind: CreditDocKind; id: string; amountSen: number };
export type NoteKnockOff = {
  rows: KnockOffRow[]; totalSen: number; takenSen: number; leftSen: number; posted: boolean;
  /** Why a deposit paper has no table (the server's sentence). */
  refusal?: string;
};
export type CreditNoteDetail = {
  note: CreditNote; lines: CreditNoteLine[];
  /** A CN / SCN: where its credit went, and what is left. */
  allocations?: CreditAllocation[]; appliedSen?: number; leftSen?: number;
  depositPaper?: { kind: DepositPaperKind; di: string | null } | null;
};

const KEY = 'credit-notes';
const invalidate = (qc: ReturnType<typeof useQueryClient>) => {
  void qc.invalidateQueries({ queryKey: [KEY] });
  /* A knock-off moves what invoices owe: the invoice lists and Outstanding read again. */
  void qc.invalidateQueries({ queryKey: ['sales-invoices'] });
  void qc.invalidateQueries({ queryKey: ['outstanding'] });
  void qc.invalidateQueries({ queryKey: ['purchase-invoices'] });
  void qc.invalidateQueries({ queryKey: ['ap-invoices'] });
  void qc.invalidateQueries({ queryKey: ['journal-entries'] });
  void qc.invalidateQueries({ queryKey: ['gl-entries'] });
};

export const useCreditNotes = (kind: NoteKind | 'ALL', status: NoteStatus | 'ALL') => useQuery({
  queryKey: [KEY, kind, status],
  queryFn: () => authedFetch<{ rows: CreditNote[] }>(`/credit-notes?kind=${kind === 'ALL' ? '' : kind}&status=${status === 'ALL' ? '' : status}`),
  staleTime: 15_000,
  retry: retryUnlessClientError,
});

export const useCreditNoteDetail = (id: string | null) => useQuery({
  queryKey: [KEY, 'detail', id],
  enabled: id != null,
  queryFn: () => authedFetch<CreditNoteDetail>(`/credit-notes/${id}`),
  staleTime: 0,
  retry: retryUnlessClientError,
});

export const useCreateCreditNote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ idempotencyKey, ...body }: CreditNoteCreate & { idempotencyKey?: string }) =>
      authedFetch<{ ok: boolean; note: CreditNote }>('/credit-notes', idempotentInit(idempotencyKey, { method: 'POST', body: JSON.stringify(body) })),
    onSuccess: () => invalidate(qc),
  });
};

export const useUpdateCreditNote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; noteDate?: string; reason?: string | null; sourceDocNo?: string | null; notes?: string | null; lines?: CreditNoteLineInput[]; allocations?: KnockOffTarget[] }) =>
      authedFetch<{ ok: boolean; note: CreditNote }>(`/credit-notes/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => invalidate(qc),
  });
};

export const usePostCreditNote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => authedFetch<{
      ok: boolean; jeNo: string; status: string;
      /** The draft's knock-off carried out at post: what came off each invoice, and what could not. */
      applied?: Array<{ kind: CreditDocKind; id: string; number: string; appliedSen: number }>; notApplied?: string;
    }>(`/credit-notes/${id}/post`, { method: 'POST', body: '{}' }),
    onSuccess: () => invalidate(qc),
  });
};

export const useCancelCreditNote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => authedFetch<{ ok: boolean }>(`/credit-notes/${id}/cancel`, { method: 'POST', body: '{}' }),
    onSuccess: () => invalidate(qc),
  });
};

/** A note's knock-off table — what it takes from each invoice, and the credit left. */
export const useCreditNoteKnockOff = (noteId: string | null) => useQuery({
  queryKey: [KEY, 'knock-off', noteId],
  enabled: !!noteId,
  queryFn: () => authedFetch<NoteKnockOff>(`/credit-notes/${noteId}/knock-off`),
  staleTime: 0,
  retry: retryUnlessClientError,
});

/** PUT /credit-notes/:id/allocations — the knock-off set whole (untick = give it
    back). The lists are read again before the caller hears it went through. */
export const useSetCreditNoteAllocations = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ noteId, targets }: { noteId: string; targets: KnockOffTarget[] }) =>
      authedFetch<{ ok: boolean; short: Array<{ number: string; askedSen: number; appliedSen: number }> }>(`/credit-notes/${noteId}/allocations`, { method: 'PUT', body: JSON.stringify({ targets }) }),
    onSuccess: async () => {
      invalidate(qc);
      await qc.invalidateQueries({ queryKey: [KEY, 'knock-off'] });
    },
  });
};
