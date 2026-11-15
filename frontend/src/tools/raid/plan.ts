/** RAID planen: Plattenbedarf für eine Zielkapazität und Verhalten bei Plattenausfällen */
import { calcRaid, levelInfo, type RaidLevel } from "./raid";

/** kleinste Plattenzahl, mit der das Level die gewünschte Nutzkapazität erreicht */
export function disksNeeded(
  level: RaidLevel,
  usable: number,
  diskSize: number,
  groups = 2,
): { disks: number; usable: number } | null {
  if (!(usable > 0) || !(diskSize > 0)) return null;
  for (let n = levelInfo[level].min; n <= 1024; n++) {
    try {
      const r = calcRaid({ level, disks: n, size: diskSize, groups });
      if (r.usable >= usable) return { disks: n, usable: r.usable };
    } catch {
      // ungültige Anzahl für dieses Level (z. B. ungerade bei RAID 10) – weiter
    }
    // RAID 1 wird durch mehr Platten nicht größer
    if (level === "1") return null;
  }
  return null;
}

/** Aufteilung in Gruppen und wie viele Ausfälle jede Gruppe verkraftet */
export function layout(
  level: RaidLevel,
  disks: number,
  groups = 2,
): { groups: number[][]; tolerance: number; groupName: string } {
  const all = Array.from({ length: disks }, (_, i) => i);
  const chunk = (size: number) =>
    Array.from({ length: Math.ceil(disks / size) }, (_, g) => all.slice(g * size, (g + 1) * size));
  switch (level) {
    case "0":
    case "jbod":
      return { groups: [all], tolerance: 0, groupName: "Verbund" };
    case "1":
      return { groups: [all], tolerance: disks - 1, groupName: "Spiegel" };
    case "5":
    case "z1":
      return { groups: [all], tolerance: 1, groupName: "Verbund" };
    case "6":
    case "z2":
      return { groups: [all], tolerance: 2, groupName: "Verbund" };
    case "z3":
      return { groups: [all], tolerance: 3, groupName: "Verbund" };
    case "10":
      return { groups: chunk(2), tolerance: 1, groupName: "Spiegelpaar" };
    case "50":
      return { groups: chunk(disks / groups), tolerance: 1, groupName: "RAID-5-Gruppe" };
    case "60":
      return { groups: chunk(disks / groups), tolerance: 2, groupName: "RAID-6-Gruppe" };
  }
}

export interface ArrayState {
  state: "ok" | "degraded" | "failed";
  /** je Gruppe: ausgefallene Platten und ob die Gruppe noch lebt */
  groups: { disks: number[]; failed: number; alive: boolean; critical: boolean }[];
  text: string;
}

export function arrayState(
  level: RaidLevel,
  disks: number,
  groups: number,
  failed: Set<number>,
): ArrayState {
  calcRaid({ level, disks, size: 1, groups }); // prüft die Kombination
  const l = layout(level, disks, groups);
  const gs = l.groups.map((g) => {
    const f = g.filter((d) => failed.has(d)).length;
    return {
      disks: g,
      failed: f,
      alive: f <= l.tolerance,
      critical: f === l.tolerance && l.tolerance > 0,
    };
  });
  const dead = gs.findIndex((g) => !g.alive);
  if (dead >= 0) {
    const g = gs[dead]!;
    const where = gs.length > 1 ? `${l.groupName} ${dead + 1}` : "Im Verbund";
    return {
      state: "failed",
      groups: gs,
      text: `${where}: ${g.failed} Platten ausgefallen, verkraftbar ${l.tolerance === 0 ? "keine" : `höchstens ${l.tolerance}`} – alle Daten sind verloren.`,
    };
  }
  if (failed.size === 0) return { state: "ok", groups: gs, text: "Alle Platten in Ordnung." };
  const crit = gs.some((g) => g.critical);
  return {
    state: "degraded",
    groups: gs,
    text: crit
      ? "Verbund läuft ohne Reserve weiter (degraded) – der nächste Ausfall an der falschen Stelle bedeutet Datenverlust. Platte sofort tauschen."
      : "Verbund läuft eingeschränkt weiter (degraded) – noch ist Redundanz vorhanden. Platte bald tauschen.",
  };
}

const binom = (n: number, k: number) => {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
};

/** Anteil der Kombinationen von k gleichzeitig ausgefallenen Platten, die der Verbund überlebt (k = 1 … disks) */
export function survival(level: RaidLevel, disks: number, groups = 2): number[] {
  const l = layout(level, disks, groups);
  // Polynom: Anzahl Möglichkeiten, insgesamt k Ausfälle so zu verteilen, dass keine Gruppe überfordert ist
  let poly = [1];
  for (const g of l.groups) {
    const next = new Array<number>(poly.length + l.tolerance).fill(0);
    for (let i = 0; i < poly.length; i++)
      for (let f = 0; f <= Math.min(l.tolerance, g.length); f++)
        next[i + f]! += poly[i]! * binom(g.length, f);
    poly = next;
  }
  return Array.from({ length: disks }, (_, i) => (poly[i + 1] ?? 0) / binom(disks, i + 1));
}
