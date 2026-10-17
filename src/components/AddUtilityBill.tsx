import { useEffect, useState } from 'react';
import { Button } from './Button';
import { UnitPicker } from './UnitPicker';
import { useUnitRoster } from '../lib/useUnitRoster';
import { BillModal } from '../pages/owners/Costs';

/** "Add utility bill" from anywhere (Accounts payable, a unit's Financials tab): the unit's Wi-Fi, water, electricity,
 *  IndahWater bill or an additional deduction, through the one bill form the owner page uses (Costs.tsx BillModal:
 *  bill, amount, bill date, who pays, account number on file, receipt). Without a unit given, the unit is picked first. */
export function AddUtilityBill({ unitId: given, month, onClose, onSaved }: { unitId?: string; month: string; onClose: () => void; onSaved: () => void }) {
  const roster = useUnitRoster();
  const [unitId, setUnitId] = useState(given ?? '');
  const [picked, setPicked] = useState(!!given);
  const unit = roster.find(u => u.id === unitId);

  useEffect(() => {
    if (picked) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [picked, onClose]);

  if (picked && unit) {
    return <BillModal units={[{ id: unit.id, label: `${unit.propertyName} ${unit.unitNumber}` }]} defaultUnitId={unit.id} ownerId={unit.ownerId ?? ''}
      canAdjust={false} month={month} onClose={onClose} onSaved={onSaved} />;
  }
  if (picked) return null; // the roster is still loading
  return (
    <div role="dialog" aria-modal="true" aria-label="Add utility bill" className="fixed inset-0 z-[60] grid place-items-center p-4 sm:p-6 bg-[var(--color-surface-scrim)]">
      <div onClick={onClose} className="absolute inset-0" />
      <div className="relative w-full max-w-[460px] flex flex-col bg-card rounded-card shadow-[var(--shadow-overlay)]">
        <div className="pt-[22px] px-[22px] pb-1">
          <h2 className="m-0 text-title font-semibold">Add utility bill</h2>
          <p className="mt-[5px] mb-0 text-copy text-muted-ink">Wi-Fi, water, electricity, IndahWater, or an additional deduction (Other fees). Which unit is it for?</p>
        </div>
        <div className="py-4 px-[22px]">
          <UnitPicker units={roster} value={unitId} onChange={id => { setUnitId(id); setPicked(true); }} autoFocus />
        </div>
        <div className="py-[14px] px-[22px] [border-top:1px_solid_var(--color-line)] bg-page flex justify-end gap-[9px] rounded-b-card">
          <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}
