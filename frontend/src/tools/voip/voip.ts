/** Bandbreite für VoIP-Gespräche aus Codec, Paketintervall und Protokoll-Overhead */

export interface Codec {
  id: string;
  name: string;
  /** Nutzdatenrate in kbit/s */
  kbps: number;
  note: string;
}

export const codecs: Codec[] = [
  {
    id: "g711",
    name: "G.711 (a-law/µ-law)",
    kbps: 64,
    note: "ISDN-Qualität, Standard im LAN und bei den meisten SIP-Trunks",
  },
  {
    id: "g722",
    name: "G.722 (HD-Voice)",
    kbps: 64,
    note: "Breitband-Sprache bei gleicher Datenrate wie G.711",
  },
  { id: "g729", name: "G.729", kbps: 8, note: "stark komprimiert, für schmale Leitungen" },
  { id: "g726", name: "G.726 (32 kbit/s)", kbps: 32, note: "ADPCM, z. B. DECT" },
  {
    id: "opus",
    name: "Opus (typ. 24 kbit/s)",
    kbps: 24,
    note: "variabel 6–64 kbit/s; Teams, WebRTC",
  },
  {
    id: "ilbc",
    name: "iLBC (15,2 kbit/s)",
    kbps: 15.2,
    note: "robust bei Paketverlust; 20-ms-Modus",
  },
  { id: "gsm", name: "GSM-FR", kbps: 13, note: "alter Mobilfunk-Codec" },
];

export type Layer2 = "ethernet" | "vlan" | "pppoe" | "none";
export const layer2Bytes: Record<Layer2, number> = { ethernet: 18, vlan: 22, pppoe: 26, none: 0 };
export const layer2Labels: Record<Layer2, string> = {
  ethernet: "Ethernet (18 Byte)",
  vlan: "Ethernet mit VLAN-Tag (22 Byte)",
  pppoe: "Ethernet + PPPoE, z. B. DSL (26 Byte)",
  none: "ohne Schicht 2 (nur IP)",
};

export interface VoipInput {
  kbps: number;
  /** Paketintervall in ms */
  ptime: number;
  ipv6: boolean;
  layer2: Layer2;
  /** SRTP hängt einen Authentifizierungs-Tag an (10 Byte) */
  srtp: boolean;
  calls: number;
}

export interface VoipResult {
  payloadBytes: number;
  headerBytes: number;
  packetBytes: number;
  pps: number;
  /** je Gespräch und Richtung, bit/s */
  perCall: number;
  /** alle Gespräche, je Richtung */
  total: number;
  overheadPercent: number;
}

export function voipBandwidth(i: VoipInput): VoipResult {
  if (!(i.kbps > 0) || !(i.ptime >= 5 && i.ptime <= 200))
    throw new Error("Datenrate und Paketintervall (5–200 ms) prüfen.");
  if (!Number.isInteger(i.calls) || i.calls < 1) throw new Error("Mindestens ein Gespräch.");
  const payloadBytes = (i.kbps * 1000 * (i.ptime / 1000)) / 8;
  const headerBytes = 12 + 8 + (i.ipv6 ? 40 : 20) + layer2Bytes[i.layer2] + (i.srtp ? 10 : 0);
  const pps = 1000 / i.ptime;
  const packetBytes = payloadBytes + headerBytes;
  const perCall = packetBytes * 8 * pps;
  return {
    payloadBytes,
    headerBytes,
    packetBytes,
    pps,
    perCall,
    total: perCall * i.calls,
    overheadPercent: (headerBytes / packetBytes) * 100,
  };
}
