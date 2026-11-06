import { useState } from 'react';
import { Modal } from './Modal';
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


  if (picked && unit) {
    return <BillModal units={[{ id: unit.id, label: `${unit.propertyName} ${unit.unitNumber}` }]} defaultUnitId={unit.id} ownerId={unit.ownerId ?? ''}
      canAdjust={false} month={month} onClose={onClose} onSaved={onSaved} />;
  }
  if (picked) return null; // the roster is still loading
  return (
    <Modal title="Add utility bill" sub="Wi-Fi, water, electricity, IndahWater, or an additional deduction (Other fees). Which unit is it for?" onClose={onClose} width={460} dirty={false}
      footer={<Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>}>
      <UnitPicker units={roster} value={unitId} onChange={id => { setUnitId(id); setPicked(true); }} autoFocus />
    </Modal>
  );
}
