import { date, time } from './format';

/**
 * The unit and the date and time burnt into the corner of a proof photo before it is uploaded (owner, Nov 2026), so the
 * photo carries them wherever it is sent. The time is the server's, read from a response's Date header: a phone with
 * its clock set back cannot stamp another day. Videos, and photos the browser cannot read, go up as they are.
 */

/** Long edge in pixels. A phone's 4000 px photo comes down to this, which also makes a hundred uploads quicker. */
const EDGE = 2560;
let clock: { offset: number; at: number } | null = null;

async function serverNow(): Promise<Date> {
  if (!clock || Date.now() - clock.at > 5 * 60_000) {
    try {
      const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
      const server = Date.parse(res.headers.get('Date') ?? '');
      if (!Number.isNaN(server)) clock = { offset: server - Date.now(), at: Date.now() };
    } catch { /* offline: the phone's own clock until the next check */ }
  }
  return new Date(Date.now() + (clock?.offset ?? 0));
}

export async function stampPhoto(file: File, label: string): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  try {
    const when = (await serverNow()).toISOString();
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, EDGE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const g = canvas.getContext('2d')!;
    g.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();

    const lines = [label, `${date(when)}  ${time(when)}`].filter(Boolean);
    const size = Math.max(14, Math.round(Math.min(canvas.width, canvas.height) * 0.032));
    const pad = Math.round(size * 0.6), gap = Math.round(size * 0.3);
    g.font = `600 ${size}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
    const w = Math.max(...lines.map(l => g.measureText(l).width)) + pad * 2;
    const h = lines.length * size + (lines.length - 1) * gap + pad * 2;
    const x = canvas.width - w - pad, y = canvas.height - h - pad;
    g.fillStyle = 'rgba(0, 0, 0, 0.55)';
    g.beginPath();
    g.roundRect(x, y, w, h, Math.round(size * 0.4));
    g.fill();
    g.fillStyle = 'white';
    g.textBaseline = 'top';
    g.textAlign = 'right';
    lines.forEach((l, i) => g.fillText(l, x + w - pad, y + pad + i * (size + gap)));

    const blob = await new Promise<Blob | null>(ok => canvas.toBlob(ok, 'image/jpeg', 0.88));
    return blob ? new File([blob], file.name.replace(/\.[^.]*$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } catch {
    return file;
  }
}
