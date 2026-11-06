/**
 * Small ZIP "store" writer for offline browser exports.
 * PNG images are already compressed; no additional dependency or network upload.
 * Exports are deliberately limited to small batches to avoid memory exhaustion.
 */
export type ArchiveEntry = { name: string; bytes: Uint8Array };
const encoder = new TextEncoder();
const table = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
 let x = n;
 for (let j = 0; j < 8; j++) x = x & 1 ? (0xedb88320 ^ (x >>> 1)) : x >>> 1;
 table[n] = x >>> 0;
}
function crc32(input: Uint8Array): number {
 let crc = 0xffffffff;
 for (let i = 0; i < input.length; i++)
  crc = (crc >>> 8) ^ table[(crc ^ input[i]) & 0xff];
 return (crc ^ 0xffffffff) >>> 0;
}
function uint32(view: DataView, at: number, x: number) {
 view.setUint32(at,x >>> 0,true);
}
function uint16(view: DataView, at: number, x: number) {
 view.setUint16(at,x,true);
}
export function zipStore(entries: ArchiveEntry[]): Blob {
 if (!entries.length || entries.length > 20001) throw Error("Invalid ZIP entry count.");
 const names = new Set<string>();
 const body: BlobPart[] = [];
 const directory: BlobPart[] = [];
 let offset = 0, centralSize = 0;
 for (const entry of entries) {
  if (!entry.name || entry.name.includes("\\") ||
      entry.name.startsWith("/") || entry.name.split("/").includes(".."))
   throw Error("Invalid ZIP filename.");
  if (names.has(entry.name)) throw Error("Duplicate ZIP filename: " + entry.name);
  names.add(entry.name);
  const name = encoder.encode(entry.name);
  if (name.length > 4096 || entry.bytes.byteLength > 256 * 1024 * 1024)
   throw Error("ZIP item is too large.");
  const checksum = crc32(entry.bytes);
  const local = new Uint8Array(30 + name.length);
  const l = new DataView(local.buffer);
  uint32(l,0,0x04034b50); uint16(l,4,20); uint16(l,6,0x0800);
  uint16(l,8,0); uint16(l,10,0); uint16(l,12,0);
  uint32(l,14,checksum); uint32(l,18,entry.bytes.byteLength);
  uint32(l,22,entry.bytes.byteLength); uint16(l,26,name.length);uint16(l,28,0);
  local.set(name,30);
  const central = new Uint8Array(46 + name.length);
  const c = new DataView(central.buffer);
  uint32(c,0,0x02014b50); uint16(c,4,20); uint16(c,6,20);
  uint16(c,8,0x0800); uint16(c,10,0); uint16(c,12,0);
  uint16(c,14,0); uint32(c,16,checksum);
  uint32(c,20,entry.bytes.byteLength);uint32(c,24,entry.bytes.byteLength);
  uint16(c,28,name.length);uint16(c,30,0);uint16(c,32,0);
  uint16(c,34,0);uint16(c,36,0);uint32(c,38,0);uint32(c,42,offset);
  central.set(name,46);
  body.push(local, new Uint8Array(entry.bytes));
  directory.push(central);
  offset += local.byteLength + entry.bytes.byteLength;
  centralSize += central.byteLength;
  if (offset > 500 * 1024 * 1024) throw Error("ZIP batch is too large: export fewer images.");
 }
 const end = new Uint8Array(22);
 const e = new DataView(end.buffer);
 uint32(e,0,0x06054b50);uint16(e,4,0);uint16(e,6,0);
 uint16(e,8,entries.length);uint16(e,10,entries.length);
 uint32(e,12,centralSize);uint32(e,16,offset);uint16(e,20,0);
 return new Blob([...body,...directory,end],{type:"application/zip"});
}
export function utf8(text: string): Uint8Array { return encoder.encode(text); }
