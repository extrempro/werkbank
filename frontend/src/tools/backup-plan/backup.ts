/** Backup-Planer: Vollsicherung, inkrementell, differenziell – Speicherbedarf, Zeitfenster, Wiederherstellung */

export type Strategy = "full" | "incremental" | "differential";
export const strategyLabels: Record<Strategy, string> = {
  full: "Täglich Vollsicherung",
  incremental: "Voll + inkrementell",
  differential: "Voll + differenziell",
};
export const weekdays = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

export interface BackupInput {
  /** Datenbestand in Byte */
  data: number;
  /** tägliche Änderungsrate in Prozent */
  change: number;
  strategy: Strategy;
  /** Wochentag der Vollsicherung, 0 = Montag */
  fullDay: number;
  /** an wie vielen Tagen pro Woche gesichert wird (ab Montag) */
  daysPerWeek: number;
  /** Aufbewahrung in Wochen */
  weeks: number;
  /** Einsparung durch Komprimierung/Deduplizierung in Prozent */
  savings: number;
  /** Durchsatz in MB/s */
  throughput: number;
}

export interface BackupDay {
  day: number;
  type: "voll" | "inkrementell" | "differenziell" | "–";
  /** gesicherte Datenmenge (vor Komprimierung) */
  size: number;
  /** belegter Speicher */
  stored: number;
  /** Dauer in Sekunden */
  seconds: number;
}

export interface BackupPlan {
  days: BackupDay[];
  weekStored: number;
  totalStored: number;
  longestSeconds: number;
}

export function backupPlan(i: BackupInput): BackupPlan {
  if (!(i.data > 0)) throw new Error("Datenmenge fehlt.");
  if (!(i.change >= 0 && i.change <= 100)) throw new Error("Änderungsrate zwischen 0 und 100 %.");
  if (!(i.daysPerWeek >= 1 && i.daysPerWeek <= 7))
    throw new Error("Sicherungstage pro Woche: 1 bis 7.");
  if (i.fullDay >= i.daysPerWeek)
    throw new Error("Am Tag der Vollsicherung wird laut Plan gar nicht gesichert.");
  if (!(i.weeks >= 1)) throw new Error("Aufbewahrung: mindestens 1 Woche.");
  if (!(i.savings >= 0 && i.savings < 100)) throw new Error("Einsparung zwischen 0 und 99 %.");
  const days: BackupDay[] = [];
  for (let d = 0; d < 7; d++) {
    if (d >= i.daysPerWeek) {
      days.push({ day: d, type: "–", size: 0, stored: 0, seconds: 0 });
      continue;
    }
    // Kalendertage seit der letzten Vollsicherung bzw. seit der letzten Sicherung überhaupt
    const sinceFull = (d - i.fullDay + 7) % 7;
    let prev = (d + 6) % 7;
    let sincePrev = 1;
    while (prev >= i.daysPerWeek) {
      prev = (prev + 6) % 7;
      sincePrev++;
    }
    let type: BackupDay["type"] = "voll";
    let size = i.data;
    if (i.strategy !== "full" && sinceFull !== 0) {
      type = i.strategy === "incremental" ? "inkrementell" : "differenziell";
      size = Math.min(
        i.data,
        (i.data * i.change * (i.strategy === "incremental" ? sincePrev : sinceFull)) / 100,
      );
    }
    const stored = size * (1 - i.savings / 100);
    days.push({
      day: d,
      type,
      size,
      stored,
      seconds: i.throughput > 0 ? size / (i.throughput * 1e6) : 0,
    });
  }
  const weekStored = days.reduce((n, d) => n + d.stored, 0);
  return {
    days,
    weekStored,
    totalStored: weekStored * i.weeks,
    longestSeconds: Math.max(...days.map((d) => d.seconds)),
  };
}

/** Welche Sicherungen braucht man, um den Stand nach der Sicherung an Tag `day` wiederherzustellen? */
export function restoreChain(
  i: BackupInput,
  day: number,
): { day: number; type: BackupDay["type"] }[] {
  const plan = backupPlan(i).days;
  if (plan[day]!.type === "–") throw new Error("An diesem Tag gibt es keine Sicherung.");
  const chain: { day: number; type: BackupDay["type"] }[] = [];
  // rückwärts bis zur letzten Vollsicherung
  for (let k = 0, d = day; k < 7; k++, d = (d + 6) % 7) {
    const t = plan[d]!.type;
    if (t === "–") continue;
    if (t === "voll") {
      chain.unshift({ day: d, type: t });
      break;
    }
    if (t === "inkrementell" || chain.length === 0) chain.unshift({ day: d, type: t });
  }
  return chain;
}
