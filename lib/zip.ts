/**
 * A plain (uncompressed) .zip, built in the browser: enough to hand someone a
 * folder of DXFs in one download without pulling in a zip library.
 */

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Files in, zip bytes out. Names may hold "/" for folders; duplicates get " (2)". */
export function makeZip(files: { name: string; text: string }[]): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const seen = new Map<string, number>();
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    let name = f.name;
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(f.name, n);
    if (n > 1) name = name.replace(/(\.[^./]+)?$/, (ext) => ` (${n})${ext}`);
    const nameB = enc.encode(name);
    const data = enc.encode(f.text);
    const crc = crc32(data);
    const head = new Uint8Array(30 + nameB.length);
    const h = new DataView(head.buffer);
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 0x0800, true); // UTF-8 names
    h.setUint16(8, 0, true); // stored
    h.setUint16(10, time, true);
    h.setUint16(12, date, true);
    h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true);
    h.setUint32(22, data.length, true);
    h.setUint16(26, nameB.length, true);
    head.set(nameB, 30);
    const dir = new Uint8Array(46 + nameB.length);
    const d = new DataView(dir.buffer);
    d.setUint32(0, 0x02014b50, true);
    d.setUint16(4, 20, true);
    d.setUint16(6, 20, true);
    d.setUint16(8, 0x0800, true);
    d.setUint16(12, time, true);
    d.setUint16(14, date, true);
    d.setUint32(16, crc, true);
    d.setUint32(20, data.length, true);
    d.setUint32(24, data.length, true);
    d.setUint16(28, nameB.length, true);
    d.setUint32(42, offset, true);
    dir.set(nameB, 46);
    locals.push(head, data);
    central.push(dir);
    offset += head.length + data.length;
  }
  const dirSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, dirSize, true);
  e.setUint32(16, offset, true);
  const out = new Uint8Array(offset + dirSize + 22);
  let at = 0;
  for (const part of [...locals, ...central, end]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
