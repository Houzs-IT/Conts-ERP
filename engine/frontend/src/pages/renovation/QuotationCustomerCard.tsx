/* The quotation's customer + property block (owner, 14 Oct 2026, "batch 4"; mig 0116): customer, phone, email, site
   address, building, unit, property type, layout and built-up sq ft, kept on the quotation revision and copied onto
   the sales order when it is converted. A new quotation for a project starts from the project's values (server
   side); "Use the project's details" fills them again from the project at any time. The pick lists are the ones
   Project Maintenance keeps (the SO and the project read the same). */

import { useEffect, useId, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '../../lib/utils';
import { PhoneInput } from '../../vendor/scm/components/PhoneInput';
import { parseCount, parseSqft } from '../../vendor/shared/renovation-property';
import type { DocHeader } from '../../lib/renovation/api';
import { soInfoApi, useSoInfoLists } from '../projects/renovation/customerPropertyApi';
import type { LayoutOption, ProjectShared } from '../projects/renovation/customerPropertyModel';

/** The form's value: every field as typed (numbers stay text until saved). */
export interface QuoteParty {
  customerName: string; customerPhone: string; customerEmail: string; siteAddress: string; building: string; unitNo: string;
  propertyType: string; layoutLabel: string; bedrooms: string; bathrooms: string; builtUpSqft: string;
}

const numText = (n: number | null | undefined) => (n == null ? '' : String(n));

/** The form's value from the quotation header. */
export function partyFromHeader(h: DocHeader): QuoteParty {
  return {
    customerName: h.customerName, customerPhone: h.customerPhone ?? '', customerEmail: h.customerEmail ?? '',
    siteAddress: h.siteAddress ?? '', building: h.building, unitNo: h.unitNo, propertyType: h.propertyType ?? '',
    layoutLabel: h.layoutLabel ?? '', bedrooms: numText(h.bedrooms), bathrooms: numText(h.bathrooms), builtUpSqft: numText(h.builtUpSqft),
  };
}

/** The header patch for a form value, and the problems that keep it from saving. */
export function headerFromParty(v: QuoteParty): { patch: Partial<DocHeader>; problems: string[] } {
  const bedrooms = parseCount(v.bedrooms);
  const bathrooms = parseCount(v.bathrooms);
  const sqft = parseSqft(v.builtUpSqft);
  const problems: string[] = [];
  if (Number.isNaN(bedrooms) || Number.isNaN(bathrooms)) problems.push('Pick the layout again: its bedroom or bathroom count is not a whole number.');
  if (Number.isNaN(sqft)) problems.push('Built-up sq ft must be a number above 0, with at most 2 decimals.');
  return {
    patch: {
      customerName: v.customerName, customerPhone: v.customerPhone, customerEmail: v.customerEmail.trim(), siteAddress: v.siteAddress,
      building: v.building, unitNo: v.unitNo, propertyType: v.propertyType, layoutLabel: v.layoutLabel,
      bedrooms: Number.isNaN(bedrooms) ? null : bedrooms, bathrooms: Number.isNaN(bathrooms) ? null : bathrooms,
      builtUpSqft: Number.isNaN(sqft) ? null : sqft,
    },
    problems,
  };
}

/** The project's values over the form's, where the project has one. */
export function partyFromProject(v: QuoteParty, p: ProjectShared): QuoteParty {
  const pick = (mine: string, theirs: string) => (theirs.trim() ? theirs : mine);
  const site = p.siteAddress || [p.address1, p.address2, [p.postcode, p.city, p.state].filter(Boolean).join(' ')].filter(Boolean).join('\n');
  return {
    customerName: pick(v.customerName, p.customerName), customerPhone: pick(v.customerPhone, p.customerPhone),
    customerEmail: pick(v.customerEmail, p.customerEmail), siteAddress: pick(v.siteAddress, site), building: pick(v.building, p.building),
    unitNo: pick(v.unitNo, p.unitNo), propertyType: pick(v.propertyType, p.propertyType), layoutLabel: pick(v.layoutLabel, p.layoutLabel),
    bedrooms: pick(v.bedrooms, numText(p.bedrooms)), bathrooms: pick(v.bathrooms, numText(p.bathrooms)), builtUpSqft: pick(v.builtUpSqft, numText(p.builtUpSqft)),
  };
}

const input = 'h-9 w-full min-w-0 rounded-md border border-border bg-surface px-2.5 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-surface-dim disabled:text-ink-secondary';

function Cell({ label, className, children, htmlFor }: { label: string; className?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <label htmlFor={htmlFor} className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-secondary">{label}</label>
      {children}
    </div>
  );
}

const layoutOf = (v: QuoteParty, layouts: readonly LayoutOption[]) =>
  layouts.find((l) => l.label.toLowerCase() === v.layoutLabel.trim().toLowerCase() && String(l.bedrooms) === v.bedrooms && String(l.bathrooms) === v.bathrooms)
  ?? layouts.find((l) => l.active && String(l.bedrooms) === v.bedrooms && String(l.bathrooms) === v.bathrooms) ?? null;

export function QuotationCustomerCard({ header, projectId, disabled, onChange, resetKey }: {
  header: DocHeader;
  projectId: number | null;
  disabled: boolean;
  /** The header patch to apply, and what still keeps the quotation from saving ([] when fine). */
  onChange: (patch: Partial<DocHeader>, problems: string[]) => void;
  /** Changes when the quotation is (re)loaded from the server: the form then shows the saved values again. */
  resetKey: string;
}) {
  const uid = useId();
  const id = (k: string) => `${uid}-${k}`;
  const lists = useSoInfoLists().data;
  const [value, setValue] = useState<QuoteParty>(() => partyFromHeader(header));
  /* A reload from the server (save, revision switch) resets the typed text; typing does not. */
  useEffect(() => { setValue(partyFromHeader(header)); }, [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const proj = useQuery({
    queryKey: ['reno', 'so-info', 'project', projectId],
    queryFn: () => soInfoApi.project(projectId!),
    enabled: projectId != null,
    staleTime: 30_000,
  });
  const push = (v: QuoteParty) => {
    setValue(v);
    const r = headerFromParty(v);
    onChange(r.patch, r.problems);
  };
  const set = (patch: Partial<QuoteParty>) => push({ ...value, ...patch });
  const problems = headerFromParty(value).problems;
  const types = lists?.propertyTypes ?? [];
  const layouts = lists?.layouts ?? [];
  const picked = layoutOf(value, layouts);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-4">
        <Cell label="Customer name" className="col-span-2" htmlFor={id('name')}>
          <input id={id('name')} className={input} value={value.customerName} disabled={disabled} onChange={(e) => set({ customerName: e.target.value })} />
        </Cell>
        <Cell label="Phone" className="col-span-2">
          <PhoneInput className={input} value={value.customerPhone} onChange={(v) => set({ customerPhone: v })} disabled={disabled} aria-label="Phone" />
        </Cell>
        <Cell label="Email" className="col-span-2" htmlFor={id('email')}>
          <input id={id('email')} type="email" className={input} value={value.customerEmail} disabled={disabled} onChange={(e) => set({ customerEmail: e.target.value })} />
        </Cell>
        <Cell label="Site address" className="col-span-2" htmlFor={id('site')}>
          <textarea id={id('site')} rows={2} className={cn(input, 'h-auto py-2')} value={value.siteAddress} disabled={disabled}
            placeholder="Unit, street, area" onChange={(e) => set({ siteAddress: e.target.value })} />
        </Cell>
        <Cell label="Building" className="col-span-2" htmlFor={id('building')}>
          <input id={id('building')} className={input} value={value.building} disabled={disabled} placeholder="e.g. Skyline Residence" onChange={(e) => set({ building: e.target.value })} />
        </Cell>
        <Cell label="Unit" htmlFor={id('unit')}>
          <input id={id('unit')} className={input} value={value.unitNo} disabled={disabled} placeholder="A-12-3" onChange={(e) => set({ unitNo: e.target.value })} />
        </Cell>
        <Cell label="Property type" htmlFor={id('ptype')}>
          <select id={id('ptype')} className={input} value={value.propertyType} disabled={disabled} onChange={(e) => set({ propertyType: e.target.value })}>
            <option value="">Choose...</option>
            {value.propertyType && !types.some((t) => t.label === value.propertyType) && <option value={value.propertyType}>{value.propertyType}</option>}
            {types.filter((t) => t.active || t.label === value.propertyType).map((t) => <option key={t.id} value={t.label}>{t.label}</option>)}
          </select>
        </Cell>
        <Cell label="Layout" className="col-span-2" htmlFor={id('layout')}>
          <select id={id('layout')} className={input} value={picked ? String(picked.id) : value.layoutLabel ? 'custom' : ''} disabled={disabled}
            onChange={(e) => {
              if (e.target.value === 'custom') return;
              const l = layouts.find((x) => String(x.id) === e.target.value);
              set(l ? { layoutLabel: l.label, bedrooms: String(l.bedrooms), bathrooms: String(l.bathrooms) } : { layoutLabel: '', bedrooms: '', bathrooms: '' });
            }}>
            <option value="">Choose...</option>
            {!picked && value.layoutLabel && <option value="custom">{value.layoutLabel}</option>}
            {layouts.filter((l) => l.active || l.id === picked?.id).map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </Cell>
        <Cell label="Built-up sq ft" htmlFor={id('sqft')}>
          <input id={id('sqft')} inputMode="decimal" className={input} value={value.builtUpSqft} disabled={disabled} placeholder="e.g. 1,100"
            onChange={(e) => set({ builtUpSqft: e.target.value.replace(/[^\d.,]/g, '') })} />
        </Cell>
      </div>
      {problems.length > 0 && <p role="alert" className="text-[12.5px] text-err">{problems.join(' ')}</p>}
      {!disabled && projectId != null && proj.data && (
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-secondary">
          <button type="button" onClick={() => push(partyFromProject(value, proj.data.project))}
            className="inline-flex h-8 items-center rounded-md border border-border bg-surface px-3 font-semibold text-ink-secondary hover:border-primary hover:text-primary">
            Use the project's details
          </button>
          <span>Fills every field the project has from {proj.data.project.code ?? 'the project'}.</span>
        </div>
      )}
    </div>
  );
}
