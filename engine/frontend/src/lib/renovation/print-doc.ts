/* Turns what the renovation API returns into the print model, with the
   brand's letterhead (logo from the brand's project-brand logo). */

import { parseMeasureMilli } from '../../vendor/shared/renovation-money';
import { ensureBrandLogoLoaded, getBrandLogoCache } from '../branding';
import type { BrandProfile, DocHeader, DocLine, DocSection, Instalment } from './api';
import type { PrintFormat } from './print-formats';
import type { DocKind, PrintBrand, PrintDoc, PrintLineInput, PrintSectionInput } from './print-model';

export function toPrintLine(l: DocLine): PrintLineInput {
  const m = l.measureMilli ?? (l.measure ? parseMeasureMilli(l.measure) : null);
  return {
    id: l.id, itemCode: l.itemCode, kind: l.kind, description: l.description, room: l.room, qty: l.qty,
    measureMilli: m !== null && !Number.isNaN(m) ? m : null, measureUom: l.measureUom, uom: l.uom,
    unitPriceSen: l.unitPriceSen, listPriceSen: l.listPriceSen, discountBp: l.discountBp, amountOverrideSen: l.amountOverrideSen,
    isFoc: l.isFoc, highlight: l.highlight, pageBreakBefore: l.pageBreakBefore, parentId: l.parentId ?? null,
    voChange: l.voChange ?? null, netSenOverride: l.voChange === 'OMIT' && typeof l.netSen === 'number' ? l.netSen : null,
  };
}

/** Sections as printed: lines a VO omitted (or whose SO row is cancelled) drop out. */
export function toPrintSections(sections: DocSection[]): PrintSectionInput[] {
  const printed = sections.map((s) => ({
    heading: s.heading, bandColor: s.bandColor, lumpSumSen: s.lumpSumSen, pageBreakBefore: s.pageBreakBefore,
    lines: s.lines.filter((l) => !l.omittedByVoId && !l.soItemCancelled).map(toPrintLine),
  })).filter((s) => s.lines.length > 0 || s.lumpSumSen !== null || s.heading);
  /* A VO that replaced a section's only line leaves that heading empty beside the new one of the same name. */
  return printed.filter((s) => s.lines.length > 0 || s.lumpSumSen !== null
    || !printed.some((o) => o !== s && o.heading === s.heading && o.lines.length > 0));
}

export type PrintLayout = 'item' | 'area' | 'category';
export const PRINT_LAYOUTS: ReadonlyArray<{ key: PrintLayout; label: string }> = [{ key: 'area', label: 'By area' }, { key: 'item', label: 'By item' }, { key: 'category', label: 'By category' }];

/** The sections a sales order prints in each layout (owner, 31 Oct 2026: by area unless asked). The document is drawn by
    area, so that is as it stands. A lump sum is one price for its lines, which cannot be regrouped. A child line stays
    with its parent. */
export function sectionsByLayout(sections: PrintSectionInput[], layout: PrintLayout, groupOf: (l: PrintLineInput) => string | null): PrintSectionInput[] {
  if (layout === 'area' || sections.some((s) => s.lumpSumSen !== null)) return sections;
  const lines = sections.flatMap((s) => s.lines);
  if (layout === 'item') return [{ heading: '', bandColor: null, lumpSumSen: null, lines }];
  const parentOf = new Map(lines.filter((l) => l.id).map((l) => [l.id!, l]));
  const groups = new Map<string, PrintLineInput[]>();
  for (const l of lines) {
    const owner = l.parentId ? parentOf.get(l.parentId) ?? l : l;
    const label = groupOf(owner) ?? 'Other';
    groups.set(label, [...(groups.get(label) ?? []), l]);
  }
  const named = [...groups].filter(([k]) => k !== 'Other');
  const other = groups.get('Other');
  return [...named, ...(other ? [['Other', other] as const] : [])].map(([heading, ls]) => ({ heading, bandColor: null, lumpSumSen: null, lines: ls }));
}

export async function printBrand(brand: BrandProfile | undefined): Promise<PrintBrand> {
  if (!brand) {
    return { name: 'The Conts', companyLines: [], contactLine: '', bankLine: '', termsLines: [], intro: 'We refer to our meeting with regards the above captioned matter and we are pleased to submit our quotation as follow : -', signatoryCompany: 'THE CONTS SDN BHD' };
  }
  if (brand.logoR2Key) await ensureBrandLogoLoaded(brand.logoR2Key);
  const logo = getBrandLogoCache(brand.logoR2Key);
  return {
    name: brand.name,
    logo: logo ? { dataUrl: logo.dataUrl, format: logo.format, width: logo.width, height: logo.height } : null,
    companyLines: brand.companyLines, contactLine: brand.contactLine, bankLine: brand.bankLine, termsLines: brand.termsLines,
    intro: brand.intro, signatoryCompany: brand.signatoryCompany,
  };
}

/** "Condo · 3 bed 2 bath · 1,100 sq ft" from a quotation header (mig 0116), '' when none of it is set. */
export function propertySummary(h: Partial<DocHeader>): string {
  const layout = h.layoutLabel || (h.bedrooms != null && h.bathrooms != null ? `${h.bedrooms} bed ${h.bathrooms} bath` : '');
  const sqft = h.builtUpSqft != null ? `${Number(h.builtUpSqft).toLocaleString('en-MY')} sq ft` : '';
  return [h.propertyType, layout, sqft].filter(Boolean).join(' · ');
}

export async function buildPrintDoc(p: {
  kind: DocKind; docNo: string; format: PrintFormat; brand: BrandProfile | undefined; header: Partial<DocHeader>; sections: DocSection[];
  instalments?: Instalment[]; reference?: string | null;
}): Promise<PrintDoc> {
  const h = p.header;
  return {
    kind: p.kind, docNo: p.docNo, format: p.format, brand: await printBrand(p.brand),
    header: {
      attention: h.attention ?? '', customerName: h.customerName ?? '', building: h.building ?? '', unitNo: h.unitNo ?? '',
      preparedBy: h.preparedBy ?? '', docDate: h.docDate ?? null, lastAmended: h.lastAmended ?? null, intro: h.intro ?? null,
      customerPhone: h.customerPhone ?? '', siteAddress: h.siteAddress ?? '', property: propertySummary(h),
    },
    sections: toPrintSections(p.sections),
    docDiscountSen: h.docDiscountSen ?? 0, docDiscountLabel: h.docDiscountLabel ?? '', promoLines: h.promoLines ?? [],
    instalments: (p.instalments ?? []).map((i) => ({ seq: i.seq, label: i.label, pctBp: i.pctBp, description: i.description })),
    reference: p.reference ?? null,
  };
}
