/**
 * Minimaler Schreiber für Compound Files und .msg – nur für Tests (erzeugt Beispiel-Nachrichten,
 * u. a. Outlook-Unzustellbarkeitsberichte, ohne fremde Dateien einchecken zu müssen).
 */

export interface CfbNode {
  name: string;
  data?: Uint8Array;
  children?: CfbNode[];
}

const SECTOR = 512;
const MINI = 64;
const CUTOFF = 4096;
const END = 0xfffffffe;
const FREE = 0xffffffff;
const FATSECT = 0xfffffffd;

export function writeCfb(rootChildren: CfbNode[]): Uint8Array {
  interface Entry {
    node: CfbNode;
    type: 1 | 2 | 5;
    left: number;
    right: number;
    child: number;
    start: number;
    size: number;
  }
  const entries: Entry[] = [{ node: { name: "Root Entry", children: rootChildren }, type: 5, left: FREE, right: FREE, child: FREE, start: END, size: 0 }];
  const add = (parent: number, kids: CfbNode[]) => {
    const sorted = [...kids].sort((a, b) => a.name.length - b.name.length || a.name.toUpperCase().localeCompare(b.name.toUpperCase()));
    let prev = -1;
    for (const k of sorted) {
      const idx = entries.length;
      entries.push({ node: k, type: k.children ? 1 : 2, left: FREE, right: FREE, child: FREE, start: END, size: k.data?.length ?? 0 });
      if (prev < 0) entries[parent]!.child = idx;
      else entries[prev]!.right = idx;
      prev = idx;
      if (k.children) add(idx, k.children);
    }
  };
  add(0, rootChildren);

  // Mini-Stream
  const mini: number[] = [];
  const miniFat: number[] = [];
  const big: { e: Entry; data: Uint8Array }[] = [];
  for (const e of entries) {
    if (e.type !== 2 || !e.node.data || e.size === 0) continue;
    if (e.size < CUTOFF) {
      const n = Math.ceil(e.size / MINI);
      e.start = miniFat.length;
      for (let i = 0; i < n; i++) miniFat.push(i === n - 1 ? END : miniFat.length + 1);
      const padded = new Uint8Array(n * MINI);
      padded.set(e.node.data);
      mini.push(...padded);
    } else big.push({ e, data: e.node.data });
  }
  const miniStream = Uint8Array.from(mini);
  entries[0]!.size = miniStream.length;

  const sectorsFor = (bytes: number) => Math.ceil(bytes / SECTOR);
  const dirSectors = sectorsFor(entries.length * 128);
  const miniFatSectors = sectorsFor(miniFat.length * 4);
  const miniStreamSectors = sectorsFor(miniStream.length);
  const bigSectors = big.reduce((n, b) => n + sectorsFor(b.data.length), 0);
  const dataSectors = dirSectors + miniFatSectors + miniStreamSectors + bigSectors;
  let fatSectors = 1;
  while (fatSectors * (SECTOR / 4) < dataSectors + fatSectors) fatSectors++;
  if (fatSectors > 109) throw new Error("Testdatei zu groß");

  const total = fatSectors + dataSectors;
  const fat = new Array<number>(fatSectors * (SECTOR / 4)).fill(FREE);
  let next = 0;
  const alloc = (n: number) => {
    const start = next;
    for (let i = 0; i < n; i++) fat[next + i] = i === n - 1 ? END : next + i + 1;
    next += n;
    return n ? start : END;
  };
  for (let i = 0; i < fatSectors; i++) fat[next++] = FATSECT;
  const dirStart = alloc(dirSectors);
  const miniFatStart = alloc(miniFatSectors);
  const miniStreamStart = alloc(miniStreamSectors);
  entries[0]!.start = miniStreamSectors ? miniStreamStart : END;
  const bigStarts = big.map((b) => alloc(sectorsFor(b.data.length)));
  big.forEach((b, i) => (b.e.start = bigStarts[i]!));

  const out = new Uint8Array(SECTOR * (total + 1));
  const dv = new DataView(out.buffer);
  out.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  dv.setUint16(24, 0x003e, true);
  dv.setUint16(26, 3, true);
  dv.setUint16(28, 0xfffe, true);
  dv.setUint16(30, 9, true);
  dv.setUint16(32, 6, true);
  dv.setUint32(44, fatSectors, true);
  dv.setUint32(48, dirStart, true);
  dv.setUint32(56, CUTOFF, true);
  dv.setUint32(60, miniFatSectors ? miniFatStart : END, true);
  dv.setUint32(64, miniFatSectors, true);
  dv.setUint32(68, END, true);
  dv.setUint32(72, 0, true);
  for (let i = 0; i < 109; i++) dv.setUint32(76 + i * 4, i < fatSectors ? i : FREE, true);
  const sectorOff = (s: number) => (s + 1) * SECTOR;
  fat.forEach((v, i) => dv.setUint32(sectorOff(0) + i * 4, v, true));
  entries.forEach((e, i) => {
    const o = sectorOff(dirStart) + i * 128;
    const name = e.node.name;
    for (let c = 0; c < name.length; c++) dv.setUint16(o + c * 2, name.charCodeAt(c), true);
    dv.setUint16(o + 64, (name.length + 1) * 2, true);
    out[o + 66] = e.type;
    out[o + 67] = 1;
    dv.setUint32(o + 68, e.left, true);
    dv.setUint32(o + 72, e.right, true);
    dv.setUint32(o + 76, e.child, true);
    dv.setUint32(o + 116, e.start, true);
    dv.setUint32(o + 120, e.size, true);
  });
  miniFat.forEach((v, i) => dv.setUint32(sectorOff(miniFatStart) + i * 4, v, true));
  if (miniStreamSectors) out.set(miniStream, sectorOff(miniStreamStart));
  big.forEach((b, i) => out.set(b.data, sectorOff(bigStarts[i]!)));
  return out;
}

// ---------- .msg ----------

export type MsgProp = { id: number; value: string | number | Uint8Array };

const utf16 = (s: string) => {
  const b = new Uint8Array(s.length * 2 + 2);
  for (let i = 0; i < s.length; i++) {
    b[i * 2] = s.charCodeAt(i) & 0xff;
    b[i * 2 + 1] = s.charCodeAt(i) >> 8;
  }
  return b;
};
const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, "0");

function propStorage(props: MsgProp[], headerSize: number, extra: CfbNode[] = []): CfbNode[] {
  const nodes: CfbNode[] = [];
  const fixed = new Uint8Array(headerSize + 16 * props.length);
  const fdv = new DataView(fixed.buffer);
  let o = headerSize;
  for (const p of props) {
    if (typeof p.value === "string") nodes.push({ name: `__substg1.0_${hex4(p.id)}001F`, data: utf16(p.value).subarray(0, p.value.length * 2) });
    else if (p.value instanceof Uint8Array) nodes.push({ name: `__substg1.0_${hex4(p.id)}0102`, data: p.value });
    else {
      fdv.setUint16(o, 0x0003, true);
      fdv.setUint16(o + 2, p.id, true);
      fdv.setUint32(o + 4, 6, true);
      fdv.setInt32(o + 8, p.value, true);
      o += 16;
    }
  }
  nodes.push({ name: "__properties_version1.0", data: fixed.subarray(0, o) });
  return [...nodes, ...extra];
}

export interface TestMsg {
  props: MsgProp[];
  recipients?: MsgProp[][];
  attachments?: { props: MsgProp[]; embedded?: TestMsg }[];
}

function messageNodes(m: TestMsg, headerSize: number): CfbNode[] {
  const children: CfbNode[] = [{ name: "__nameid_version1.0", children: [] }];
  (m.recipients ?? []).forEach((r, i) => children.push({ name: `__recip_version1.0_#${i.toString(16).toUpperCase().padStart(8, "0")}`, children: propStorage(r, 8) }));
  (m.attachments ?? []).forEach((a, i) =>
    children.push({
      name: `__attach_version1.0_#${i.toString(16).toUpperCase().padStart(8, "0")}`,
      children: propStorage(a.props, 8, a.embedded ? [{ name: "__substg1.0_3701000D", children: messageNodes(a.embedded, 24) }] : []),
    }),
  );
  return propStorage(m.props, headerSize, children);
}

export function writeMsg(m: TestMsg): Uint8Array {
  return writeCfb(messageNodes(m, 32));
}
