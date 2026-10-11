/* Header form, payment-term (instalment) editor and totals panel shared by the
   quotation, template and contract screens. */

import { Plus, Trash2 } from 'lucide-react';
import { RENO_STAGES, STAGE_LABEL } from '../../vendor/shared/renovation-stages';
import { docTotals, parseMeasureMilli } from '../../vendor/shared/renovation-money';
import type { BrandProfile, DocHeader, DocSection, Instalment, TermTemplate } from '../../lib/renovation/api';
import { PRINT_FORMAT_LIST, PRINT_FORMATS, type PrintFormat } from '../../lib/renovation/print-formats';
import { BAND_COLOURS } from './DocEditor';
import { Card, Field, inputCls, MoneyInput, PercentInput, pctLabel, rm } from './shared';
import { cn } from '../../lib/utils';

export function totalsOfSections(sections: DocSection[], docDiscountSen: number) {
  return docTotals(sections.map((s) => ({
    lumpSumSen: s.lumpSumSen,
    lines: s.lines.filter((l) => !l.omittedByVoId && !l.soItemCancelled).map((l) => {
      const m = l.measure ? parseMeasureMilli(l.measure) : null;
      return {
        kind: l.kind, qty: l.qty, measureMilli: m !== null && !Number.isNaN(m) ? m : null, measureUom: l.measureUom, uom: l.uom,
        unitPriceSen: l.unitPriceSen, discountBp: l.discountBp, amountOverrideSen: l.amountOverrideSen, isFoc: l.isFoc,
      };
    }),
  })), docDiscountSen);
}

export function HeaderForm({ header, onChange, disabled, brands, brandId, onBrand, hideCustomer, priceLocked }: {
  header: DocHeader; onChange: (p: Partial<DocHeader>) => void; disabled?: boolean; brands: BrandProfile[]; brandId: number | null;
  onBrand?: (id: number | null) => void; hideCustomer?: boolean; priceLocked?: boolean;
}) {
  const set = (k: keyof DocHeader) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => onChange({ [k]: e.target.value } as Partial<DocHeader>);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {!hideCustomer && <Field label="Customer (To)"><input className={inputCls} disabled={disabled} value={header.customerName} onChange={set('customerName')} placeholder="Customer name" /></Field>}
      {!hideCustomer && <Field label="Attention"><input className={inputCls} disabled={disabled} value={header.attention} onChange={set('attention')} /></Field>}
      {!hideCustomer && <Field label="Building"><input className={inputCls} disabled={disabled} value={header.building} onChange={set('building')} placeholder="AVA" /></Field>}
      {!hideCustomer && <Field label="Unit"><input className={inputCls} disabled={disabled} value={header.unitNo} onChange={set('unitNo')} placeholder="B31-09" /></Field>}
      {!hideCustomer && <Field label="Prepared by"><input className={inputCls} disabled={disabled} value={header.preparedBy} onChange={set('preparedBy')} /></Field>}
      {!hideCustomer && <Field label="Date"><input type="date" className={inputCls} disabled={disabled} value={header.docDate ?? '' /* eslint-disable-line @typescript-eslint/no-unnecessary-condition -- doc_date from the server may be null on a fresh draft */} onChange={set('docDate')} /></Field>}
      {!hideCustomer && <Field label="Last amended"><input type="date" className={inputCls} disabled={disabled} value={header.lastAmended ?? ''} onChange={(e) => onChange({ lastAmended: e.target.value || null })} /></Field>}
      {onBrand && (
        <Field label="Letterhead">
          <select className={inputCls} disabled={disabled} value={brandId ?? ''} onChange={(e) => onBrand(e.target.value ? Number(e.target.value) : null)}>
            <option value="">— choose —</option>
            {brands.map((b) => <option key={b.brandId} value={b.brandId}>{b.name}</option>)}
          </select>
        </Field>
      )}
      <Field label="Default print format">
        <select className={inputCls} disabled={disabled} value={header.printFormat} onChange={(e) => onChange({ printFormat: e.target.value as PrintFormat })}>
          {PRINT_FORMAT_LIST.map((f) => <option key={f} value={f}>{PRINT_FORMATS[f].label}</option>)}
        </select>
      </Field>
      <Field label="Document discount" hint={priceLocked ? 'Changed through a variation order' : 'e.g. showroom discount'}>
        <MoneyInput value={header.docDiscountSen} disabled={disabled || priceLocked} onChange={(v) => onChange({ docDiscountSen: v ?? 0 })} />
      </Field>
      <Field label="Discount label"><input className={inputCls} disabled={disabled} value={header.docDiscountLabel} onChange={set('docDiscountLabel')} placeholder="SHOW ROOM DISCOUNT" /></Field>
      <Field label="Intro sentence" className="sm:col-span-2 lg:col-span-4">
        <input className={inputCls} disabled={disabled} value={header.intro ?? ''} onChange={(e) => onChange({ intro: e.target.value || null })} placeholder="Letterhead default" />
      </Field>
      <PromoLines lines={header.promoLines} disabled={disabled} onChange={(promoLines) => onChange({ promoLines })} />
    </div>
  );
}

function PromoLines({ lines, onChange, disabled }: { lines: Array<{ text: string; color?: string | null }>; onChange: (l: Array<{ text: string; color?: string | null }>) => void; disabled?: boolean }) {
  return (
    <div className="sm:col-span-2 lg:col-span-4">
      <div className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-ink-muted">Promotion lines (printed on the last page)</div>
      <div className="space-y-1.5">
        {lines.map((l, i) => (
          <div key={i} className="flex gap-2">
            <input className={cn(inputCls, "flex-1")} disabled={disabled} value={l.text} onChange={(e) => onChange(lines.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} placeholder="FREE UPGRADE TO MELAMINE E0 - CARPENTRY WORK" />
            <select aria-label="Colour" className={cn(inputCls, 'w-[120px]')} disabled={disabled} value={l.color ?? ''} onChange={(e) => onChange(lines.map((x, j) => (j === i ? { ...x, color: e.target.value || null } : x)))}>
              {BAND_COLOURS.map((c) => <option key={c.label} value={c.value ?? ''}>{c.label}</option>)}
            </select>
            {!disabled && <button type="button" aria-label="Remove promotion line" onClick={() => onChange(lines.filter((_, j) => j !== i))} className="rounded px-2 text-ink-muted hover:text-err"><Trash2 size={15} /></button>}
          </div>
        ))}
        {!disabled && lines.length < 10 && (
          <button type="button" onClick={() => onChange([...lines, { text: '', color: '#ffe08a' }])} className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary"><Plus size={13} /> Add promotion line</button>
        )}
      </div>
    </div>
  );
}

const TRIGGERS: Array<{ value: Instalment['trigger']; label: string }> = [
  { value: 'so_confirmed', label: 'when the SO is confirmed' },
  { value: 'stage_start', label: 'when the stage starts' },
  { value: 'stage_done', label: 'when the stage is done' },
];

export function InstalmentEditor({ rows, onChange, disabled, terms, totalSen }: {
  rows: Instalment[]; onChange: (r: Instalment[]) => void; disabled?: boolean; terms: TermTemplate[]; totalSen: number;
}) {
  const sum = rows.reduce((s, r) => s + r.pctBp, 0);
  const customer = terms.filter((t) => t.kind === 'CUSTOMER' && t.active);
  const apply = (id: string) => {
    const t = customer.find((x) => x.id === id);
    if (!t) return;
    onChange(t.lines.map((l) => ({ seq: l.seq, label: l.label, pctBp: l.pctBp, description: l.description, stageCode: l.stageCode, trigger: (l.trigger as Instalment['trigger'] | null) ?? 'stage_start' })));
  };
  let cum = 0;
  return (
    <div className="space-y-2">
      {!disabled && customer.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
          <span className="text-ink-muted">Start from template:</span>
          {customer.map((t) => (
            <button key={t.id} type="button" onClick={() => apply(t.id)} className="rounded-full border border-border px-2.5 py-0.5 font-semibold text-ink-secondary hover:border-primary hover:text-primary">{t.name}</button>
          ))}
        </div>
      )}
      <div className="space-y-2">
        {rows.map((r, i) => {
          cum += r.pctBp;
          return (
            <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border border-border-subtle p-2 md:grid-cols-[110px_80px_1fr_190px_190px_110px_32px] md:items-start">
              <input aria-label="Instalment label" className={inputCls} disabled={disabled} value={r.label} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} placeholder={`${i + 1}ST PAYMENT`} />
              <PercentInput ariaLabel="Percent" value={r.pctBp} disabled={disabled} onChange={(bp) => onChange(rows.map((x, j) => (j === i ? { ...x, pctBp: bp } : x)))} />
              <textarea aria-label="Description" rows={2} className={cn(inputCls, 'col-span-2 h-auto py-1.5 md:col-span-1')} disabled={disabled} value={r.description} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
              <select aria-label="Stage" className={inputCls} disabled={disabled} value={r.stageCode ?? ''} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, stageCode: e.target.value || null } : x)))}>
                <option value="">No stage</option>
                {RENO_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
              </select>
              <select aria-label="Trigger" className={inputCls} disabled={disabled} value={r.trigger} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, trigger: e.target.value as Instalment['trigger'] } : x)))}>
                {TRIGGERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <div className="text-right text-[12px] tabular-nums text-ink-secondary md:pt-2">
                <div className="font-semibold text-ink">{rm(Math.round((totalSen * r.pctBp) / 10000))}</div>
                <div>cum. {pctLabel(cum)}</div>
              </div>
              {!disabled && <button type="button" aria-label="Remove instalment" onClick={() => onChange(rows.filter((_, j) => j !== i).map((x, j) => ({ ...x, seq: j + 1 })))} className="rounded p-1.5 text-ink-muted hover:text-err md:mt-1"><Trash2 size={15} /></button>}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {!disabled && <button type="button" onClick={() => onChange([...rows, { seq: rows.length + 1, label: '', pctBp: Math.max(0, 10000 - sum), description: '', stageCode: null, trigger: 'stage_start' }])} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-primary"><Plus size={14} /> Add instalment</button>}
        <span className={cn('ml-auto text-[12.5px] font-semibold', sum === 10000 ? 'text-synced' : 'text-err')}>Total {pctLabel(sum)}{sum !== 10000 ? ' (must be 100%)' : ''}</span>
      </div>
    </div>
  );
}

export function TotalsCard({ sections, docDiscountSen, extra }: { sections: DocSection[]; docDiscountSen: number; extra?: React.ReactNode }) {
  const t = totalsOfSections(sections, docDiscountSen);
  return (
    <Card title="Totals">
      <dl className="space-y-1.5 text-[13px]">
        <div className="flex justify-between"><dt className="text-ink-secondary">List total</dt><dd className="tabular-nums">{rm(t.listSen)}</dd></div>
        <div className="flex justify-between"><dt className="text-ink-secondary">Line discounts / FOC</dt><dd className="tabular-nums">{rm(t.listSen - t.netSen)}</dd></div>
        {t.docDiscountSen > 0 && <div className="flex justify-between"><dt className="text-ink-secondary">Document discount</dt><dd className="tabular-nums">- {rm(t.docDiscountSen)}</dd></div>}
        <div className="flex justify-between border-t border-border-subtle pt-1.5 text-[15px] font-semibold"><dt>Final total</dt><dd className="tabular-nums">{rm(t.finalSen)}</dd></div>
        {t.overriddenLines > 0 && <div className="rounded bg-warning-bg px-2 py-1 text-[12px] text-warning-text">{t.overriddenLines} line(s) carry a typed amount that differs from measure x rate (marked *).</div>}
        {extra}
      </dl>
    </Card>
  );
}
