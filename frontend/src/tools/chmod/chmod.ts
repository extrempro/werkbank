/** Unix-Rechte: oktal ↔ symbolisch ↔ Einzelrechte */

export interface Mode {
  /** 0–0o7777 */
  value: number;
}

export const WHO = ["u", "g", "o"] as const;
export const PERMS = ["r", "w", "x"] as const;

export const bit = (who: (typeof WHO)[number], perm: (typeof PERMS)[number]) =>
  (4 >> PERMS.indexOf(perm)) << (3 * (2 - WHO.indexOf(who)));
export const SETUID = 0o4000;
export const SETGID = 0o2000;
export const STICKY = 0o1000;

/** „755“, „0755“, „4755“, „rwxr-xr-x“, „-rwsr-xr-x“, „drwxrwxrwt“, „u=rwx,g=rx,o=“ */
export function parseMode(input: string, base = 0): number {
  const v = input.trim();
  if (/^[0-7]{1,4}$/.test(v)) return parseInt(v, 8);
  const sym = v.replace(/^[-dlcbps]/, (m) => (v.length === 10 ? "" : m));
  if (/^[r-][w-][xsS-][r-][w-][xsS-][r-][w-][xtT-]$/.test(sym)) {
    let n = 0;
    for (let i = 0; i < 9; i++) {
      const c = sym[i]!;
      const pos = 8 - i;
      if (c === "r" || c === "w" || c === "x" || c === "s" || c === "t") n |= 1 << pos;
    }
    if (/[sS]/.test(sym[2]!)) n |= SETUID;
    if (/[sS]/.test(sym[5]!)) n |= SETGID;
    if (/[tT]/.test(sym[8]!)) n |= STICKY;
    return n;
  }
  if (/^[ugoa]*[+\-=][rwxXst]*(,[ugoa]*[+\-=][rwxXst]*)*$/.test(v)) return applySymbolic(base, v);
  throw new Error("Nicht erkannt – Beispiele: 755, rwxr-xr-x, u=rwx,g=rx,o=");
}

/** chmod-Ausdruck wie „u+x,go-w“ auf einen Ausgangswert anwenden (X wird wie x behandelt) */
export function applySymbolic(base: number, expr: string): number {
  let n = base;
  for (const clause of expr.split(",")) {
    const m = clause.match(/^([ugoa]*)([+\-=])([rwxXst]*)$/)!;
    const who = (m[1] || "a").replace("a", "ugo");
    let mask = 0;
    for (const w of new Set(who)) {
      for (const p of m[3]!) {
        if (p === "r" || p === "w" || p === "x" || p === "X")
          mask |= bit(w as "u", (p === "X" ? "x" : p) as "r");
        if (p === "s" && w === "u") mask |= SETUID;
        if (p === "s" && w === "g") mask |= SETGID;
        if (p === "t") mask |= STICKY;
      }
    }
    if (m[2] === "+") n |= mask;
    else if (m[2] === "-") n &= ~mask;
    else {
      let clear = 0;
      for (const w of new Set(who))
        clear |=
          bit(w as "u", "r") |
          bit(w as "u", "w") |
          bit(w as "u", "x") |
          (w === "u" ? SETUID : w === "g" ? SETGID : 0);
      n = (n & ~clear) | mask;
    }
  }
  return n & 0o7777;
}

export function toSymbolic(n: number): string {
  let s = "";
  for (let i = 8; i >= 0; i--) s += n & (1 << i) ? "rwx"[(8 - i) % 3] : "-";
  const set = (idx: number, flag: number, lower: string, upper: string) => {
    if (n & flag) s = s.slice(0, idx) + (s[idx] === "x" ? lower : upper) + s.slice(idx + 1);
  };
  set(2, SETUID, "s", "S");
  set(5, SETGID, "s", "S");
  set(8, STICKY, "t", "T");
  return s;
}

export const toOctal = (n: number) =>
  n & 0o7000 ? n.toString(8).padStart(4, "0") : n.toString(8).padStart(3, "0");

/** „u=rwx,g=rx,o=“ */
export function toChmodSymbolic(n: number): string {
  return WHO.map((w) => {
    let p = PERMS.filter((perm) => n & bit(w, perm)).join("");
    if (w === "u" && n & SETUID) p += "s";
    if (w === "g" && n & SETGID) p += "s";
    if (w === "o" && n & STICKY) p += "t";
    return `${w}=${p}`;
  }).join(",");
}

export function describe(n: number): string[] {
  const names = { u: "Besitzer", g: "Gruppe", o: "Andere" };
  const out = WHO.map((w) => {
    const p = [
      n & bit(w, "r") && "lesen",
      n & bit(w, "w") && "schreiben",
      n & bit(w, "x") && "ausführen",
    ].filter(Boolean);
    return `${names[w]}: ${p.length ? p.join(", ") : "keine Rechte"}`;
  });
  if (n & SETUID) out.push("SetUID: Programm läuft mit den Rechten des Besitzers");
  if (n & SETGID)
    out.push(
      "SetGID: Programm läuft mit Gruppenrechten bzw. neue Dateien im Ordner erben die Gruppe",
    );
  if (n & STICKY)
    out.push("Sticky: Im Ordner darf nur der Besitzer eigene Dateien löschen (wie /tmp)");
  if (n & bit("o", "w")) out.push("⚠ Für alle beschreibbar");
  return out;
}

/** umask → Standardrechte für neue Dateien und Ordner */
export function fromUmask(umask: number): { file: number; dir: number } {
  return { file: 0o666 & ~umask, dir: 0o777 & ~umask };
}
