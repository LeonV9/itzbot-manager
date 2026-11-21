import { deflateRawSync } from 'node:zlib';

const T = (() => { const t: number[] = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = T[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

/** Minimal ZIP writer so tests can craft hostile archives (raw, unsanitised entry names). */
export function makeZip(files: { name: string; data?: string; symlink?: boolean }[]): Buffer {
  const parts: Buffer[] = [], central: Buffer[] = []; let off = 0;
  for (const f of files) {
    const name = Buffer.from(f.name), raw = Buffer.from(f.data ?? ''), comp = deflateRawSync(raw), crc = crc32(raw);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26);
    parts.push(lh, name, comp);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(0x031e, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(((f.symlink ? 0o120777 : 0o100644) << 16) >>> 0, 38); ch.writeUInt32LE(off, 42);
    central.push(ch, name);
    off += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}

export function multipart(fields: { name: string; filename: string; data: Buffer | string; type?: string }[]) {
  const b = '----itzbot' + Math.random().toString(16).slice(2);
  const chunks: Buffer[] = [];
  for (const f of fields) {
    chunks.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${f.name}"; filename="${f.filename}"\r\nContent-Type: ${f.type ?? 'application/octet-stream'}\r\n\r\n`), Buffer.from(f.data), Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${b}--\r\n`));
  return { payload: Buffer.concat(chunks), headers: { 'content-type': `multipart/form-data; boundary=${b}` } };
}
