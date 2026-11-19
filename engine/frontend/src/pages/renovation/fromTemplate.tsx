/* From template (owner, 19 Nov 2026): a sales order takes a package template's sections, products, quantities, prices
   and SLA days in one press. Lines added to a contract go through a variation order, so the button opens a new VO with
   the template already in its Add part (?template=<id>); the VO is checked and approved as any other. When the project
   is started, the lines' SLA days become their processing and delivery dates (backend scm/lib/renovation-sla.ts). */

import { useState, type CSSProperties, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutTemplate } from 'lucide-react';
import { refusalOf, renoGet, renoSend, useTemplates, type DocSection, type TemplateView } from '../../lib/renovation/api';

/** The template's sections as new variation order lines: no ids, every line an addition. */
export function templateAsVoSections(t: Pick<TemplateView, 'sections'>): DocSection[] {
  return t.sections.map((s) => ({
    ...s,
    id: undefined,
    voId: null,
    soItemId: null,
    lumpSumSen: null,
    lines: s.lines.map((l) => ({ ...l, id: undefined, parentId: undefined, soItemId: null, voChange: 'ADD' as const, omitTargetLineId: null, omitQty: null })),
  })) as DocSection[];
}

export async function loadTemplateSections(id: string): Promise<{ name: string; sections: DocSection[] }> {
  const t = await renoGet<TemplateView>(`/templates/${encodeURIComponent(id)}`);
  return { name: t.name, sections: templateAsVoSections(t) };
}

/** A template picker that opens a new VO on the contract with the picked template in it. */
export function FromTemplateButton({ docNo, onError, className, style }: {
  docNo: string; onError: (text: string) => void; className?: string; style?: CSSProperties;
}): ReactElement | null {
  const navigate = useNavigate();
  const tq = useTemplates();
  const [busy, setBusy] = useState(false);
  const list = (tq.data?.templates ?? []).filter((t) => t.active);
  const pick = async (templateId: string): Promise<void> => {
    if (!templateId) return;
    setBusy(true);
    try {
      const r = await renoSend<{ id: string }>(`/sales-orders/${encodeURIComponent(docNo)}/variation-orders`, 'POST', {});
      navigate(`/scm/renovation/variation-orders/${r.id}?template=${encodeURIComponent(templateId)}`);
    } catch (e) {
      onError(refusalOf(e).message);
      setBusy(false);
    }
  };
  return (
    <label className={className} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, ...style }} title="Add a package template's sections and products to this sales order, through a new VO">
      <LayoutTemplate size={15} aria-hidden="true" />
      <span className="sr-only">From template</span>
      <select disabled={busy || list.length === 0} value="" onChange={(e) => void pick(e.target.value)}
        style={{ border: 0, background: 'transparent', font: 'inherit', color: 'inherit', cursor: 'pointer', maxWidth: 220 }}>
        <option value="">{busy ? 'Opening...' : list.length ? 'From template' : 'No package template yet'}</option>
        {list.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
    </label>
  );
}
