import { Button } from './Button';
import { TONE, cx } from '../lib/design-tokens';

/** Houzs's "go ahead anyway?" step. The server refused with SHORT_STOCK (the warehouse can't
 *  cover this); state the shortage and let the operator either stop or confirm, which resends
 *  the same request with confirmShortStock. */
export function ShortStockPrompt({ message, actionLabel, busy, onConfirm, onCancel }: {
  message: string; actionLabel: string; busy: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  const t = TONE.warning;
  return (
    <div role="alert" className={cx('flex flex-col gap-3 p-4 rounded-control border border-solid', t.bg, t.border)}>
      <div className={cx('text-[13px] font-semibold', t.text)}>Not enough stock</div>
      <div className={cx('text-[13px]', t.text)}>{message}</div>
      <div className="flex justify-end gap-2.5">
        <Button size="sm" variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button size="sm" variant="danger" onClick={onConfirm} loading={busy}>{actionLabel}</Button>
      </div>
    </div>
  );
}
