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
    kind: l.kind, description: l.description, room: l.room, qty: l.qty,
    measureMilli: m !== null && !Number.isNaN(m) ? m : null, measureUom: l.measureUom, uom: l.uom,
    unitPriceSen: l.unitPriceSen, listPriceSen: l.listPriceSen, discountBp: l.discountBp, amountOverrideSen: l.amountOverrideSen,
    isFoc: l.isFoc, highlight: l.highlight, pageBreakBefore: l.pageBreakBefore, parentId: l.parentId ?? null,
    voChange: l.voChange ?? null, netSenOverride: l.voChange === 'OMIT' && typeof l.netSen === 'number' ? l.netSen : null,
  };
}

/** Sections as printed: lines a VO omitted (or whose SO row is cancelled) drop out. */
export function toPrintSections(sections: DocSection[]): PrintSectionInput[] {
  return sections.map((s) => ({
    heading: s.heading, bandColor: s.bandColor, lumpSumSen: s.lumpSumSen, pageBreakBefore: s.pageBreakBefore,
    lines: s.lines.filter((l) => !l.omittedByVoId && !l.soItemCancelled).map(toPrintLine),
  })).filter((s) => s.lines.length > 0 || s.lumpSumSen !== null || s.heading);
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
    },
    sections: toPrintSections(p.sections),
    docDiscountSen: h.docDiscountSen ?? 0, docDiscountLabel: h.docDiscountLabel ?? '', promoLines: h.promoLines ?? [],
    instalments: (p.instalments ?? []).map((i) => ({ seq: i.seq, label: i.label, pctBp: i.pctBp, description: i.description })),
    reference: p.reference ?? null,
  };
}
