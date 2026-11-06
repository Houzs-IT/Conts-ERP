import { useState, type ReactNode } from 'react';
import { CloseButton } from '../../components/CloseButton';
import { Drawer } from '../../components/Dialog';
import { SearchSelect } from '../../components/Select';
import { Skeleton } from '../../components/States';
import { titleCase } from '../../lib/format';
import { useApi } from '../../lib/useApi';
import { CLEAN_KINDS } from './UnitCleaning';
import { PercentSchedule, type PriceTarget } from './PercentSchedule';

export type PriceKind = 'cleaning' | 'maintenance';
export interface ScheduleUnit { id: string; label: string; building: string; hint: string }
interface RosterUnit { id: string; unitNumber: string; propertyName: string; ownerName: string }
interface CatalogItem { id: string; code: string; name: string; active: boolean }
interface PriceList { ready: boolean; mayPrice: boolean; items: CatalogItem[] }

const EVERY = 'every';
const PANEL_TITLE: Record<PriceKind, string> = { cleaning: 'Schedule cleaning price change', maintenance: 'Schedule item price change' };
const CLEAN_TARGETS: PriceTarget[] = CLEAN_KINDS.map(([cleanKind, name]) => ({ key: cleanKind, name, request: { cleanKind } }));

function useScheduleUnits(): ScheduleUnit[] {
  const roster = useApi<{ data: RosterUnit[] }>('/units');
  return (roster.data?.data ?? []).map(({ id, unitNumber, propertyName, ownerName }) => (
    { id, label: `${propertyName} ${unitNumber}`, building: propertyName, hint: titleCase(ownerName) }));
}

function CleaningPercent({ onSaved }: { onSaved: () => void }) {
  const units = useScheduleUnits();
  const [unitId, setUnitId] = useState(EVERY);
  const unit = units.find(({ id }) => id === unitId) ?? null;
  return (
    <>
      <SearchSelect label="Units" showLabel size="md" placeholder="Search unit" value={unitId} onChange={setUnitId}
        options={[{ value: EVERY, label: 'All units' }, ...units.map(({ id, label, building, hint }) => ({ value: id, label, group: building, hint }))]} />
      <PercentSchedule key={unitId} kind="cleaning" targets={CLEAN_TARGETS} unit={unit} onSaved={onSaved} />
    </>
  );
}

function MaintenancePercent({ items, onSaved }: { items: CatalogItem[]; onSaved: () => void }) {
  const [itemId, setItemId] = useState(EVERY);
  const active = items.filter(({ active: isActive }) => isActive);
  if (!active.length) return <p className="m-0 text-copy text-muted-ink">No items in the catalog yet.</p>;
  const chosen = itemId === EVERY ? active : active.filter(({ id }) => id === itemId);
  const targets: PriceTarget[] = chosen.map(({ id, code, name }) => ({ key: id, name: `${code} ${name}`, request: { itemId: id } }));
  return (
    <>
      <SearchSelect label="Items" showLabel size="md" placeholder="Search item" value={itemId} onChange={setItemId}
        options={[{ value: EVERY, label: 'All items' }, ...active.map(({ id, code, name }) => ({ value: id, label: `${code} ${name}` }))]} />
      <PercentSchedule key={itemId} kind="maintenance" targets={targets} unit={null} onSaved={onSaved} />
    </>
  );
}

function SidePanel({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <Drawer open onClose={onClose} width={560} labelledBy="price-change-title">
      <div className="flex items-start justify-between gap-3 p-5 [border-bottom:1px_solid_var(--color-line)] sticky top-0 bg-card z-[1]">
        <h2 id="price-change-title" className="m-0 text-title font-semibold [overflow-wrap:anywhere]">{title}</h2>
        <CloseButton onClick={onClose} />
      </div>
      <div className="p-5 flex flex-col gap-6">{children}</div>
    </Drawer>
  );
}

/** Prices up or down by a percent from a date (owner, 6 Nov 2026): cleaning for all units or one, maintenance for the
 *  catalog items chosen. Worked out once into RM and saved as dated rows, so jobs from that day take the new price. */
export function PriceChangePanel({ kind, onClose, onSaved }: { kind: PriceKind; onClose: () => void; onSaved: () => void }) {
  const list = useApi<PriceList>(`/operations/service-prices?domain=${kind}`);
  const body = (): ReactNode => {
    if (list.error) return <p role="alert" className="m-0 text-copy text-critical">{list.error}</p>;
    if (!list.data) return <Skeleton height={220} />;
    if (!list.data.ready) return <p className="m-0 text-copy text-muted-ink">Service prices are not switched on yet.</p>;
    if (!list.data.mayPrice) return <p className="m-0 text-copy text-muted-ink">Only management changes prices.</p>;
    return kind === 'cleaning' ? <CleaningPercent onSaved={onSaved} /> : <MaintenancePercent items={list.data.items} onSaved={onSaved} />;
  };
  return <SidePanel title={PANEL_TITLE[kind]} onClose={onClose}>{body()}</SidePanel>;
}
