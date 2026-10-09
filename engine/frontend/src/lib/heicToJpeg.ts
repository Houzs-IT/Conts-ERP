// ----------------------------------------------------------------------------
// HEIC / HEIF (iPhone photos) -> JPEG in the browser, before upload.
//
// The renovation upload routes keep their JPEG / PNG / WebP / PDF allow-list:
// a Worker cannot decode HEIC, and the photos must open on every screen and in
// the printed delivery note. So an iPhone photo is converted here:
//   1. the browser's own decoder first (Safari decodes HEIC natively);
//   2. otherwise heic2any (libheif in the browser), loaded only when a HEIC
//      file actually turns up, so nobody else downloads it;
//   3. otherwise a clear refusal: the upload does not happen.
// Every other file passes through untouched.
// ----------------------------------------------------------------------------

/** Add to a file input's `accept` so phones and desktops offer HEIC files. */
export const HEIC_ACCEPT = ".heic,.heif,image/heic,image/heif";

const HEIC_TYPES = new Set(["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"]);

export function isHeicFile(file: File): boolean {
  const type = (file.type || "").toLowerCase();
  if (HEIC_TYPES.has(type)) return true;
  // Chrome on Windows / Android often reports "" or octet-stream for HEIC.
  return /\.(heic|heif)$/i.test(file.name || "");
}

export class HeicConversionError extends Error {
  constructor(fileName: string) {
    super(
      `${fileName || "This photo"} is an iPhone HEIC photo and could not be converted to JPEG on this device. ` +
        `Take it again with Settings > Camera > Formats set to Most Compatible, or send it as a JPEG.`,
    );
    this.name = "HeicConversionError";
  }
}

export interface HeicConverters {
  /** Browser-native decode to JPEG; null when the browser cannot decode HEIC. */
  native?: (file: File) => Promise<Blob | null>;
  /** Library decode to JPEG; throws when it cannot. */
  library?: (file: File) => Promise<Blob>;
}

const JPEG_QUALITY = 0.86;

async function nativeToJpeg(file: File): Promise<Blob | null> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return null;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return null;
  }
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    return await new Promise<Blob | null>((resolve) => {
      try {
        canvas.toBlob((b) => resolve(b && b.type === "image/jpeg" ? b : null), "image/jpeg", JPEG_QUALITY);
      } catch {
        resolve(null);
      }
    });
  } finally {
    bitmap.close();
  }
}

async function libraryToJpeg(file: File): Promise<Blob> {
  const { default: heic2any } = await import("heic2any");
  const out = await heic2any({ blob: file, toType: "image/jpeg", quality: JPEG_QUALITY });
  return Array.isArray(out) ? out[0]! : out;
}

function jpegName(name: string): string {
  const base = (name || "").replace(/\.[A-Za-z0-9]+$/, "");
  return `${base || "photo"}.jpg`;
}

/**
 * The file to upload: HEIC / HEIF converted to JPEG, anything else unchanged.
 * Throws HeicConversionError when a HEIC photo cannot be converted.
 */
export async function toUploadableImage(file: File, converters: HeicConverters = {}): Promise<File> {
  if (!isHeicFile(file)) return file;
  const native = converters.native ?? nativeToJpeg;
  const library = converters.library ?? libraryToJpeg;
  let jpeg: Blob | null = null;
  try {
    jpeg = await native(file);
  } catch {
    jpeg = null;
  }
  if (!jpeg) {
    try {
      jpeg = await library(file);
    } catch (e) {
      console.warn("[heic] conversion failed", e);
      jpeg = null;
    }
  }
  if (!jpeg || jpeg.type !== "image/jpeg" || jpeg.size === 0) throw new HeicConversionError(file.name);
  return new File([jpeg], jpegName(file.name), { type: "image/jpeg", lastModified: file.lastModified });
}
