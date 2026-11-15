/** Stromverbrauch und -kosten von Geräten */

export interface PowerInput {
  watts: number;
  count: number;
  hoursPerDay: number;
  daysPerYear: number;
  /** Cent je kWh */
  price: number;
  /** Aufschlag für Kühlung/USV im Serverraum (PUE), 1 = keiner */
  pue: number;
  /** Gramm CO₂ je kWh */
  co2: number;
}

export interface PowerResult {
  kwhDay: number;
  kwhYear: number;
  costDay: number;
  costMonth: number;
  costYear: number;
  co2Year: number;
}

export function powerCost(i: PowerInput): PowerResult {
  if (!(i.watts >= 0) || !(i.count >= 1)) throw new Error("Leistung und Anzahl prüfen.");
  if (!(i.hoursPerDay >= 0 && i.hoursPerDay <= 24))
    throw new Error("Stunden pro Tag liegen zwischen 0 und 24.");
  if (!(i.daysPerYear >= 0 && i.daysPerYear <= 366))
    throw new Error("Tage pro Jahr liegen zwischen 0 und 366.");
  if (!(i.pue >= 1)) throw new Error("PUE ist mindestens 1.");
  const kwhDay = (i.watts / 1000) * i.count * i.hoursPerDay * i.pue;
  const kwhYear = kwhDay * i.daysPerYear;
  const costYear = (kwhYear * i.price) / 100;
  return {
    kwhDay,
    kwhYear,
    costDay: (kwhDay * i.price) / 100,
    costMonth: costYear / 12,
    costYear,
    co2Year: (kwhYear * i.co2) / 1000,
  };
}
