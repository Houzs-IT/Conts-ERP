import Icon from './Icon';
import { cx } from '../lib/design-tokens';
import { phone, phoneHref, whatsappHref } from '../lib/phone';

/**
 * A phone number as people read it (+60 18-980 0069), tapping it calls, and the chat icon opens WhatsApp.
 * The stored value is untouched. Shows `empty` (default a dash) when there is no number.
 */
export function PhoneText({ value, whatsapp = true, className, empty = '—' }: {
  value: string | null | undefined; whatsapp?: boolean; className?: string; empty?: string;
}) {
  const shown = phone(value);
  if (!shown) return <span className={cx('text-faint', className)}>{empty}</span>;
  const tel = phoneHref(value), wa = whatsappHref(value);
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap [font-variant-numeric:tabular-nums]', className)}>
      {tel ? <a href={tel} className="[color:inherit] underline-offset-2 hover:underline">{shown}</a> : shown}
      {whatsapp && wa && (
        <a href={wa} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp ${shown}`} title="Open in WhatsApp"
          className="inline-grid place-items-center w-6 h-6 rounded-pill text-success hover:bg-muted">
          <Icon name="MessageCircle" size="sm" />
        </a>
      )}
    </span>
  );
}
