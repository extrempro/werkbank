/** RAID-Kapazität, Ausfallsicherheit und Schreib-Penalty */

export type RaidLevel = "0" | "1" | "5" | "6" | "10" | "50" | "60" | "z1" | "z2" | "z3" | "jbod";

export const levelInfo: Record<RaidLevel, { label: string; min: number; desc: string }> = {
  "0": { label: "RAID 0 (Striping)", min: 2, desc: "Keine Redundanz – fällt eine Platte aus, sind alle Daten weg." },
  "1": { label: "RAID 1 (Spiegel)", min: 2, desc: "Alle Platten enthalten dieselben Daten." },
  "5": { label: "RAID 5 (einfache Parität)", min: 3, desc: "Eine Platte darf ausfallen. Bei großen Platten ist der Rebuild riskant." },
  "6": { label: "RAID 6 (doppelte Parität)", min: 4, desc: "Zwei Platten dürfen ausfallen." },
  "10": { label: "RAID 10 (Spiegel + Striping)", min: 4, desc: "Je Spiegelpaar darf eine Platte ausfallen. Schnell beim Schreiben." },
  "50": { label: "RAID 50 (RAID 5-Gruppen gestriped)", min: 6, desc: "Je Gruppe darf eine Platte ausfallen." },
  "60": { label: "RAID 60 (RAID 6-Gruppen gestriped)", min: 8, desc: "Je Gruppe dürfen zwei Platten ausfallen." },
  z1: { label: "ZFS RAIDZ1", min: 3, desc: "Wie RAID 5: eine Platte darf ausfallen." },
  z2: { label: "ZFS RAIDZ2", min: 4, desc: "Wie RAID 6: zwei Platten dürfen ausfallen." },
  z3: { label: "ZFS RAIDZ3", min: 5, desc: "Drei Platten dürfen ausfallen." },
  jbod: { label: "JBOD / Spanning", min: 1, desc: "Platten hintereinander – keine Redundanz." },
};

export interface RaidInput {
  level: RaidLevel;
  disks: number;
  /** Größe je Platte in Byte */
  size: number;
  /** Anzahl Gruppen (nur 50/60) */
  groups: number;
}

export interface RaidResult {
  usable: number;
  raw: number;
  dataDisks: number;
  efficiency: number;
  /** garantiert überlebte Ausfälle */
  tolerates: number;
  /** im günstigsten Fall überlebte Ausfälle */
  toleratesBest: number;
  writePenalty: number;
  /** Lese-/Schreibleistung relativ zu einer Platte (grobe Faustregel) */
  readFactor: number;
  writeFactor: number;
}

export function calcRaid(i: RaidInput): RaidResult {
  const { level, disks: n, size } = i;
  const info = levelInfo[level];
  if (!Number.isInteger(n) || n < info.min) throw new Error(`${info.label} braucht mindestens ${info.min} Platten.`);
  if (!(size > 0)) throw new Error("Plattengröße fehlt.");
  let data: number;
  let tol: number;
  let best: number;
  let penalty: number;
  switch (level) {
    case "0":
    case "jbod":
      [data, tol, best, penalty] = [n, 0, 0, 1];
      break;
    case "1":
      [data, tol, best, penalty] = [1, n - 1, n - 1, 2];
      break;
    case "5":
    case "z1":
      [data, tol, best, penalty] = [n - 1, 1, 1, 4];
      break;
    case "6":
    case "z2":
      [data, tol, best, penalty] = [n - 2, 2, 2, 6];
      break;
    case "z3":
      [data, tol, best, penalty] = [n - 3, 3, 3, 8];
      break;
    case "10":
      if (n % 2) throw new Error("RAID 10 braucht eine gerade Anzahl Platten.");
      [data, tol, best, penalty] = [n / 2, 1, n / 2, 2];
      break;
    case "50":
    case "60": {
      const p = level === "50" ? 1 : 2;
      const g = i.groups;
      if (!Number.isInteger(g) || g < 2) throw new Error("Mindestens 2 Gruppen.");
      if (n % g) throw new Error(`${n} Platten lassen sich nicht gleichmäßig auf ${g} Gruppen verteilen.`);
      if (n / g < p + 2) throw new Error(`Jede Gruppe braucht mindestens ${p + 2} Platten.`);
      [data, tol, best, penalty] = [n - g * p, p, g * p, level === "50" ? 4 : 6];
      break;
    }
  }
  const readFactor = level === "1" || level === "10" ? n : level === "jbod" ? 1 : level === "0" ? n : data;
  const writeFactor = level === "jbod" ? 1 : n / penalty;
  return { usable: data * size, raw: n * size, dataDisks: data, efficiency: data / n, tolerates: tol, toleratesBest: best, writePenalty: penalty, readFactor, writeFactor };
}
