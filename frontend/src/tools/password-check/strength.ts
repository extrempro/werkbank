import { netGet } from "../lib/net";
/** Passwortstärke abschätzen – Muster erkennen statt nur Zeichen zählen */

const COMMON = new Set(
  (
    "123456 123456789 12345678 password passwort qwerty qwertz 12345 1234567 111111 123123 abc123 1234567890 000000 iloveyou 1q2w3e4r " +
    "admin welcome hallo hallo123 passwort1 password1 sommer winter fruehling herbst schatz freundin ficken master dragon monkey letmein " +
    "football baseball shadow sunshine princess azerty trustno1 superman batman michael jennifer daniel thomas andreas stefan sabine " +
    "test test123 test1234 qwerty123 1qaz2wsx zaq12wsx asdfgh asdf1234 passw0rd p@ssw0rd p@ssword changeme start123 geheim geheim123 " +
    "willkommen willkommen1 Willkommen01 hallo1 schalke04 bvb09 fussball computer internet startup root toor administrator user guest " +
    "login access secret service support office microsoft windows linux server firma firma123 summer2024 winter2024 sommer2025 herbst2025"
  )
    .split(" ")
    .map((w) => w.toLowerCase()),
);

const WORDS = [
  "passwort", "password", "kennwort", "admin", "welcome", "willkommen", "hallo", "sommer", "winter", "herbst", "fruehling", "frühling", "summer", "spring", "autumn",
  "januar", "februar", "maerz", "märz", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "dezember",
  "montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag", "sonntag", "schatz", "liebe", "love", "test", "start", "geheim", "secret",
  "server", "firma", "office", "service", "user", "login", "master", "dragon", "monkey", "qwertz", "qwerty", "asdf", "yxcv", "zxcv", "berlin", "hamburg", "muenchen", "köln",
];

const KEY_ROWS = ["qwertzuiopü", "asdfghjklöä", "yxcvbnm", "qwertyuiop", "asdfghjkl", "zxcvbnm", "1234567890"];
const LEET: Record<string, string> = { "@": "a", "4": "a", "3": "e", "1": "i", "!": "i", "0": "o", "$": "s", "5": "s", "7": "t" };

export interface StrengthResult {
  score: 0 | 1 | 2 | 3 | 4;
  bits: number;
  label: string;
  findings: string[];
  crackTimes: { label: string; seconds: number }[];
}

function pool(pw: string): number {
  let p = 0;
  if (/[a-zäöüß]/.test(pw)) p += 26;
  if (/[A-ZÄÖÜ]/.test(pw)) p += 26;
  if (/\d/.test(pw)) p += 10;
  if (/[^a-zA-Z0-9äöüÄÖÜß]/.test(pw)) p += 33;
  return Math.max(p, 1);
}

export function checkStrength(pw: string): StrengthResult {
  const findings: string[] = [];
  const lower = pw.toLowerCase();
  const unleet = [...lower].map((c) => LEET[c] ?? c).join("");
  const len = [...pw].length;
  const perChar = Math.log2(pool(pw));
  // pro Zeichen Bits, Muster drücken einzelne Zeichen auf ~1 Bit
  const weight = new Array<number>(len).fill(perChar);
  const flat = (from: number, to: number, bits = 1) => {
    for (let i = from; i < to && i < len; i++) weight[i] = Math.min(weight[i]!, bits);
  };

  if (COMMON.has(lower) || COMMON.has(unleet)) {
    findings.push("Steht auf Listen der häufigsten Passwörter – wird als Erstes ausprobiert.");
    return { score: 0, bits: 4, label: "sehr schwach", findings, crackTimes: times(4) };
  }
  for (const w of WORDS) {
    const idx = unleet.indexOf(w);
    if (idx >= 0 && w.length >= 4) {
      flat(idx, idx + w.length, 0);
      weight[idx] = 11; // ein Wort aus einem Wörterbuch ≈ 2^11 Möglichkeiten
      findings.push(`Enthält das Wort „${w}“${lower.includes(w) ? "" : " (mit Ziffern statt Buchstaben – hilft kaum)"}.`);
    }
  }
  const years = [...pw.matchAll(/(19|20)\d{2}/g)];
  for (const y of years) {
    flat(y.index!, y.index! + 4, 1.5);
    findings.push(`Enthält eine Jahreszahl (${y[0]}).`);
  }
  // Wiederholungen und Folgen
  for (let i = 0; i < len - 2; i++) {
    const a = lower.charCodeAt(i);
    const b = lower.charCodeAt(i + 1);
    const c = lower.charCodeAt(i + 2);
    if (a === b && b === c) {
      flat(i + 1, i + 3);
      if (!findings.some((f) => f.startsWith("Wiederholte"))) findings.push("Wiederholte Zeichen (z. B. aaa).");
    } else if (b - a === c - b && Math.abs(b - a) === 1) {
      flat(i + 1, i + 3);
      if (!findings.some((f) => f.startsWith("Zeichenfolgen"))) findings.push("Zeichenfolgen wie abc oder 123.");
    }
  }
  for (const row of KEY_ROWS) {
    for (let n = 4; n <= row.length; n++) {
      for (let s = 0; s + n <= row.length; s++) {
        const part = row.slice(s, s + n);
        const idx = lower.indexOf(part);
        if (idx >= 0) {
          flat(idx + 1, idx + n);
          if (!findings.some((f) => f.startsWith("Tastaturmuster"))) findings.push(`Tastaturmuster („${part}“).`);
        }
      }
    }
  }
  if (/^[A-ZÄÖÜ][a-zäöüß]+\d{1,4}[!.?]?$/.test(pw)) findings.push("Typisches Schema „Wort + Zahl (+ Zeichen)“ – Knackprogramme probieren das gezielt.");
  if (len < 12) findings.push(`Nur ${len} Zeichen – empfohlen sind mindestens 12, für Admin-Konten 16 und mehr.`);
  const bits = Math.round(weight.reduce((a, b) => a + b, 0));
  const score = (bits < 28 ? 0 : bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4) as StrengthResult["score"];
  if (score >= 3 && findings.length === 0) findings.push("Keine auffälligen Muster gefunden.");
  const label = ["sehr schwach", "schwach", "mittel", "stark", "sehr stark"][score]!;
  return { score, bits, label, findings, crackTimes: times(bits) };
}

function times(bits: number) {
  const guesses = 2 ** bits / 2;
  return [
    { label: "Online, mit Sperre (100 Versuche/Stunde)", seconds: guesses / (100 / 3600) },
    { label: "Online, ohne Sperre (10/s)", seconds: guesses / 10 },
    { label: "Gestohlene Datenbank, langsamer Hash (bcrypt, 10 000/s)", seconds: guesses / 1e4 },
    { label: "Gestohlene Datenbank, schneller Hash (NTLM/MD5, 100 Mrd./s)", seconds: guesses / 1e11 },
  ];
}

export function durationText(s: number): string {
  if (s < 1) return "sofort";
  const units: [number, string, string][] = [
    [31_536_000 * 1e9, "Mrd. Jahre", "Mrd. Jahre"],
    [31_536_000 * 1e6, "Mio. Jahre", "Mio. Jahre"],
    [31_536_000, "Jahr", "Jahre"],
    [86400, "Tag", "Tage"],
    [3600, "Stunde", "Stunden"],
    [60, "Minute", "Minuten"],
    [1, "Sekunde", "Sekunden"],
  ];
  if (s > 31_536_000 * 1e12) return "praktisch nie";
  const [size, one, many] = units.find(([u]) => s >= u)!;
  const n = Math.round(s / size);
  return `${n.toLocaleString("de-DE")} ${n === 1 ? one : many}`;
}

/**
 * Have I Been Pwned mit k-Anonymität: Nur die ersten fünf Zeichen des SHA-1-Hashs gehen über die
 * Werkbank hinaus; den Vergleich mit den gelieferten Hash-Enden macht der Browser.
 */
export async function pwnedCount(password: string): Promise<number> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-1", new TextEncoder().encode(password)),
  );
  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  const { body } = await netGet<{ body: string }>(`/pwned/${hex.slice(0, 5)}`);
  return countInRange(body, hex.slice(5));
}

/** Anzahl zu einem Hash-Ende aus der Liste „ENDE:Anzahl“; aufgefüllte Zeilen haben 0. */
export function countInRange(body: string, suffix: string): number {
  const line = body.split(/\r?\n/).find((entry) => entry.toUpperCase().startsWith(`${suffix}:`));
  return line ? Number(line.split(":")[1]) || 0 : 0;
}
