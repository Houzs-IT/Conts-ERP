// Minimal zip reader (no dependencies): lists entries from the central directory and
// reads one entry (stored or deflate). Reads only the bytes it needs, so a 300 MB
// export with design PDFs is never loaded whole.
import fs from "node:fs";
import zlib from "node:zlib";

function readAt(fd, pos, len) {
  const buf = Buffer.alloc(len);
  let off = 0;
  while (off < len) {
    const n = fs.readSync(fd, buf, off, len - off, pos + off);
    if (n === 0) break;
    off += n;
  }
  return buf.subarray(0, off);
}

/** Entries of a zip: { name, size, compressedSize, method, offset }. */
export function listZip(path) {
  const fd = fs.openSync(path, "r");
  try {
    const { size } = fs.fstatSync(fd);
    const tailLen = Math.min(size, 65557);
    const tail = readAt(fd, size - tailLen, tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error(`not a zip file: ${path}`);
    let count = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOffset = tail.readUInt32LE(eocd + 16);
    if (cdOffset === 0xffffffff || count === 0xffff) {
      // zip64: the locator sits just before the end-of-central-directory record
      const loc = eocd - 20;
      if (loc >= 0 && tail.readUInt32LE(loc) === 0x07064b50) {
        const z64 = Number(tail.readBigUInt64LE(loc + 8));
        const rec = readAt(fd, z64, 56);
        count = Number(rec.readBigUInt64LE(32));
        cdSize = Number(rec.readBigUInt64LE(40));
        cdOffset = Number(rec.readBigUInt64LE(48));
      }
    }
    const cd = readAt(fd, cdOffset, cdSize);
    const out = [];
    let p = 0;
    for (let i = 0; i < count && p + 46 <= cd.length; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) break;
      const flags = cd.readUInt16LE(p + 8);
      const method = cd.readUInt16LE(p + 10);
      let compressedSize = cd.readUInt32LE(p + 20);
      let size = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      let offset = cd.readUInt32LE(p + 42);
      const nameBuf = cd.subarray(p + 46, p + 46 + nameLen);
      const name = flags & 0x800 ? nameBuf.toString("utf8") : nameBuf.toString("latin1");
      const extra = cd.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen);
      for (let e = 0; e + 4 <= extra.length;) {
        const id = extra.readUInt16LE(e);
        const len = extra.readUInt16LE(e + 2);
        if (id === 0x0001) {
          let q = e + 4;
          if (size === 0xffffffff) { size = Number(extra.readBigUInt64LE(q)); q += 8; }
          if (compressedSize === 0xffffffff) { compressedSize = Number(extra.readBigUInt64LE(q)); q += 8; }
          if (offset === 0xffffffff) { offset = Number(extra.readBigUInt64LE(q)); }
        }
        e += 4 + len;
      }
      out.push({ name, size, compressedSize, method, offset });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  } finally {
    fs.closeSync(fd);
  }
}

/** The bytes of one entry. */
export function readZipEntry(path, entry) {
  const fd = fs.openSync(path, "r");
  try {
    const head = readAt(fd, entry.offset, 30);
    if (head.readUInt32LE(0) !== 0x04034b50) throw new Error(`bad local header for ${entry.name}`);
    const start = entry.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
    const raw = readAt(fd, start, entry.compressedSize);
    if (entry.method === 0) return raw;
    if (entry.method === 8) return zlib.inflateRawSync(raw);
    throw new Error(`unsupported zip method ${entry.method} for ${entry.name}`);
  } finally {
    fs.closeSync(fd);
  }
}
