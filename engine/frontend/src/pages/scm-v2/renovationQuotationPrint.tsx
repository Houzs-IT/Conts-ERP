/* A quotation prints on the sales order's own PDF (owner, 17 Nov 2026: "整套系统应该只有一种"): the same Print preview,
   the same By item / By area / By category picker and the same generator (vendor/scm/lib/sales-order-pdf.ts), titled
   QUOTATION, with its payment terms and no payments block. */

import { useMemo, useState } from 'react';
import type { BrandProfile, DocHeader, DocSection, Instalment } from '../../lib/renovation/api';
import type { PdfAction } from '../../vendor/scm/lib/pdf-common';
import { categoryRooms, type SoPrintRooms } from '../../vendor/scm/lib/so-print-rooms';
import { useMfgProducts } from '../../vendor/scm/lib/mfg-products-queries';
import { useRenovationCatalog } from '../../vendor/scm/lib/renovation-catalog-queries';
import { useStaffLookup } from '../../hooks/useStaffLookup';
import { quotationLines, type QuotationLine } from './renovationQuotationForm';
import { SoPrintPreview } from './soPrintPreview';
import type { SoLinesView } from './renovationSoAreaLines';
import { fmtMoney } from './soDetailParts';
import { fmtDate } from '../renovation/shared';

const pdfText = (t: string): string => t.replace(/—/g, '-');

export function QuotationSoPrint({ open, onClose, docNo, status, header, sections, instalments, brand, kind = 'QUOTATION', reference = null }: {
  /** A variation order prints on this same PDF too (owner, 17 Nov 2026: "VO 的也是要一样"). */
  kind?: 'QUOTATION' | 'VARIATION_ORDER';
  /** The contract a variation order changes, printed as its Reference. */
  reference?: string | null;
  open: boolean;
  onClose: () => void;
  docNo: string;
  status: string;
  header: DocHeader;
  sections: readonly DocSection[];
  instalments: readonly Instalment[];
  brand: BrandProfile | undefined;
}) {
  const { nameOf } = useStaffLookup();
  const { rows, rooms } = useMemo(() => quotationLines(sections), [sections]);
  const [printLayout, setPrintLayout] = useState<SoLinesView>('area');
  const catalogQ = useMfgProducts({ enabled: open });
  const catalogNames = useRenovationCatalog();
  const categoryView = useMemo(() => {
    if (!catalogQ.data) return undefined;
    const products = new Map(catalogQ.data.map((p) => [p.code, { group: p.category_group || p.category, sub: p.sub_category }]));
    return categoryRooms(rows as never, (code) => products.get(code), { groups: catalogNames.groups, subs: catalogNames.all });
  }, [catalogQ.data, rows, catalogNames.groups, catalogNames.all]);
  const printRooms: SoPrintRooms | undefined = rooms.order.length > 0 ? rooms : undefined;
  const pdfRooms = printLayout === 'item' ? undefined : printLayout === 'category' ? categoryView ?? printRooms : printRooms;
  const netSen = rows.reduce((sum, r) => sum + Number(r.total_sen ?? 0), 0);
  const totalSen = netSen - (header.docDiscountSen || 0);

  const run = async (action: PdfAction) => {
    const items: Array<QuotationLine & { item_group: string; variants: null }> = rows.map((r) => {
      /* An omitted line takes money off: its price prints as a minus, as its amount does. */
      if (kind === 'VARIATION_ORDER' && Number(r.total_sen) < 0) {
        const unit = -Math.abs(Number(r.unit_price_sen));
        return { ...r, unit_price_sen: unit, discount_sen: Math.max(0, Math.round(Math.abs(unit * Number(r.qty))) - Math.abs(Number(r.total_sen))), item_group: 'RENOVATION', variants: null };
      }
      return { ...r, item_group: 'RENOVATION', variants: null };
    });
    /* The document discount prints as a line of its own, as the sales order carries it once converted. */
    if (header.docDiscountSen > 0) {
      items.push({
        id: 'quote-discount', item_code: 'RENO-DISCOUNT', description: header.docDiscountLabel || 'Discount', description2: null, uom: 'LOT', qty: 1,
        unit_price_sen: -header.docDiscountSen, discount_sen: 0, total_sen: -header.docDiscountSen, item_group: 'RENOVATION', variants: null,
      });
    }
    const [address1 = '', address2 = '', address3 = '', address4 = ''] = (header.siteAddress ?? '').split('\n');
    const soHeader = {
      doc_no: docNo, so_date: header.docDate, status, debtor_code: null, debtor_name: header.customerName, agent: null,
      branding: brand?.name ?? null, venue: null, ref: reference, po_doc_no: null, phone: header.customerPhone ?? null,
      address1: address1 || null, address2: address2 || null, address3: address3 || null, address4: address4 || null,
      mattress_sofa_sen: 0, bedframe_sen: 0, accessories_sen: 0, others_sen: 0, local_total_sen: totalSen,
      line_count: items.length, currency: 'MYR', note: null, sales_location: header.salesLocation ?? null, email: header.customerEmail ?? null,
      city: header.city ?? null, postcode: header.postcode ?? null, customer_state: header.state ?? null,
      salesperson_name: header.salespersonId ? nameOf(null, header.salespersonId, '') || null : null,
    };
    const contract = brand ? {
      brandName: brand.name, logoKey: brand.logoR2Key, letterhead: [...brand.companyLines, brand.contactLine].filter(Boolean), bankLine: brand.bankLine,
      termsLines: brand.termsLines, instalments: instalments.map((i) => ({ label: i.label, percent: `${i.pctBp / 100}%`, description: pdfText(i.description) })),
    } : undefined;
    const { generateSalesOrderPdf } = await import('../../vendor/scm/lib/sales-order-pdf');
    await generateSalesOrderPdf(soHeader, items, [], action, [], {
      docTitle: kind === 'VARIATION_ORDER' ? 'VARIATION ORDER' : 'QUOTATION', docNoun: kind === 'VARIATION_ORDER' ? 'variation order' : 'quotation',
      rooms: pdfRooms, contract, quotation: true,
    });
  };

  return (
    <SoPrintPreview
      open={open}
      onClose={onClose}
      docTitle={kind === 'VARIATION_ORDER' ? 'Variation Order' : 'Quotation'}
      docNo={docNo}
      companyName={brand?.name}
      rows={[
        { label: 'Customer', value: header.customerName || '—' },
        { label: kind === 'VARIATION_ORDER' ? 'VO date' : 'Quotation date', value: fmtDate(header.docDate) },
        { label: 'Items', value: `${rows.length} line${rows.length === 1 ? '' : 's'}` },
        { label: kind === 'VARIATION_ORDER' ? 'Contract changes by' : 'Quotation total', value: fmtMoney(totalSen, 'MYR') },
      ]}
      layout={{ printRooms, printLayout, setPrintLayout }}
      onViewPdf={() => run('preview')}
      onPrint={() => run('print')}
      onDownload={() => run('save')}
    />
  );
}
