/* Client for /api/scm/renovation (engine/backend/src/scm/routes/renovation.ts):
   types, fetchers and react-query hooks for quotations, package templates, the
   renovation contract, billing, variation orders, PO split / schedule, payment
   terms and letterheads. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authedFetch } from '../../vendor/scm/lib/authed-fetch';
import type { RenoLineKind } from '../../vendor/shared/renovation-money';
import type { PrintFormat } from './print-formats';

export type Highlight = 'NONE' | 'GREY' | 'PINK';

export interface DocLine {
  id?: string;
  parentId?: string | null;
  kind: RenoLineKind;
  room: string;
  itemCode: string | null;
  description: string;
  qty: number;
  measure: string | null;
  measureMilli?: number | null;
  measureUom: string | null;
  uom: string | null;
  unitPriceSen: number;
  listPriceSen: number | null;
  discountBp: number;
  amountOverrideSen: number | null;
  isFoc: boolean;
  supplyByOwner: boolean;
  highlight: Highlight;
  supplierId: string | null;
  unitCostSen: number;
  stageCode: string | null;
  pageBreakBefore: boolean;
  voChange?: 'ADD' | 'OMIT' | null;
  omitTargetLineId?: string | null;
  omitQty?: number | null;
  // read-only, from the server
  baseSen?: number;
  netSen?: number;
  overridden?: boolean;
  soItemId?: string | null;
  voId?: string | null;
  omittedByVoId?: string | null;
  soItemCancelled?: boolean;
}

export interface DocSection {
  id?: string;
  heading: string;
  bandColor: string | null;
  lumpSumSen: number | null;
  pageBreakBefore: boolean;
  voId?: string | null;
  lines: DocLine[];
}

export interface Instalment {
  id?: string;
  seq: number;
  label: string;
  pctBp: number;
  description: string;
  stageCode: string | null;
  trigger: 'so_confirmed' | 'stage_start' | 'stage_done';
}

export interface DocTotals {
  listSen: number;
  netSen: number;
  docDiscountSen: number;
  finalSen: number;
  totalDiscountSen: number;
  overriddenLines: number;
}

export interface DocHeader {
  printFormat: PrintFormat;
  attention: string;
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  building: string;
  unitNo: string;
  preparedBy: string;
  docDate: string;
  lastAmended: string | null;
  validUntil?: string | null;
  intro: string | null;
  termsNote: string;
  termTemplateId: string | null;
  docDiscountSen: number;
  docDiscountLabel: string;
  promoLines: Array<{ text: string; color?: string | null }>;
  brandId?: number | null;
  /* Quotation customer + property block (mig 0116). */
  siteAddress?: string;
  propertyType?: string;
  layoutLabel?: string;
  bedrooms?: number | null;
  bathrooms?: number | null;
  builtUpSqft?: number | null;
}

export type QuotationStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';

export interface QuotationHead {
  id: string; quoteNo: string; projectId: number | null; brandId: number | null; status: QuotationStatus; currentRev: number;
  acceptedRev: number | null; convertedSoDocNo: string | null; lockedAt: string | null; templateId: string | null; version: number;
  createdAt: string; projectName?: string | null;
}

export interface QuotationListRow extends QuotationHead {
  docNo: string; customerName: string; building: string; unitNo: string; docDate: string; printFormat: PrintFormat; totalSen: number;
}

export interface Revision {
  id: string; revNo: number; docNo: string; frozenAt: string | null; header: DocHeader; sections: DocSection[];
  instalments: Instalment[]; totals: DocTotals;
}

export interface QuotationView {
  quotation: QuotationHead;
  revisions: Array<{ revNo: number; docNo: string; frozenAt: string | null; createdAt: string }>;
  revision: Revision;
  editable: boolean;
  /** Migration 0116 is in: the quotation keeps its site address and property. */
  propertyReady?: boolean;
}

export interface BillRow {
  instalmentId: string; seq: number; kind: 'INVOICE' | 'CREDIT_NOTE' | 'ZERO'; amountSen: number; invoiceDate: string;
  invoiceNumber: string | null; salesInvoiceId: string | null; noteNumber: string | null; creditNoteId: string | null;
  paidSen: number; invoiceStatus: string | null; noteStatus: string | null;
}

export interface BillingInstalment extends Instalment {
  id: string; cumBp: number; bill: BillRow | null; isNext: boolean; amountSen: number;
  /** Covered by what AutoCount invoiced before go-live: never billed here. */
  billedBeforeGoLive?: boolean;
}

/** A credit note that lowered the contract. */
export interface ContractCredit {
  creditNoteId: string | null; noteNumber: string | null; amountSen: number; noteDate: string | null; reason: string | null; noteStatus: string | null;
}

export interface BillingView {
  soDocNo: string; status: string; originalContractSen: number; revisedContractSen: number; voTotalSen: number;
  /** Net of contract credit notes, what AutoCount invoiced before go-live included. */
  billedSen: number; billedBeforeGoLiveSen?: number; creditedSen: number; credits: ContractCredit[];
  receivedSen: number; nextSeq: number | null; instalments: BillingInstalment[];
}

export type ContractStatus = 'RENO_CONFIRMED' | 'RENO_IN_PROGRESS' | 'RENO_COMPLETED' | 'CLOSED' | 'CANCELLED';

export interface ContractView {
  docNo: string; status: ContractStatus; soDate: string; debtorName: string; projectId: number | null; paidSen: number;
  header: DocHeader & { brandId: number | null; quoteDocNo: string | null; quotationId: string | null; originalContractSen: number; version: number };
  sections: DocSection[];
  instalments: Instalment[];
  variationOrders: Array<{ id: string; voNo: string; seq: number; status: VoStatus; title: string; docDate: string; netSen: number; approvedAt: string | null }>;
  openPoFlags: number;
  totals: DocTotals & { originalContractSen: number; revisedContractSen: number; voTotalSen: number };
  billing: BillingView;
}

export type VoStatus = 'DRAFT' | 'SENT' | 'APPROVED' | 'CANCELLED';

export interface VoView {
  id: string; voNo: string; soDocNo: string; seq: number; status: VoStatus; title: string; docDate: string; version: number;
  signedName: string | null; signedAt: string | null; approvedAt: string | null; approvedBy: string | null; amendmentId: string | null;
  sections: DocSection[]; totals: { addSen: number; omitSen: number; netSen: number };
}

export interface SplitLine {
  lineId: string; soItemId: string; itemCode: string; description: string; description2: string | null; uom: string; qty: number;
  unitCostSen: number; amountSen: number; supplierId: string | null; reason?: string;
}
export interface SplitPreview {
  /* One PO per supplier and category group (mig 0116). */
  groups: Array<{ categoryGroup?: string; supplierId: string; supplierCode: string; supplierName: string; lines: SplitLine[]; totalSen: number }>;
  blocked: SplitLine[]; skipped: SplitLine[]; alreadyOrdered: SplitLine[];
}

export interface PoFlag {
  id: string; action: 'AMEND' | 'CANCEL'; newQty: number | null; status: 'OPEN' | 'RESOLVED'; note: string; createdAt: string;
  resolvedAt: string | null; voNo: string; poNumber: string; purchaseOrderId: string; itemCode: string; qty: number;
}

export type PayableOn = 'ON_CONFIRM' | 'ON_RECEIPT' | 'ON_HANDOVER' | 'MANUAL';
export interface PoSchedule {
  po: { id: string; poNumber: string; status: string; totalSen: number; supplierId: string; supplierName: string | null; fullyReceived: boolean; projectId: number | null };
  handover: 'handed_over' | 'not_handed_over' | 'unknown';
  instalments: Array<{
    id: string; seq: number; label: string; pctBp: number; amountSen: number; payableOn: PayableOn; releasedAt: string | null;
    releasedBy: string | null; releaseNote: string; paidSen: number; outstandingSen: number; payable: boolean;
    payments: Array<{ id: string; amountSen: number; paidOn: string; note: string; paymentVoucherId: string | null; pvNumber: string | null }>;
  }>;
  totals: { scheduledSen: number; paidSen: number; payableNowSen: number };
}

export interface TermTemplate {
  id: string; kind: 'CUSTOMER' | 'PO'; name: string; isDefault: boolean; active: boolean;
  lines: Array<{ seq: number; label: string; pctBp: number; description: string; stageCode: string | null; trigger: string; payableOn: string | null }>;
}

export interface BrandProfile {
  brandId: number; name: string; color: string; logoR2Key: string | null; active: boolean; hasProfile: boolean;
  companyLines: string[]; contactLine: string; bankLine: string; termsLines: string[]; intro: string; signatoryCompany: string;
}

export interface ProductPick {
  code: string; name: string; category: string; group: string | null; subCategory: string | null; uom: string | null;
  costSen: number; sellPriceSen: number; supplierId: string | null; supplierName: string | null;
}

export interface TemplateView {
  id: string; name: string; brandId: number | null; description: string; printFormat: PrintFormat; termTemplateId: string | null;
  docDiscountSen: number; docDiscountLabel: string; promoLines: Array<{ text: string; color?: string | null }>; active: boolean;
  sections: DocSection[]; instalments: Instalment[]; totals: DocTotals;
}

const BASE = '/renovation';
const send = <T>(path: string, method: string, body?: unknown) =>
  authedFetch<T>(`${BASE}${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });
export const renoGet = <T>(path: string) => authedFetch<T>(`${BASE}${path}`);
export const renoSend = send;

/** The server's machine code and detail on a refusal (authedFetch keeps the raw body on the error). */
export function refusalOf(err: unknown): { code: string | null; message: string; detail: Record<string, unknown> } {
  const e = err as { message?: string; body?: string } | null | undefined;
  let detail: Record<string, unknown> = {};
  try { detail = JSON.parse(e?.body ?? '{}'); } catch { /* not JSON */ }
  return { code: typeof detail.error === 'string' ? detail.error : null, message: (typeof detail.message === 'string' ? detail.message : e?.message) ?? 'Something went wrong.', detail };
}

export const qk = {
  quotations: (f: Record<string, unknown>) => ['reno', 'quotations', f] as const,
  quotation: (id: string, rev?: number) => ['reno', 'quotation', id, rev ?? 'current'] as const,
  templates: ['reno', 'templates'] as const,
  template: (id: string) => ['reno', 'template', id] as const,
  contract: (docNo: string) => ['reno', 'contract', docNo] as const,
  poSplit: (docNo: string) => ['reno', 'po-split', docNo] as const,
  poFlags: (docNo: string) => ['reno', 'po-flags', docNo] as const,
  vo: (id: string) => ['reno', 'vo', id] as const,
  terms: ['reno', 'terms'] as const,
  brands: ['reno', 'brands'] as const,
  poSchedule: (poId: string) => ['reno', 'po-schedule', poId] as const,
};

export function useQuotations(f: { projectId?: number | null; status?: string | null; q?: string | null }) {
  const params = new URLSearchParams();
  if (f.projectId) params.set('projectId', String(f.projectId));
  if (f.status) params.set('status', f.status);
  if (f.q) params.set('q', f.q);
  return useQuery({ queryKey: qk.quotations(f), queryFn: () => renoGet<{ quotations: QuotationListRow[] }>(`/quotations?${params}`), staleTime: 15_000 });
}

export function useQuotation(id: string | undefined, rev?: number) {
  return useQuery({ queryKey: qk.quotation(id ?? '', rev), queryFn: () => renoGet<QuotationView>(`/quotations/${id}${rev ? `?rev=${rev}` : ''}`), enabled: Boolean(id) });
}

export function useTemplates() {
  return useQuery({ queryKey: qk.templates, queryFn: () => renoGet<{ templates: Array<{ id: string; name: string; brandId: number | null; description: string; printFormat: PrintFormat; active: boolean; updatedAt: string }> }>('/templates'), staleTime: 60_000 });
}

export function useTemplate(id: string | undefined) {
  return useQuery({ queryKey: qk.template(id ?? ''), queryFn: () => renoGet<TemplateView>(`/templates/${id}`), enabled: Boolean(id) });
}

export function useContract(docNo: string | undefined) {
  return useQuery({ queryKey: qk.contract(docNo ?? ''), queryFn: () => renoGet<ContractView>(`/sales-orders/${encodeURIComponent(docNo!)}`), enabled: Boolean(docNo) });
}

export function usePoSplit(docNo: string | undefined, enabled: boolean) {
  return useQuery({ queryKey: qk.poSplit(docNo ?? ''), queryFn: () => renoGet<SplitPreview>(`/sales-orders/${encodeURIComponent(docNo!)}/po-split`), enabled: Boolean(docNo) && enabled });
}

/** How a contract change was posted to the project's accounts, as convert / VO approve / post-contract answer it. */
export type ContractPosting = { ok?: boolean; status: string; reason?: string };

/** The warning to show when a saved change did not post (null when it posted, had nothing to post, or the contract
    predates the ledger start). */
export function contractPostingWarning(p: ContractPosting | undefined): string | null {
  if (!p || ['posted', 'already_posted', 'nothing', 'before_ledger_start'].includes(p.status)) return null;
  return `The contract was saved but not posted: ${p.reason ?? p.status}. Finance can post it again from the contract.`;
}

export type ContractPostingState =
  | { ok: true; status: 'before_ledger_start'; reason: string }
  | { ok: true; status: 'in_step' | 'under_posted'; contractSen: number; postedSen: number; uncleared?: number }
  | { ok: false; status: string; reason: string };

/** Finance only: whether the ledger carries the contract as it stands. */
export function useContractPosting(docNo: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['reno', 'contract-posting', docNo ?? ''] as const,
    queryFn: () => renoGet<ContractPostingState>(`/sales-orders/${encodeURIComponent(docNo!)}/contract-posting`),
    enabled: Boolean(docNo) && enabled,
  });
}

export function usePoFlags(docNo: string | undefined) {
  return useQuery({ queryKey: qk.poFlags(docNo ?? ''), queryFn: () => renoGet<{ flags: PoFlag[] }>(`/sales-orders/${encodeURIComponent(docNo!)}/po-flags`), enabled: Boolean(docNo) });
}

export function useVo(id: string | undefined) {
  return useQuery({ queryKey: qk.vo(id ?? ''), queryFn: () => renoGet<VoView>(`/variation-orders/${id}`), enabled: Boolean(id) });
}

export function useTerms() {
  return useQuery({ queryKey: qk.terms, queryFn: () => renoGet<{ templates: TermTemplate[] }>('/terms'), staleTime: 60_000 });
}

export function useBrands() {
  return useQuery({ queryKey: qk.brands, queryFn: () => renoGet<{ brands: BrandProfile[] }>('/brands'), staleTime: 60_000 });
}

export function usePoSchedule(poId: string | undefined) {
  return useQuery({ queryKey: qk.poSchedule(poId ?? ''), queryFn: () => renoGet<PoSchedule>(`/purchase-orders/${poId}/schedule`), enabled: Boolean(poId), retry: false });
}

export function searchProducts(q: string) {
  return renoGet<{ products: ProductPick[] }>(`/lookups/products?q=${encodeURIComponent(q)}`);
}

export function searchProjects(q: string) {
  return renoGet<{ projects: Array<{ id: number; code: string | null; name: string; stage: string; status: string; contractDocNo: string | null }> }>(`/lookups/projects?q=${encodeURIComponent(q)}`);
}

/** A mutation that invalidates every renovation query on success. */
export function useRenoMutation<TVars, TResult = unknown>(fn: (v: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['reno'] }); },
  });
}

/** Strip read-only fields before sending a structure back. */
export function sectionsForSave(sections: DocSection[]): unknown[] {
  return sections.map((s) => ({
    heading: s.heading, bandColor: s.bandColor, lumpSumSen: s.lumpSumSen, pageBreakBefore: s.pageBreakBefore,
    lines: s.lines.map((l) => ({
      kind: l.kind, room: l.room, itemCode: l.itemCode, description: l.description, qty: l.qty, measure: l.measure, measureUom: l.measure ? l.measureUom : null,
      uom: l.uom, unitPriceSen: l.unitPriceSen, listPriceSen: l.listPriceSen, discountBp: l.discountBp, amountOverrideSen: l.amountOverrideSen,
      isFoc: l.isFoc, supplyByOwner: l.supplyByOwner, highlight: l.highlight, supplierId: l.supplierId, unitCostSen: l.unitCostSen,
      stageCode: l.stageCode, pageBreakBefore: l.pageBreakBefore,
      ...(l.voChange ? { voChange: l.voChange, omitTargetLineId: l.omitTargetLineId ?? null, omitQty: l.omitQty ?? null } : {}),
    })),
  }));
}

export function instalmentsForSave(rows: Instalment[]): unknown[] {
  return rows.map((r) => ({ seq: r.seq, label: r.label, pctBp: r.pctBp, description: r.description, stageCode: r.stageCode, trigger: r.trigger }));
}

/** The status moves the contract page offers. Cancel contract from Confirmed or In progress (chew, 30 Oct 2026); the
    server holds it until the contract and its documents are posted (acc/reno-ledger cancelGate). */
export const CONTRACT_NEXT_STATUS: Record<string, Array<{ to: string; label: string; danger?: boolean }>> = {
  RENO_CONFIRMED: [{ to: 'RENO_IN_PROGRESS', label: 'Works started' }, { to: 'CANCELLED', label: 'Cancel contract', danger: true }],
  RENO_IN_PROGRESS: [{ to: 'RENO_COMPLETED', label: 'Works completed' }, { to: 'CANCELLED', label: 'Cancel contract', danger: true }],
  RENO_COMPLETED: [{ to: 'CLOSED', label: 'Close contract' }],
};

export const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft', SENT: 'Sent', ACCEPTED: 'Accepted', REJECTED: 'Rejected', EXPIRED: 'Expired', APPROVED: 'Approved', CANCELLED: 'Cancelled',
  RENO_CONFIRMED: 'Confirmed', RENO_IN_PROGRESS: 'In progress', RENO_COMPLETED: 'Completed', CLOSED: 'Closed',
};
