/* A saved quotation, cloned from the sales order's detail page (owner, 6 Nov 2026): the same header, tabs, Order info,
   customer and address cards, dark total card, line views and payment cards, built from the same parts with the words
   changed. A sales order reads /mfg-sales-orders and a quotation its sections, so the lines are converted here.
   Edit opens the sales order's form (SalesOrderNew) on ?edit=1. */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useStaffLookup } from '../../hooks/useStaffLookup';
import { DocAttachments } from '../../components/doc-attachments/DocAttachments';
import { coverageStateOf } from '../../components/coverage-state';
import { DataTable } from '../../components/DataTable';
import { DetailAside, DetailGrid, DetailMain, Section } from '../../components/DetailLayout';
import { refusalOf, useQuotation, type QuotationView } from '../../lib/renovation/api';
import { PRINT_FORMATS } from '../../lib/renovation/print-formats';
import { DATA_TABLE_LAYOUT_FAMILIES } from '../../components/dataTableLayoutFamilies';
import { categoryRooms, roomOrdered } from '../../vendor/scm/lib/so-print-rooms';
import { useMfgProducts } from '../../vendor/scm/lib/mfg-products-queries';
import { useRenovationCatalog } from '../../vendor/scm/lib/renovation-catalog-queries';
import { soInfoApi } from '../projects/renovation/customerPropertyApi';
import { fmtDate } from '../renovation/shared';
import { QuotationActions, QuotationNotices } from './renovationQuotationChrome';
import { blockFromQuote, quotationLines, type QuotationLine } from './renovationQuotationForm';
import { RenovationOrderInfoCells } from './RenovationSoOrderInfo';
import { SoAreaLines, SoLinesViewToggle, type SoLinesView } from './renovationSoAreaLines';
import { SoInstalments } from './renovationSoInstalments';
import {
  AsideCard, Field, fmtMoney, initialsOf, KeyDateRow, OrderTotalCard, PersonRow, soLineColumns, SoAddressFields, SoCustomerFields, SoDetailHeader,
} from './soDetailParts';
import { SalesOrderNew } from './SalesOrderNew';

const STATUS: Record<string, { tone: 'success' | 'warning' | 'error' | 'neutral'; label: string; blurb: string }> = {
  DRAFT: { tone: 'neutral', label: 'Draft', blurb: 'Draft, not sent' },
  SENT: { tone: 'warning', label: 'Sent', blurb: 'Sent, waiting on the customer' },
  ACCEPTED: { tone: 'success', label: 'Accepted', blurb: 'Accepted by the customer' },
  REJECTED: { tone: 'error', label: 'Rejected', blurb: 'Rejected' },
  EXPIRED: { tone: 'error', label: 'Expired', blurb: 'Expired' },
};
const LINE_COLUMNS = ['item', 'qty', 'unit', 'disc', 'total', 'photos'];
const AREA_COLUMNS = ['item', 'qty', 'unit', 'disc', 'total'];

function QuotationView_({ view }: { view: QuotationView }) {
  const { quotation, revision, revisions } = view;
  const { header } = revision;
  const navigate = useNavigate();
  const [, setParams] = useSearchParams();
  const { can } = useAuth();
  const { nameOf } = useStaffLookup();
  const canQuote = can('scm.renovation.quote');
  const [tab, setTab] = useState<'quotation' | 'revisions'>('quotation');
  const [linesView, setLinesView] = useState<SoLinesView>('item');
  const { rows, rooms } = useMemo(() => quotationLines(revision.sections), [revision.sections]);
  /* By category, built as the sales order builds it; by area until the catalog has loaded. */
  const catalogQ = useMfgProducts({ enabled: true });
  const catalogNames = useRenovationCatalog();
  const categoryView = useMemo(() => {
    if (!catalogQ.data) return undefined;
    const products = new Map(catalogQ.data.map((p) => [p.code, { group: p.category_group || p.category, sub: p.sub_category }]));
    return categoryRooms(rows as never, (code) => products.get(code), { groups: catalogNames.groups, subs: catalogNames.all });
  }, [catalogQ.data, rows, catalogNames.groups, catalogNames.all]);
  const project = useQuery({
    queryKey: ['reno', 'so-info', 'project', quotation.projectId],
    queryFn: () => soInfoApi.project(quotation.projectId!),
    enabled: quotation.projectId != null,
    staleTime: 30_000,
  });
  const info = blockFromQuote(header, quotation.projectId);
  const status = STATUS[quotation.status] ?? STATUS.DRAFT;
  const totals = revision.totals;
  const money = (sen: number) => fmtMoney(sen, 'MYR');
  const columns = soLineColumns<QuotationLine>({ docNo: revision.docNo, docId: undefined, currency: 'MYR', status: quotation.status, coverage: coverageStateOf({ isLoading: false }) });
  const lineColumns = columns.filter((c) => LINE_COLUMNS.includes(c.key));
  const shownCount = rows.length;
  const editable = view.editable && canQuote;

  return (
    <div>
      <SoDetailHeader
        title={header.customerName || revision.docNo}
        docNo={revision.docNo}
        status={status}
        meta={[`Quotation date ${fmtDate(header.docDate)}`, `${shownCount} line${shownCount === 1 ? '' : 's'}`, ...(quotation.projectName ? [quotation.projectName] : [])]}
        onBack={() => navigate('/scm/renovation/quotations')}
        actions={<QuotationActions view={view} canQuote={canQuote} editable={editable} sections={revision.sections} header={header} instalments={revision.instalments}
          brandId={quotation.brandId} onEdit={() => setParams((p) => { p.set('edit', '1'); return p; })} />}
      />

      <div className="space-y-3 pt-3">
        <QuotationNotices view={view} editable={editable} />
        <div className="flex gap-1 border-b border-border">
          {(['quotation', 'revisions'] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)}
              style={{
                padding: '8px 16px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 'var(--fs-13)', fontWeight: 600,
                color: tab === t ? 'var(--c-burnt)' : 'var(--fg-muted)', borderBottom: `2px solid ${tab === t ? 'var(--c-burnt)' : 'transparent'}`, marginBottom: -1,
              }}>
              {t === 'quotation' ? 'Quotation' : 'Revisions'}
            </button>
          ))}
        </div>

        {tab === 'revisions' ? (
          <Section title={`Revisions · ${revisions.length}`}>
            <ul className="divide-y divide-border-subtle">
              {revisions.map((r) => (
                <li key={r.revNo} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                  <button type="button" className="font-mono font-semibold text-primary hover:underline"
                    onClick={() => { setParams(r.revNo === quotation.currentRev ? {} : { rev: String(r.revNo) }); setTab('quotation'); }}>{r.docNo}</button>
                  <span className="text-ink-muted">{r.frozenAt ? `Frozen ${fmtDate(r.frozenAt)}` : 'Open'} · created {fmtDate(r.createdAt)}</span>
                </li>
              ))}
            </ul>
          </Section>
        ) : (
          <div className="space-y-3">
            <DetailGrid>
              <DetailMain>
                <Section title="Order info">
                  <RenovationOrderInfoCells info={info} project={project.data?.project ?? null} payment={null} />
                </Section>
                <div className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-2 [&>section]:h-full">
                  <Section title="Customer">
                    <SoCustomerFields renoMode sharedWith={null} salesperson={nameOf(null, header.salespersonId || null, '—')}
                      header={{ debtor_name: header.customerName, phone: header.customerPhone ?? null, email: header.customerEmail ?? null, salesperson_id: header.salespersonId || null }} />
                  </Section>
                  <Section title="Delivery address">
                    <SoAddressFields header={{ address1: info.address1, address2: info.address2, city: info.city, postcode: info.postcode, customer_state: info.state, customer_country: info.country, sales_location: info.salesLocation }} />
                  </Section>
                </div>
              </DetailMain>
              <DetailAside>
                <div className="hidden space-y-3 md:block lg:sticky lg:top-[124px]">
                  <OrderTotalCard header={{ currency: 'MYR', status: quotation.status }} title="Quotation total" statusShown={status}
                    subtotalSen={totals.netSen} discountSen={totals.docDiscountSen} totalSen={totals.finalSen} />
                  <AsideCard title="Key dates">
                    <KeyDateRow k="Quotation date" v={fmtDate(header.docDate)} />
                    <KeyDateRow k="Valid until" v={header.validUntil ? fmtDate(header.validUntil) : 'Not set'} muted={!header.validUntil} />
                    <KeyDateRow k="Last amended" v={header.lastAmended ? fmtDate(header.lastAmended) : 'Not set'} muted={!header.lastAmended} />
                  </AsideCard>
                  <AsideCard title="People">
                    {header.preparedBy && <PersonRow initials={initialsOf(header.preparedBy)} name={header.preparedBy} role="Prepared by" tone="accent" />}
                    {header.customerName && <PersonRow initials={initialsOf(header.customerName)} name={header.customerName} role="Customer" />}
                  </AsideCard>
                </div>
              </DetailAside>
            </DetailGrid>

            <Section title={`Line items · ${shownCount}`} actions={<SoLinesViewToggle view={linesView} onChange={setLinesView} />}>
              {linesView === 'item' ? (
                <DataTable<QuotationLine>
                  tableId={`quotation-lines-${quotation.id}`}
                  layoutFamily={DATA_TABLE_LAYOUT_FAMILIES.salesOrderLines} persistSort={false} persistFilters={false}
                  rows={roomOrdered(rows, rooms)}
                  loading={false}
                  columns={[{ key: 'room', label: 'Room', alwaysVisible: true, getValue: (l) => rooms.byItem[l.id] ?? '', render: (l) => <span className="text-[12.5px] font-semibold text-ink">{rooms.byItem[l.id] || '—'}</span> }, ...lineColumns]}
                  getRowKey={(l) => l.id}
                  emptyLabel="No line items"
                />
              ) : (
                <SoAreaLines<QuotationLine> items={rows} rooms={linesView === 'category' ? categoryView ?? rooms : rooms} money={money} columns={columns.filter((c) => AREA_COLUMNS.includes(c.key))} />
              )}
            </Section>

            <DocAttachments docType="quotation" docId={quotation.id} canEdit={canQuote} />

            <Section title="Payment schedule">
              <SoInstalments money={money} rows={revision.instalments.map((i) => ({ seq: i.seq, label: i.label, pctBp: i.pctBp, amountSen: Math.round((totals.finalSen * i.pctBp) / 10000), paidSen: 0 }))} />
            </Section>

            <Section title="Quotation details">
              <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-3">
                <Field label="Attention" value={header.attention || '—'} muted={!header.attention} />
                <Field label="Prepared by" value={header.preparedBy || '—'} muted={!header.preparedBy} />
                <Field label="Print format" value={PRINT_FORMATS[header.printFormat].label} />
                {header.docDiscountSen > 0 && <Field label={header.docDiscountLabel || 'Discount'} value={money(header.docDiscountSen)} />}
                {header.intro && <Field label="Intro sentence" value={header.intro} />}
              </div>
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}

export function RenovationQuotationDetail() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const rev = params.get('rev') ? Number(params.get('rev')) : undefined;
  const q = useQuotation(id, rev);
  if (params.get('edit') === '1') return <SalesOrderNew asQuotation />;
  if (!q.data) return <div className="p-8 text-center text-[13px] text-ink-muted">{q.error ? refusalOf(q.error).message : 'Loading quotation…'}</div>;
  return <QuotationView_ view={q.data} />;
}
