// Reads a .zip file in the browser (stored or deflated entries), so a
// "Claude pack" of photos plus labels.csv can be added in one go.

const u16 = (v, o) => v.getUint16(o, true);
const u32 = (v, o) => v.getUint32(o, true);

export async function readZip(blob) {
  const buf = await blob.arrayBuffer();
  const v = new DataView(buf);
  let end = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (u32(v, i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('This is not a zip file.');
  const count = u16(v, end + 10);
  let p = u32(v, end + 16);
  const names = new TextDecoder();
  const files = [];
  for (let n = 0; n < count; n++) {
    if (u32(v, p) !== 0x02014b50) throw new Error('The zip file is damaged.');
    const method = u16(v, p + 10);
    const size = u32(v, p + 20);
    const nameLen = u16(v, p + 28);
    const extraLen = u16(v, p + 30);
    const commentLen = u16(v, p + 32);
    const local = u32(v, p + 42);
    const name = names.decode(new Uint8Array(buf, p + 46, nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/') || /(^|\/)(__MACOSX|\.)/.test(name)) continue;
    const start = local + 30 + u16(v, local + 26) + u16(v, local + 28);
    const data = new Blob([new Uint8Array(buf, start, size)]);
    let out;
    if (method === 0) out = data;
    else if (method === 8) out = await new Response(data.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
    else throw new Error(`Cannot open "${name}" in the zip.`);
    files.push({ name: name.split('/').pop(), blob: out });
  }
  return files;
}

// Writes a .zip (stored, no compression: the files are JPEGs already), for
// the social media pack download.
let crcTable;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// files: [{ name, data: Uint8Array | string }] -> Blob
export function makeZip(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true);
    head.setUint16(4, 20, true);
    head.setUint16(6, 0x0800, true); // names are UTF-8
    head.setUint32(14, crc, true);
    head.setUint32(18, data.length, true);
    head.setUint32(22, data.length, true);
    head.setUint16(26, name.length, true);
    parts.push(head, name, data);
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(8, 0x0800, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, data.length, true);
    dir.setUint32(24, data.length, true);
    dir.setUint16(28, name.length, true);
    dir.setUint32(42, offset, true);
    central.push(dir, name);
    offset += 30 + name.length + data.length;
  }
  const size = central.reduce((s, p) => s + p.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
