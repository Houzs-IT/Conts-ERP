import { channel } from '../theme';
import type { BookingChannel } from '../lib/types';

/** Ink is per channel, never a blanket white: white on gold is 2.34:1 and on
 *  Airbnb coral 3.05:1, both failing AA. Glyph never drops below the 11px floor,
 *  so the tile is sized from the glyph rather than the reverse. */
export default function ChannelMark({
  ch, size = 20, muted = false,
}: { ch: BookingChannel; size?: number; muted?: boolean }) {
  const c = channel[ch];
  const px = Math.max(11, c.glyph.length > 1 ? Math.round(size * 0.42) : Math.round(size * 0.56));
  const box = Math.max(size, c.glyph.length > 1 ? Math.round(px * 2.1) : Math.round(px * 1.7));
  return (
    <span
      aria-hidden
      style={{
        width: box, height: box, flex: 'none', borderRadius: Math.round(box * 0.28),
        display: 'grid', placeItems: 'center', lineHeight: 1, fontWeight: 700,
        fontSize: px, letterSpacing: c.glyph.length > 1 ? '-0.03em' : 0,
        background: muted ? '#F1F0ED' : c.fill,
        color: muted ? '#706D67' : c.markInk,
      }}
    >{c.glyph}</span>
  );
}

export function channelLabel(ch: BookingChannel) { return channel[ch].label; }
