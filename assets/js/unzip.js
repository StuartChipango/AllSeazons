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
