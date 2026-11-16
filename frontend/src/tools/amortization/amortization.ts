/** Amortisationsrechnung: statisch und mit Abzinsung (dynamisch) */

export interface AmortInput {
  investment: number;
  /** jährlicher Rückfluss: Ersparnis bzw. Gewinn (+ Abschreibung) */
  returns: number;
  /** laufende Mehrkosten pro Jahr (Wartung, Lizenzen) */
  costs: number;
  /** Kalkulationszins in Prozent, 0 = statisch */
  interest: number;
  years: number;
}

export interface AmortYear {
  year: number;
  net: number;
  discounted: number;
  cumulative: number;
  cumulativeDiscounted: number;
}

export interface AmortResult {
  rows: AmortYear[];
  /** Jahre bis zur Amortisation; null = nie (innerhalb der Rechnung) */
  staticYears: number | null;
  dynamicYears: number | null;
  /** Überschuss am Ende der Nutzungsdauer */
  surplus: number;
  /** Kapitalwert (abgezinster Überschuss) */
  npv: number;
  roiPercent: number;
}

export function amortization(i: AmortInput): AmortResult {
  if (!(i.investment > 0)) throw new Error("Investition fehlt.");
  if (!(i.years >= 1 && i.years <= 100)) throw new Error("Nutzungsdauer zwischen 1 und 100 Jahren.");
  const net = i.returns - i.costs;
  const q = 1 + i.interest / 100;
  const rows: AmortYear[] = [];
  let cum = -i.investment;
  let cumD = -i.investment;
  let dynamicYears: number | null = null;
  for (let y = 1; y <= Math.floor(i.years); y++) {
    const d = net / q ** y;
    const before = cumD;
    cum += net;
    cumD += d;
    if (dynamicYears === null && cumD >= 0 && d > 0) dynamicYears = y - 1 + -before / d;
    rows.push({ year: y, net, discounted: d, cumulative: cum, cumulativeDiscounted: cumD });
  }
  return {
    rows,
    staticYears: net > 0 ? i.investment / net : null,
    dynamicYears,
    surplus: cum,
    npv: cumD,
    roiPercent: (cum / i.investment) * 100,
  };
}

/** 2,5 → „2 Jahre 6 Monate“ */
export function yearsText(y: number): string {
  const months = Math.round(y * 12);
  const yy = Math.floor(months / 12);
  const mm = months % 12;
  const parts = [yy ? `${yy} ${yy === 1 ? "Jahr" : "Jahre"}` : "", mm ? `${mm} ${mm === 1 ? "Monat" : "Monate"}` : ""].filter(Boolean);
  return parts.join(" ") || "sofort";
}
