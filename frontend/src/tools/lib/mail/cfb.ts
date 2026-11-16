/**
 * Leser für das Compound File Binary Format (OLE2, [MS-CFB]) – der Container hinter Outlook-.msg-Dateien.
 * Robust gegen kaputte oder bösartige Dateien: Zyklen in Sektorketten und Verzeichnisbaum werden erkannt.
 */

export interface CfbEntry {
  name: string;
  type: "storage" | "stream" | "root";
  children: CfbEntry[];
  /** nur für Streams */
  read: () => Uint8Array;
}

const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const NOSTREAM = 0xffffffff;

export class CfbError extends Error {}

export function isCfb(bytes: Uint8Array): boolean {
  return bytes.length >= 512 && SIGNATURE.every((b, i) => bytes[i] === b);
}

export function readCfb(bytes: Uint8Array): CfbEntry {
  if (!isCfb(bytes)) throw new CfbError("Keine Outlook-.msg-Datei (Compound-File-Signatur fehlt)");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (o: number) => dv.getUint16(o, true);
  const u32 = (o: number) => dv.getUint32(o, true);

  const sectorShift = u16(30);
  const miniShift = u16(32);
  if (sectorShift !== 9 && sectorShift !== 12) throw new CfbError("Ungültige Sektorgröße");
  const sectorSize = 1 << sectorShift;
  const miniSize = 1 << miniShift;
  const numFatSectors = u32(44);
  const firstDirSector = u32(48);
  const miniCutoff = u32(56);
  const firstMiniFat = u32(60);
  const numMiniFat = u32(64);
  let difatSector = u32(68);
  const numDifat = u32(72);
  const totalSectors = Math.floor((bytes.length - sectorSize) / sectorSize) + 1;

  const sectorOffset = (s: number) => (s + 1) * sectorSize;
  const sector = (s: number) => {
    if (s >= totalSectors) throw new CfbError("Sektor außerhalb der Datei");
    return bytes.subarray(sectorOffset(s), sectorOffset(s) + sectorSize);
  };

  // FAT-Sektoren über DIFAT (109 im Header + Kette)
  const fatSectors: number[] = [];
  for (let i = 0; i < 109 && fatSectors.length < numFatSectors; i++) {
    const s = u32(76 + i * 4);
    if (s !== FREESECT) fatSectors.push(s);
  }
  const seenDifat = new Set<number>();
  for (let n = 0; n < numDifat && difatSector !== ENDOFCHAIN && difatSector !== FREESECT; n++) {
    if (seenDifat.has(difatSector)) throw new CfbError("Zyklus in der DIFAT-Kette");
    seenDifat.add(difatSector);
    const sd = sector(difatSector);
    const sdv = new DataView(sd.buffer, sd.byteOffset, sd.byteLength);
    const per = sectorSize / 4 - 1;
    for (let i = 0; i < per && fatSectors.length < numFatSectors; i++) {
      const s = sdv.getUint32(i * 4, true);
      if (s !== FREESECT) fatSectors.push(s);
    }
    difatSector = sdv.getUint32(per * 4, true);
  }
  const fat = new Uint32Array(fatSectors.length * (sectorSize / 4));
  fatSectors.forEach((s, i) => {
    const sd = sector(s);
    const sdv = new DataView(sd.buffer, sd.byteOffset, sd.byteLength);
    for (let j = 0; j < sectorSize / 4; j++)
      fat[i * (sectorSize / 4) + j] = sdv.getUint32(j * 4, true);
  });

  const chain = (start: number, table: Uint32Array, what: string): number[] => {
    const out: number[] = [];
    const seen = new Set<number>();
    for (let s = start; s !== ENDOFCHAIN; s = table[s]!) {
      if (s === FREESECT || s >= table.length) {
        if (s === FREESECT && out.length === 0) return out;
        throw new CfbError(`Ungültige ${what}-Kette`);
      }
      if (seen.has(s)) throw new CfbError(`Zyklus in der ${what}-Kette`);
      seen.add(s);
      out.push(s);
    }
    return out;
  };
  const readChain = (start: number, size?: number) => {
    const sectors = chain(start, fat, "FAT");
    const out = new Uint8Array(sectors.length * sectorSize);
    sectors.forEach((s, i) => out.set(sector(s), i * sectorSize));
    return size === undefined ? out : out.subarray(0, Math.min(size, out.length));
  };

  // Verzeichnis
  const dir = readChain(firstDirSector);
  const ddv = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  interface Raw {
    name: string;
    type: number;
    left: number;
    right: number;
    child: number;
    start: number;
    size: number;
  }
  const raws: Raw[] = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const nameLen = ddv.getUint16(o + 64, true);
    let name = "";
    for (let i = 0; i < Math.max(0, Math.min(nameLen, 64) / 2 - 1); i++)
      name += String.fromCharCode(ddv.getUint16(o + i * 2, true));
    raws.push({
      name,
      type: dir[o + 66]!,
      left: ddv.getUint32(o + 68, true),
      right: ddv.getUint32(o + 72, true),
      child: ddv.getUint32(o + 76, true),
      start: ddv.getUint32(o + 116, true),
      // Version 3: nur die unteren 32 Bit gültig
      size: ddv.getUint32(o + 120, true),
    });
  }
  const root = raws[0];
  if (!root || root.type !== 5) throw new CfbError("Verzeichnis ohne Wurzel");

  // Mini-Stream und Mini-FAT
  let miniStream: Uint8Array | null = null;
  let miniFat: Uint32Array | null = null;
  const loadMini = () => {
    if (miniStream) return;
    miniStream = readChain(root.start, root.size);
    const mf = numMiniFat ? readChain(firstMiniFat) : new Uint8Array(0);
    const mdv = new DataView(mf.buffer, mf.byteOffset, mf.byteLength);
    miniFat = new Uint32Array(mf.length / 4);
    for (let i = 0; i < miniFat.length; i++) miniFat[i] = mdv.getUint32(i * 4, true);
  };
  const readStream = (r: Raw): Uint8Array => {
    if (r.size === 0) return new Uint8Array(0);
    if (r.size < miniCutoff) {
      loadMini();
      const sectors = chain(r.start, miniFat!, "Mini-FAT");
      const out = new Uint8Array(sectors.length * miniSize);
      sectors.forEach((s, i) => {
        const off = s * miniSize;
        if (off + miniSize > miniStream!.length)
          throw new CfbError("Mini-Sektor außerhalb des Mini-Streams");
        out.set(miniStream!.subarray(off, off + miniSize), i * miniSize);
      });
      return out.subarray(0, r.size);
    }
    return readChain(r.start, r.size);
  };

  const visited = new Set<number>();
  const build = (id: number): CfbEntry => {
    const r = raws[id]!;
    const entry: CfbEntry = {
      name: r.name,
      type: r.type === 5 ? "root" : r.type === 1 ? "storage" : "stream",
      children: [],
      read: () => readStream(r),
    };
    if (r.type === 1 || r.type === 5) {
      // Kinder: Rot-Schwarz-Baum ab „child“ über left/right durchlaufen
      const stack = [r.child];
      while (stack.length) {
        const c = stack.pop()!;
        if (c === NOSTREAM) continue;
        if (c >= raws.length) throw new CfbError("Verweis außerhalb des Verzeichnisses");
        if (visited.has(c)) throw new CfbError("Zyklus im Verzeichnisbaum");
        visited.add(c);
        const cr = raws[c]!;
        stack.push(cr.left, cr.right);
        if (cr.type === 1 || cr.type === 2) entry.children.push(build(c));
      }
    }
    return entry;
  };
  visited.add(0);
  return build(0);
}

export const child = (e: CfbEntry, name: string) =>
  e.children.find((c) => c.name.toLowerCase() === name.toLowerCase());
