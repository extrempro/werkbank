/**
 * Outlook-.msg ([MS-OXMSG]) lesen: Eigenschaften der Nachricht, Empfänger (inkl. Unzustellbarkeits-Angaben),
 * Anhänge und eingebettete Nachrichten.
 */
import { child, readCfb, type CfbEntry } from "./cfb";

export type PropValue = string | number | Uint8Array | Date | boolean;

export interface MsgAttachment {
  props: Map<number, PropValue>;
  filename?: string;
  mimeTag?: string;
  data?: Uint8Array;
  embedded?: MsgMessage;
}

export interface MsgMessage {
  props: Map<number, PropValue>;
  recipients: Map<number, PropValue>[];
  attachments: MsgAttachment[];
}

/** häufig gebrauchte Eigenschaften (Property-IDs) */
export const P = {
  MESSAGE_CLASS: 0x001a,
  SUBJECT: 0x0037,
  CLIENT_SUBMIT_TIME: 0x0039,
  TRANSPORT_HEADERS: 0x007d,
  SENDER_NAME: 0x0c1a,
  SENDER_EMAIL: 0x0c1f,
  DISPLAY_TO: 0x0e04,
  BODY: 0x1000,
  REPORT_TEXT: 0x1001,
  INTERNET_MESSAGE_ID: 0x1035,
  CODEPAGE: 0x3ffd,
  INTERNET_CPID: 0x3fde,
  LOCALE_ID: 0x3ff1,
  // Empfänger
  DISPLAY_NAME: 0x3001,
  EMAIL_ADDRESS: 0x3003,
  SMTP_ADDRESS: 0x39fe,
  NDR_REASON_CODE: 0x0c04,
  NDR_DIAG_CODE: 0x0c05,
  SUPPLEMENTARY_INFO: 0x0c1b,
  NDR_STATUS_CODE: 0x0c20,
  // Anhänge
  ATTACH_DATA: 0x3701,
  ATTACH_FILENAME: 0x3704,
  ATTACH_METHOD: 0x3705,
  ATTACH_LONG_FILENAME: 0x3707,
  ATTACH_MIME_TAG: 0x370e,
} as const;

/** Windows-Codepage → Zeichensatz für TextDecoder */
function codepageLabel(cp: number | undefined): string {
  if (!cp) return "windows-1252";
  if (cp === 65001) return "utf-8";
  if (cp === 20127) return "us-ascii";
  if (cp >= 28591 && cp <= 28605) return `iso-8859-${cp - 28590}`;
  if (cp === 932) return "shift_jis";
  if (cp === 874) return "windows-874";
  if (cp === 936) return "gbk";
  if (cp === 949) return "euc-kr";
  if (cp === 950) return "big5";
  if (cp >= 1250 && cp <= 1258) return `windows-${cp}`;
  return "windows-1252";
}

/** Sprache (LCID) → ANSI-Codepage, falls die Nachricht keine Codepage angibt */
function codepageFromLcid(lcid: number | undefined): number | undefined {
  if (!lcid) return undefined;
  const primary = lcid & 0x3ff;
  const map: Record<number, number> = {
    0x11: 932, // Japanisch
    0x12: 949, // Koreanisch
    0x19: 1251, 0x22: 1251, 0x02: 1251, 0x1a: lcid === 0x0c1a ? 1251 : 1250, // Russisch, Ukrainisch, Bulgarisch, Serbisch/Kroatisch
    0x05: 1250, 0x15: 1250, 0x0e: 1250, 0x1b: 1250, 0x24: 1250, 0x18: 1250, // Tschechisch, Polnisch, Ungarisch, Slowakisch, Slowenisch, Rumänisch
    0x08: 1253, // Griechisch
    0x1f: 1254, // Türkisch
    0x0d: 1255, // Hebräisch
    0x01: 1256, // Arabisch
    0x25: 1257, 0x26: 1257, 0x27: 1257, // Baltisch
    0x1e: 874, // Thai
  };
  if (primary === 0x04) return lcid === 0x0404 || lcid === 0x0c04 || lcid === 0x1404 ? 950 : 936; // Chinesisch
  return map[primary] ?? 1252;
}

const decode = (bytes: Uint8Array, label: string) => {
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
};

const FILETIME_EPOCH_DIFF = 11644473600000n;

function readStorage(storage: CfbEntry, headerSize: number, inheritedCp?: number): Map<number, PropValue> {
  const props = new Map<number, PropValue>();
  const raw8: [number, Uint8Array][] = [];
  for (const c of storage.children) {
    const m = /^__substg1\.0_([0-9A-F]{4})([0-9A-F]{4})$/i.exec(c.name);
    if (!m || c.type !== "stream") continue;
    const id = parseInt(m[1]!, 16);
    const type = parseInt(m[2]!, 16);
    const data = c.read();
    if (type === 0x001f) props.set(id, decode(data, "utf-16le").replace(/\0+$/, ""));
    else if (type === 0x001e) raw8.push([id, data]);
    else if (type === 0x0102) props.set(id, data);
  }
  // Werte fester Länge stehen gesammelt im Properties-Stream
  const ps = child(storage, "__properties_version1.0");
  if (ps) {
    const d = ps.read();
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
    for (let o = headerSize; o + 16 <= d.length; o += 16) {
      const type = dv.getUint16(o, true);
      const id = dv.getUint16(o + 2, true);
      if (props.has(id)) continue;
      if (type === 0x0003) props.set(id, dv.getInt32(o + 8, true));
      else if (type === 0x000b) props.set(id, dv.getUint16(o + 8, true) !== 0);
      else if (type === 0x0040) {
        const ft = dv.getBigUint64(o + 8, true);
        if (ft > 0n) props.set(id, new Date(Number(ft / 10000n - FILETIME_EPOCH_DIFF)));
      }
    }
  }
  // 8-Bit-Strings erst jetzt dekodieren – die Codepage steht im Properties-Stream; sonst aus der Sprache ableiten
  // (PR_INTERNET_CPID gilt nur für den MIME-Text, nicht für die ANSI-Werte der .msg)
  const cp = (props.get(P.CODEPAGE) as number | undefined) ?? codepageFromLcid(props.get(P.LOCALE_ID) as number | undefined) ?? (inheritedCp ?? undefined);
  for (const [id, data] of raw8) props.set(id, decode(data, codepageLabel(cp)).replace(/\0+$/, ""));
  return props;
}

function readMessage(storage: CfbEntry, headerSize: number, depth: number, parentCp?: number): MsgMessage {
  if (depth > 10) throw new Error("Zu tief verschachtelte Nachrichten");
  const props = readStorage(storage, headerSize, parentCp);
  const recipients: Map<number, PropValue>[] = [];
  const attachments: MsgAttachment[] = [];
  const cp = (props.get(P.CODEPAGE) as number | undefined) ?? codepageFromLcid(props.get(P.LOCALE_ID) as number | undefined) ?? parentCp;
  for (const c of storage.children) {
    if (c.type !== "storage") continue;
    if (/^__recip_version1\.0_#/i.test(c.name)) {
      recipients.push(readStorage(c, 8, cp));
    } else if (/^__attach_version1\.0_#/i.test(c.name)) {
      const a = readStorage(c, 8, cp);
      const att: MsgAttachment = {
        props: a,
        filename: (a.get(P.ATTACH_LONG_FILENAME) ?? a.get(P.ATTACH_FILENAME)) as string | undefined,
        mimeTag: a.get(P.ATTACH_MIME_TAG) as string | undefined,
        data: a.get(P.ATTACH_DATA) instanceof Uint8Array ? (a.get(P.ATTACH_DATA) as Uint8Array) : undefined,
      };
      const emb = child(c, "__substg1.0_3701000D");
      if (emb && emb.type === "storage") {
        // eingebettete Nachrichten erben ggf. die Codepage
        att.embedded = readMessage(emb, 24, depth + 1, cp);
      }
      attachments.push(att);
    }
  }
  return { props, recipients, attachments };
}

export function readMsg(bytes: Uint8Array): MsgMessage {
  return readMessage(readCfb(bytes), 32, 0);
}

export const str = (m: Map<number, PropValue>, id: number): string | undefined => {
  const v = m.get(id);
  return typeof v === "string" && v.trim() ? v : undefined;
};
