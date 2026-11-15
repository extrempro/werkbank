/** USV auslegen: Scheinleistung, empfohlene Größe und Überbrückungszeit */

export interface UpsLoad {
  /** Wirkleistung der Verbraucher in Watt */
  watts: number;
  /** Leistungsfaktor cos φ der Verbraucher (moderne Netzteile ≈ 0,95–1) */
  powerFactor: number;
  /** die USV soll höchstens so weit ausgelastet sein (Prozent) */
  maxLoad: number;
}

export function sizing(l: UpsLoad): { va: number; recommendedVa: number; recommendedWatts: number } {
  if (!(l.watts > 0)) throw new Error("Leistung der Verbraucher fehlt.");
  if (!(l.powerFactor > 0 && l.powerFactor <= 1)) throw new Error("Der Leistungsfaktor liegt zwischen 0 und 1.");
  if (!(l.maxLoad > 0 && l.maxLoad <= 100)) throw new Error("Die Auslastung liegt zwischen 1 und 100 %.");
  const va = l.watts / l.powerFactor;
  return { va, recommendedVa: va / (l.maxLoad / 100), recommendedWatts: l.watts / (l.maxLoad / 100) };
}

export interface Battery {
  voltage: number;
  /** Kapazität je Batterie in Ah */
  ah: number;
  count: number;
  /** Wirkungsgrad des Wechselrichters in Prozent */
  efficiency: number;
  /** nutzbarer Anteil der Kapazität in Prozent (Entladetiefe, Alterung) */
  usable: number;
}

/** gespeicherte, nutzbare Energie in Wh */
export const energyWh = (b: Battery) => b.voltage * b.ah * b.count * (b.efficiency / 100) * (b.usable / 100);

/** Überbrückungszeit in Sekunden */
export function runtime(b: Battery, watts: number): number {
  if (!(watts > 0)) throw new Error("Leistung der Verbraucher fehlt.");
  return (energyWh(b) / watts) * 3600;
}

/** nötige Kapazität je Batterie (Ah) für eine gewünschte Überbrückungszeit */
export function requiredAh(b: Omit<Battery, "ah">, watts: number, seconds: number): number {
  return (watts * (seconds / 3600)) / (b.voltage * b.count * (b.efficiency / 100) * (b.usable / 100));
}
