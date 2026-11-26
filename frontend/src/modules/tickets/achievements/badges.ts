/**
 * Abzeichen der Erfolge in sieben Stilen. Jede Stufe (1–30) besteht aus Rang (6 Ränge, je
 * 5 Stufen) und Stufe im Rang (I–V). Der Rang bringt das Große (Farbe, Material, Flügel …),
 * die Stufe im Rang ein Detail. Das Symbol der Kategorie steht in jedem Stil mit drin.
 *
 * Ein Abzeichen ist ein Rahmen mit Ebenen aus CSS (nur Gestaltung, kein HTML aus Daten).
 * Animationen kommen aus styles.css (Keyframes „erfolg-…“) und entfallen bei reduzierter
 * Bewegung.
 */

export const STYLES = ["wappen", "neon", "fantasy", "pixel", "flach", "rang", "karte"] as const;
export type BadgeStyle = (typeof STYLES)[number];

export const STYLE_LABELS: Record<BadgeStyle, string> = {
  wappen: "Wappen",
  neon: "Neon",
  fantasy: "Fantasy",
  pixel: "Pixel",
  flach: "Flach",
  rang: "Rangabzeichen",
  karte: "Sammelkarte",
};

export const RANK_NAMES: Record<BadgeStyle, readonly string[]> = {
  wappen: ["Holz", "Stahl", "Gold", "Episch", "Legendär", "Mythisch"],
  neon: ["Schatten", "Funke", "Puls", "Strom", "Plasma", "Supernova"],
  fantasy: ["Lehrling", "Wanderer", "Ritter", "Paladin", "Drachenreiter", "Erzmagier"],
  pixel: [
    "Holzklasse",
    "Steinklasse",
    "Eisenklasse",
    "Goldklasse",
    "Kristallklasse",
    "Sternklasse",
  ],
  flach: ["Neuling", "Lehrling", "Geselle", "Profi", "Experte", "Legende"],
  rang: ["Gefreiter", "Unteroffizier", "Feldwebel", "Leutnant", "Hauptmann", "General"],
  karte: ["Gewöhnlich", "Ungewöhnlich", "Selten", "Episch", "Legendär", "Mythisch"],
};

const ROMAN = ["I", "II", "III", "IV", "V"] as const;

export interface Layer {
  css: string;
  text?: string;
}

export interface Badge {
  wrap: string;
  layers: Layer[];
}

/** Rang (0–5) und Stufe im Rang (1–5) einer Stufe 1–30. */
export function splitLevel(level: number): { rank: number; sub: number } {
  const n = Math.min(30, Math.max(1, Math.round(level)));
  const rank = Math.ceil(n / 5) - 1;
  return { rank, sub: n - 5 * rank };
}

/** Name einer Stufe im gewählten Stil, z. B. „Gold III“. */
export function levelName(style: BadgeStyle, level: number): string {
  const { rank, sub } = splitLevel(level);
  return `${RANK_NAMES[style][rank]} ${ROMAN[sub - 1]}`;
}

const ABS = "position: absolute; box-sizing: border-box; ";

function starPolygon(points: number, inner: number): string {
  const out: string[] = [];
  for (let k = 0; k < points * 2; k++) {
    const r = k % 2 === 0 ? 50 : inner;
    const a = (Math.PI / points) * k - Math.PI / 2;
    out.push(`${(50 + r * Math.cos(a)).toFixed(1)}% ${(50 + r * Math.sin(a)).toFixed(1)}%`);
  }
  return `polygon(${out.join(", ")})`;
}

const px = (v: number) => `${Math.round(v)}px`;

// --- Wappen ------------------------------------------------------------------------------

const WAPPEN = [
  {
    rim: "#d9a066, #7a4a22 55%, #4a2a12",
    field: "#a8683a, #6e3f1d",
    grain: true,
    star: "#ffffff, #c9d0dc 45%, #7a8494",
    ring: "#c9d0dc, #6b7686",
    glow: "",
  },
  {
    rim: "#f2f5fa, #9aa6b8 50%, #5b6678",
    field: "#4f8dff, #1d4bb0",
    star: "#e9eef6, #9aa6b8 50%, #59657a",
    ring: "#dfe5ee, #7a8698",
    glow: "80,140,255",
  },
  {
    rim: "#ffe9a8, #e0a22a 50%, #8a5a00",
    field: "#4fc46a, #1d7a3a",
    star: "#fff4c4, #f2b134 50%, #a86b00",
    ring: "#ffe08a, #b8860b",
    glow: "120,220,140",
  },
  {
    rim: "#f4f6fb, #a9b3c6 50%, #6a7489",
    field: "#a46bff, #5a23b8",
    star: "#ffffff, #d5dbe6 45%, #7a8494",
    ring: "#eef1f8, #8a93a3",
    wing: "#ffffff, #c9d0dc 45%, #7a8494",
    banner: "#9a5cff, #4a1d8a",
    glow: "170,120,255",
  },
  {
    rim: "#fff1b8, #f2a33a 50%, #9a4a00",
    field: "#ff5a4a, #a8121e",
    star: "#fff4c4, #f2b134 50%, #a86b00",
    ring: "#ffe08a, #c27a00",
    wing: "#fff1b8, #ffb02e 40%, #e8590c",
    banner: "#ff4a3a, #8a0f16",
    glow: "255,140,60",
  },
  {
    rim: "#ffe9ff, #ff7ad9 35%, #7a5cff 70%, #3a1d8a",
    field: "#d94dff, #5a1d9a",
    star: "#e6fffd, #4fe3ff 50%, #1a7ad0",
    ring: "#ffffff, #b49cff",
    wing: "#ff9ae6, #b07aff 40%, #4fd1ff",
    banner: "#4fd1ff, #7a5cff 50%, #c23aff",
    glow: "220,120,255",
  },
] as const;
const SHIELD =
  "polygon(10% 5%, 50% 0, 90% 5%, 100% 13%, 100% 50%, 93% 70%, 78% 86%, 50% 100%, 22% 86%, 7% 70%, 0 50%, 0 13%)";
const WING: [number, number][] = [
  [100, 26],
  [62, 0],
  [24, 4],
  [0, 18],
  [24, 26],
  [4, 40],
  [30, 46],
  [10, 60],
  [38, 64],
  [24, 80],
  [62, 78],
  [100, 66],
];

function wappen(level: number, S: number, glyph: string): Badge {
  const { rank: r, sub } = splitLevel(level);
  const K = WAPPEN[r] as (typeof WAPPEN)[number] & {
    wing?: string;
    banner?: string;
    grain?: boolean;
  };
  const W = S * 0.7;
  const H = S * 0.8;
  const left = (S - W) / 2;
  const top = S * 0.12;
  const bw = Math.max(3, Math.round(S * 0.055));
  const inner = (i: number) =>
    `${ABS}top: ${px(top + i)}; left: ${px(left + i)}; width: ${px(W - 2 * i)}; height: ${px(H - 2 * i)}; clip-path: ${SHIELD}; `;
  const st = S * (0.3 + sub * 0.016 + (r >= 3 ? 0.02 : 0));
  const cx = left + W / 2;
  const cy = top + H * 0.46;
  const wingW = S * (0.27 + (r - 3) * 0.035);
  const poly = (mirror: boolean) =>
    `polygon(${WING.map(([x, y]) => `${mirror ? 100 - x : x}% ${y}%`).join(", ")})`;
  const layers: Layer[] = [];
  if (r >= 4) {
    layers.push({
      css: `${ABS}top: ${px(cy - S * 0.55)}; left: ${px(cx - S * 0.55)}; width: ${px(S * 1.1)}; height: ${px(S * 1.1)}; border-radius: 50%; background: radial-gradient(circle, rgba(${K.glow},.45), transparent 65%)`,
    });
  }
  if (r >= 3 && K.wing) {
    for (const side of ["l", "r"] as const) {
      layers.push({
        css: `${ABS}top: ${px(top + H * 0.02)}; left: ${px(side === "l" ? left - wingW + S * 0.06 : left + W - S * 0.06)}; width: ${px(wingW)}; height: ${px(S * 0.56)}; clip-path: ${poly(side === "r")}; background: linear-gradient(${side === "l" ? "250deg" : "110deg"}, ${K.wing})`,
      });
    }
  }
  if (r >= 3 && K.banner) {
    const bh = S * (0.5 + sub * 0.02);
    layers.push({
      css: `${ABS}top: ${px(top + H * 0.62)}; left: ${px(cx - S * 0.16)}; width: ${px(S * 0.32)}; height: ${px(bh)}; background: linear-gradient(${K.banner}); border-left: ${px(Math.max(2, S * 0.025))} solid #ffd27a; border-right: ${px(Math.max(2, S * 0.025))} solid #ffd27a; clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 84%, 0 100%)`,
    });
  }
  layers.push({ css: `${inner(0)}background: linear-gradient(160deg, ${K.rim})` });
  layers.push({
    css: `${inner(bw)}background: ${K.grain ? `repeating-linear-gradient(90deg, rgba(0,0,0,.12) 0 ${px(Math.max(2, S * 0.03))}, transparent ${px(Math.max(2, S * 0.03))} ${px(Math.max(5, S * 0.09))}), ` : ""}radial-gradient(circle at 50% 30%, ${K.field})`,
  });
  if (sub >= 3) {
    const rv = Math.max(2, Math.round(S * 0.03));
    const pts = [
      [18, 14],
      [82, 14],
      [10, 46],
      [90, 46],
      [30, 80],
      [70, 80],
    ];
    layers.push({
      css: `${inner(0)}background: ${pts.map(([x, y]) => `radial-gradient(circle at ${x}% ${y}%, #fff 0 ${Math.max(1, Math.round(rv * 0.4))}px, #c9d0dc ${Math.round(rv * 0.5)}px ${rv}px, rgba(0,0,0,.35) ${rv}px ${rv + 1}px, transparent ${rv + 1}px)`).join(", ")}`,
    });
  }
  layers.push({
    css: `${inner(bw)}background: linear-gradient(170deg, rgba(255,255,255,.38), rgba(255,255,255,.06) 42%, transparent 46%)`,
  });
  if (sub >= 2) {
    layers.push({
      css: `${ABS}top: ${px(cy - st * 0.66)}; left: ${px(cx - st * 0.66)}; width: ${px(st * 1.32)}; height: ${px(st * 1.32)}; border-radius: 50%; background: conic-gradient(${K.ring}, ${K.ring.split(", ")[0]}); -webkit-mask: radial-gradient(circle, transparent 60%, #000 61%); mask: radial-gradient(circle, transparent 60%, #000 61%)`,
    });
  }
  layers.push({
    css: `${ABS}top: ${px(cy - st / 2)}; left: ${px(cx - st / 2)}; width: ${px(st)}; height: ${px(st)}; border-radius: 50%; background: radial-gradient(circle at 35% 30%, ${K.star}); box-shadow: inset 0 -${px(Math.max(1, S * 0.02))} 0 rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; font-size: ${px(st * 0.6)}; line-height: 1; font-weight: 900; color: #1b1f33`,
    text: glyph,
  });
  layers.push({
    css: `${ABS}top: ${px(cy - st / 2 + st * 0.06)}; left: ${px(cx - st * 0.32)}; width: ${px(st * 0.64)}; height: ${px(st * 0.3)}; border-radius: 50%; background: linear-gradient(rgba(255,255,255,.55), rgba(255,255,255,0))`,
  });
  if (sub === 5) {
    layers.push({
      css: `${inner(bw)}background: linear-gradient(100deg, transparent 35%, rgba(255,255,255,.5) 50%, transparent 65%); background-size: 300% 100%; animation: erfolg-glanz 3.4s ease-in-out infinite`,
    });
    layers.push({
      css: `${ABS}top: ${px(top - S * 0.02)}; left: ${px(left + W * 0.86)}; font-size: ${px(S * 0.16)}; color: #fff; text-shadow: 0 0 6px #fff; animation: erfolg-funkeln 1.8s ease-in-out infinite`,
      text: "✦",
    });
  }
  if (sub >= 4) {
    layers.push({
      css: `${ABS}top: ${px(top - S * 0.05)}; left: ${px(cx - S * 0.07)}; width: ${px(S * 0.14)}; height: ${px(S * 0.14)}; transform: rotate(45deg); background: linear-gradient(135deg, #ffffff, ${K.star.split(", ")[1]?.split(" ")[0] ?? "#fff"} 60%); border: ${px(Math.max(1, S * 0.02))} solid #ffd27a`,
    });
  }
  const label = `${ABS}left: 50%; transform: translateX(-50%); font-size: ${px(Math.max(9, S * 0.12))}; font-weight: 900; line-height: 1.4; text-align: center; `;
  if (r >= 3) {
    layers.push({
      css: `${label}top: ${px(top + H + S * 0.01)}; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,.6)`,
      text: ROMAN[sub - 1],
    });
  } else {
    layers.push({
      css: `${label}top: ${px(top + H - S * 0.06)}; min-width: ${px(S * 0.28)}; padding: 0 ${px(S * 0.05)}; border-radius: ${px(S * 0.06)}; background: linear-gradient(${K.rim}); color: #14213d; box-shadow: 0 1px 2px rgba(0,0,0,.5)`,
      text: ROMAN[sub - 1],
    });
  }
  const glow = K.glow ? (r >= 3 ? 8 + (r - 3) * 5 : 2) + (sub === 5 ? 4 : 0) : 0;
  return {
    wrap: `position: relative; display: inline-block; flex: none; width: ${px(S)}; height: ${px(S * 1.24)}; filter: drop-shadow(0 ${px(S * 0.03)} ${px(S * 0.04)} rgba(0,0,0,.45))${glow ? ` drop-shadow(0 0 ${glow}px rgba(${K.glow},.6))` : ""}`,
    layers,
  };
}

// --- Neon --------------------------------------------------------------------------------

const NEON = [
  { neon: "139,92,246", hi: "#c4b5fd", crystal: "#c4b5fd, #6d28d9", spikes: 0 },
  { neon: "217,70,239", hi: "#f0abfc", crystal: "#f5d0fe, #a21caf", spikes: 4 },
  { neon: "59,130,246", hi: "#93c5fd", crystal: "#dbeafe, #1d4ed8", spikes: 6 },
  { neon: "34,211,238", hi: "#a5f3fc", crystal: "#ecfeff, #0891b2", spikes: 8 },
  { neon: "45,212,191", hi: "#99f6e4", crystal: "#f0fdfa, #0d9488", spikes: 10 },
  { neon: "251,191,36", hi: "#fde68a", crystal: "#fff7d6, #d97706 55%, #7c3aed", spikes: 12 },
] as const;
const HEX = "polygon(50% 0, 95% 25%, 95% 75%, 50% 100%, 5% 75%, 5% 25%)";
const HELM =
  "polygon(50% 0, 78% 8%, 94% 30%, 96% 58%, 84% 80%, 64% 100%, 36% 100%, 16% 80%, 4% 58%, 6% 30%, 22% 8%)";
const VISOR = "polygon(4% 0, 50% 42%, 96% 0, 92% 52%, 50% 100%, 8% 52%)";

function neon(level: number, S: number, glyph: string): Badge {
  const { rank: r, sub } = splitLevel(level);
  const K = NEON[r]!;
  const color = `rgb(${K.neon})`;
  const cx = S / 2;
  const cy = S * 0.56;
  const cw = S * 0.66;
  const ch = S * 0.74;
  const cl = cx - cw / 2;
  const ct = cy - ch / 2;
  const lw = Math.max(2, Math.round(S * 0.03));
  const box = (i: number) =>
    `${ABS}top: ${px(ct + i)}; left: ${px(cl + i)}; width: ${px(cw - 2 * i)}; height: ${px(ch - 2 * i)}; clip-path: ${HEX}; `;
  const hw = S * 0.4;
  const hh = S * 0.42;
  const hl = cx - hw / 2;
  const ht = cy - hh * 0.55;
  const sp = S * (0.98 + r * 0.03);
  const layers: Layer[] = [
    {
      css: `${ABS}top: ${px(cy - S / 2)}; left: 0; width: ${px(S)}; height: ${px(S)}; border-radius: 50%; background: radial-gradient(circle, rgba(${K.neon},${(0.18 + r * 0.06).toFixed(2)}), transparent 65%)${r >= 4 ? "; animation: erfolg-puls 2.4s ease-in-out infinite" : ""}`,
    },
  ];
  if (K.spikes) {
    layers.push({
      css: `${ABS}top: ${px(cy - sp / 2)}; left: ${px(cx - sp / 2)}; width: ${px(sp)}; height: ${px(sp)}; clip-path: ${starPolygon(K.spikes, 30)}; background: linear-gradient(160deg, ${K.crystal})`,
    });
  }
  if (sub >= 3) {
    layers.push({
      css: `${ABS}top: ${px(cy - S * 0.14)}; left: ${px(cl - S * 0.15)}; width: ${px(S * 0.22)}; height: ${px(S * 0.28)}; clip-path: polygon(100% 25%, 0 0, 45% 50%, 0 100%, 100% 75%); background: linear-gradient(90deg, ${K.crystal})`,
    });
    layers.push({
      css: `${ABS}top: ${px(cy - S * 0.14)}; left: ${px(cl + cw - S * 0.07)}; width: ${px(S * 0.22)}; height: ${px(S * 0.28)}; clip-path: polygon(0 25%, 100% 0, 55% 50%, 100% 100%, 0 75%); background: linear-gradient(270deg, ${K.crystal})`,
    });
  }
  if (sub >= 4) {
    layers.push({
      css: `${ABS}top: ${px(ct - S * 0.17)}; left: ${px(cx - S * 0.2)}; width: ${px(S * 0.4)}; height: ${px(S * 0.24)}; clip-path: polygon(0 100%, 16% 35%, 30% 100%, 36% 100%, 50% 0, 64% 100%, 70% 100%, 84% 35%, 100% 100%); background: linear-gradient(0deg, ${K.crystal.split(", ").reverse().join(", ")})`,
    });
  }
  layers.push({ css: `${box(0)}background: ${color}` });
  if (sub >= 2) {
    layers.push({ css: `${box(lw)}background: #07070f` });
    layers.push({ css: `${box(lw * 2)}background: linear-gradient(${K.hi}, ${color})` });
  }
  layers.push({
    css: `${box(sub >= 2 ? lw * 3 : lw)}background: radial-gradient(circle at 50% 30%, #2a1f4a, #0b0b18 70%)`,
  });
  layers.push({
    css: `${ABS}top: ${px(ht - lw)}; left: ${px(hl - lw)}; width: ${px(hw + 2 * lw)}; height: ${px(hh + 2 * lw)}; clip-path: ${HELM}; background: ${color}`,
  });
  layers.push({
    css: `${ABS}top: ${px(ht)}; left: ${px(hl)}; width: ${px(hw)}; height: ${px(hh)}; clip-path: ${HELM}; background: radial-gradient(circle at 40% 25%, #3a3557, #0d0c1a 70%)`,
  });
  layers.push({
    css: `${ABS}top: ${px(ht + hh * 0.4)}; left: ${px(hl + hw * 0.12)}; width: ${px(hw * 0.76)}; height: ${px(hh * 0.24)}; clip-path: ${VISOR}; background: linear-gradient(90deg, ${K.hi}, #ffffff 50%, ${K.hi})${sub === 5 ? "; animation: erfolg-puls 1.6s ease-in-out infinite" : ""}`,
  });
  layers.push({
    css: `${ABS}top: ${px(ht + hh * 0.7)}; left: 0; width: ${px(S)}; text-align: center; font-size: ${px(S * 0.12)}; line-height: 1; color: ${K.hi}; text-shadow: 0 0 6px ${color}`,
    text: glyph,
  });
  layers.push({
    css: `${ABS}top: ${px(ct + ch - S * 0.06)}; left: 50%; transform: translateX(-50%); min-width: ${px(S * 0.26)}; padding: 0 ${px(S * 0.05)}; border-radius: ${px(S * 0.05)}; background: #07070f; color: ${K.hi}; border: ${px(Math.max(1, S * 0.018))} solid ${color}; font-size: ${px(Math.max(9, S * 0.12))}; font-weight: 900; line-height: 1.35; text-align: center; text-shadow: 0 0 6px ${color}`,
    text: ROMAN[sub - 1],
  });
  if (sub === 5) {
    layers.push({
      css: `${ABS}top: ${px(ct - S * 0.04)}; left: ${px(cl + cw * 0.9)}; font-size: ${px(S * 0.14)}; color: #fff; text-shadow: 0 0 6px ${color}; animation: erfolg-funkeln 1.8s ease-in-out infinite`,
      text: "✦",
    });
  }
  return {
    wrap: `position: relative; display: inline-block; flex: none; width: ${px(S)}; height: ${px(S * 1.12)}; filter: drop-shadow(0 0 ${4 + r * 3 + (sub === 5 ? 4 : 0)}px rgba(${K.neon},.55))`,
    layers,
  };
}

// --- Fantasy -----------------------------------------------------------------------------

const FANTASY = [
  {
    field: "#8a5a32, #3f2613",
    metal: "#6b4423, #3a220f",
    gem: ["#ffd28a", "#c27a1a"],
    glow: "224,160,64",
  },
  {
    field: "#5b6472, #23272e",
    metal: "#b5bdc9, #5b6472",
    gem: ["#9af5c2", "#1d8a4f"],
    glow: "47,191,113",
  },
  {
    field: "#2c4a8a, #101c3a",
    metal: "#eef1f6, #8a93a3",
    gem: ["#b5dcff", "#1f57c3"],
    glow: "58,160,255",
  },
  {
    field: "#8a2323, #2e0909",
    metal: "#ffe9a8, #b8860b",
    gem: ["#ffb3c1", "#c0123a"],
    glow: "255,77,109",
  },
  {
    field: "#0e5a6a, #041d24",
    metal: "#d6fbff, #3fb3cf",
    gem: ["#d6fffb", "#12b5a8"],
    glow: "95,240,230",
  },
  {
    field: "#5a2380, #160628",
    metal: "#fff1c4, #d4a017",
    gem: ["#ffffff", "#9b5de5"],
    glow: "217,184,255",
  },
] as const;
const FSHIELD =
  "polygon(0 0, 100% 0, 100% 48%, 94% 66%, 82% 80%, 66% 91%, 50% 100%, 34% 91%, 18% 80%, 6% 66%, 0 48%)";
const GEM = "polygon(30% 0, 70% 0, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0 70%, 0 30%)";
const RUNES = "ᚠᚢᚦᚨᚱ";
const CRESTS = ["", "✦", "⚔", "♛", "⚜", "☽✦☾"];

function fantasy(level: number, S: number, glyph: string): Badge {
  const { rank: r, sub } = splitLevel(level);
  const K = FANTASY[r]!;
  const W = S * 0.78;
  const H = S * 0.92;
  const left = (S - W) / 2;
  const top = S * 0.24;
  const bw = Math.max(3, Math.round(S * (0.06 + r * 0.006)));
  const g = S * (0.24 + r * 0.025 + sub * 0.012);
  const layers: Layer[] = [];
  if (r >= 3) {
    const d = S * (1.08 + (r - 3) * 0.1);
    layers.push({
      css: `${ABS}top: ${px(top + H * 0.42 - d / 2)}; left: ${px(S / 2 - d / 2)}; width: ${px(d)}; height: ${px(d)}; border-radius: 50%; border: 1px dashed rgba(${K.glow},.9); background: repeating-conic-gradient(rgba(${K.glow},.35) 0 4deg, transparent 4deg 20deg); -webkit-mask: radial-gradient(circle, transparent 46%, #000 48%, #000 70%, transparent 72%); mask: radial-gradient(circle, transparent 46%, #000 48%, #000 70%, transparent 72%)${r >= 4 ? `; animation: erfolg-dreh ${r === 5 ? 12 : 20}s linear infinite` : ""}`,
    });
  }
  layers.push({
    css: `${ABS}top: ${px(top)}; left: ${px(left)}; width: ${px(W)}; height: ${px(H)}; clip-path: ${FSHIELD}; background: linear-gradient(135deg, ${K.metal})`,
  });
  layers.push({
    css: `${ABS}top: ${px(top + bw)}; left: ${px(left + bw)}; width: ${px(W - 2 * bw)}; height: ${px(H - 2 * bw)}; clip-path: ${FSHIELD}; background: ${r >= 1 ? "linear-gradient(90deg, transparent 47%, rgba(255,255,255,.12) 47% 53%, transparent 53%), " : ""}${r >= 2 ? "linear-gradient(0deg, transparent 47%, rgba(255,255,255,.1) 47% 53%, transparent 53%), " : ""}radial-gradient(circle at 50% 35%, ${K.field})`,
  });
  layers.push({
    css: `${ABS}top: ${px(top + H * 0.36 - g / 2)}; left: ${px((S - g) / 2)}; width: ${px(g)}; height: ${px(g)}; clip-path: ${GEM}; background: conic-gradient(from 45deg, ${K.gem[0]}, ${K.gem[1]}, ${K.gem[0]}, ${K.gem[1]}, ${K.gem[0]}); display: flex; align-items: center; justify-content: center; font-size: ${px(g * 0.5)}; font-weight: 900; color: rgba(0,0,0,.6)${r >= 4 ? "; animation: erfolg-puls 2.6s ease-in-out infinite" : ""}`,
    text: glyph,
  });
  layers.push({
    css: `${ABS}top: ${px(top + H * 0.62)}; left: 0; width: ${px(S)}; text-align: center; font-size: ${px(Math.max(9, S * 0.16))}; font-weight: 700; line-height: 1; color: #fff; text-shadow: 0 0 3px rgb(${K.glow}), 0 0 8px rgba(${K.glow},.9)`,
    text: RUNES.slice(0, sub),
  });
  if (r >= 1) {
    layers.push({
      css: `${ABS}top: ${px(S * 0.02)}; left: 0; width: ${px(S)}; text-align: center; font-size: ${px(S * (0.16 + r * 0.015))}; line-height: 1; color: ${K.metal.split(", ")[0]}; text-shadow: 0 0 6px rgba(${K.glow},.8)`,
      text: CRESTS[r],
    });
  }
  return {
    wrap: `position: relative; display: inline-block; flex: none; width: ${px(S)}; height: ${px(S * 1.24)}${r >= 2 ? `; filter: drop-shadow(0 0 ${r * 2 + sub}px rgba(${K.glow},.7))` : ""}`,
    layers,
  };
}

// --- Pixel, Flach, Rangabzeichen, Sammelkarte -------------------------------------------

const COLORS = [
  { a: "#b07a4a", b: "#6b4423", c: "#e0b48a" },
  { a: "#8a93a3", b: "#4f5765", c: "#c9d0dc" },
  { a: "#3aa0ff", b: "#1f57c3", c: "#a8d4ff" },
  { a: "#f2b134", b: "#9a6a00", c: "#ffe08a" },
  { a: "#3fd0c9", b: "#0e7090", c: "#b5f3ef" },
  { a: "#e0457b", b: "#8a1446", c: "#ffb3cd" },
] as const;
const PSHIELD =
  "polygon(8% 0, 92% 0, 92% 6%, 100% 6%, 100% 58%, 94% 58%, 94% 68%, 88% 68%, 88% 77%, 79% 77%, 79% 85%, 69% 85%, 69% 92%, 59% 92%, 59% 100%, 41% 100%, 41% 92%, 31% 92%, 31% 85%, 21% 85%, 21% 77%, 12% 77%, 12% 68%, 6% 68%, 6% 58%, 0 58%, 0 6%, 8% 6%)";

function pixel(level: number, S: number, glyph: string): Badge {
  const { rank: r, sub } = splitLevel(level);
  const K = COLORS[r]!;
  const w = S * (0.78 + r * 0.04);
  const left = (S - w) / 2;
  const top = S * 0.18;
  const ins = Math.max(3, Math.round(S * 0.07));
  const layers: Layer[] = [
    {
      css: `${ABS}top: ${px(top)}; left: ${px(left)}; width: ${px(w)}; height: ${px(w)}; background: #14141f; clip-path: ${PSHIELD}`,
    },
    {
      css: `${ABS}top: ${px(top + ins)}; left: ${px(left + ins)}; width: ${px(w - 2 * ins)}; height: ${px(w - 2 * ins)}; clip-path: ${PSHIELD}; background: linear-gradient(${K.c} 0 22%, ${K.a} 22% 70%, ${K.b} 70%)`,
    },
    {
      css: `${ABS}top: ${px(top + ins * 2)}; left: ${px(left + ins * 2)}; width: ${px(S * 0.12)}; height: ${px(S * 0.12)}; background: rgba(255,255,255,.8); box-shadow: ${px(S * 0.12)} 0 0 rgba(255,255,255,.45), 0 ${px(S * 0.12)} 0 rgba(255,255,255,.45)`,
    },
    {
      css: `${ABS}top: ${px(top + w * 0.24)}; left: 0; width: ${px(S)}; text-align: center; font-family: monospace; font-weight: 900; font-size: ${px(S * 0.26)}; color: #fff; text-shadow: 2px 2px 0 #14141f`,
      text: glyph,
    },
    {
      css: `${ABS}bottom: 0; left: 0; width: ${px(S)}; text-align: center; font-size: ${px(S * 0.16)}; line-height: 1; letter-spacing: 1px; color: #ffd27a; text-shadow: 1px 1px 0 #14141f`,
      text: "■".repeat(sub) + "□".repeat(5 - sub),
    },
  ];
  if (r >= 1) {
    layers.push({
      css: `${ABS}top: 0; left: 0; width: ${px(S)}; text-align: center; font-family: monospace; font-weight: 900; font-size: ${px(S * 0.15)}; color: ${K.a}; text-shadow: 1px 1px 0 #14141f`,
      text: ["", "+", "++", "✦", "✦✦", "♛"][r],
    });
  }
  return {
    wrap: `position: relative; display: inline-block; flex: none; width: ${px(S)}; height: ${px(S * 1.32)}`,
    layers,
  };
}

function flach(level: number, S: number, glyph: string): Badge {
  const { rank: r, sub } = splitLevel(level);
  const K = COLORS[r]!;
  const seg = 72;
  const ring = `conic-gradient(${[0, 1, 2, 3, 4].map((k) => `${k < sub ? K.b : "#e3e6eb"} ${k * seg + 3}deg ${(k + 1) * seg - 3}deg, #fff ${(k + 1) * seg - 3}deg ${(k + 1) * seg + 3}deg`).join(", ")})`;
  const layers: Layer[] = [];
  if (r >= 3) {
    layers.push({
      css: `${ABS}top: 0; left: 0; width: ${px(S)}; height: ${px(S)}; background: ${K.c}; clip-path: ${starPolygon(r >= 5 ? 12 : r >= 4 ? 10 : 8, 40)}`,
    });
  }
  if (r >= 1) {
    layers.push({
      css: `${ABS}top: ${px(S * 0.62)}; left: ${px(S * 0.15)}; width: ${px(S * 0.7)}; height: ${px(S * 0.5)}; background: ${K.b}; clip-path: polygon(0 0, 100% 0, 85% 100%, 70% 80%, 50% 100%, 30% 80%, 15% 100%)`,
    });
  }
  layers.push({
    css: `${ABS}top: ${px(S * 0.08)}; left: ${px(S * 0.08)}; width: ${px(S * 0.84)}; height: ${px(S * 0.84)}; border-radius: 50%; background: ${ring}`,
  });
  layers.push({
    css: `${ABS}top: ${px(S * 0.17)}; left: ${px(S * 0.17)}; width: ${px(S * 0.66)}; height: ${px(S * 0.66)}; border-radius: 50%; background: ${K.a}; box-shadow: inset 0 -${px(S * 0.06)} 0 ${K.b}; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: ${px(S * 0.28)}; color: #fff`,
    text: glyph,
  });
  if (r >= 5) {
    layers.push({
      css: `${ABS}top: ${px(-S * 0.14)}; left: 0; width: ${px(S)}; text-align: center; font-size: ${px(S * 0.24)}; color: #f2b134`,
      text: "♛",
    });
  }
  return {
    wrap: `position: relative; display: inline-block; flex: none; width: ${px(S)}; height: ${px(S * 1.3)}`,
    layers,
  };
}

function rang(level: number, S: number, glyph: string): Badge {
  const { rank: r, sub } = splitLevel(level);
  const K = COLORS[r]!;
  const W = S * 0.74;
  const H = S * 0.98;
  const left = (S - W) / 2;
  const top = S * 0.2;
  const radius = `${px(S * 0.12)} ${px(S * 0.12)} 50% 50% / ${px(S * 0.12)} ${px(S * 0.12)} 30% 30%`;
  const layers: Layer[] = [
    {
      css: `${ABS}top: ${px(top)}; left: ${px(left)}; width: ${px(W)}; height: ${px(H)}; border-radius: ${radius}; background: linear-gradient(#2b3a2b, #1a241a); box-shadow: 0 0 0 ${px(Math.max(2, S * 0.04))} ${K.a}`,
    },
    {
      css: `${ABS}top: ${px(top + 4)}; left: ${px(left + 4)}; width: ${px(W - 8)}; height: ${px(H - 8)}; border-radius: ${radius}; border: 1px dashed ${K.c}`,
    },
    {
      css: `${ABS}top: ${px(top + H * 0.3)}; left: 0; width: ${px(S)}; text-align: center; font-weight: 800; font-size: ${px(S * 0.26)}; line-height: ${px(S * 0.09)}; color: ${K.c}; white-space: pre; text-shadow: 0 1px 0 #000`,
      text: Array.from({ length: sub }, () => "︿").join("\n"),
    },
    {
      css: `${ABS}top: ${px(top + H * 0.74)}; left: 0; width: ${px(S)}; text-align: center; font-size: ${px(S * 0.13)}; color: ${K.c}`,
      text: glyph,
    },
  ];
  if (r >= 1) {
    layers.push({
      css: `${ABS}top: ${px(top + H * 0.08)}; left: 0; width: ${px(S)}; text-align: center; font-size: ${px(S * (r >= 4 ? 0.13 : 0.16))}; letter-spacing: 1px; color: ${K.c}`,
      text: "★".repeat(r),
    });
  }
  if (r >= 5) {
    layers.push({
      css: `${ABS}top: ${px(S * 0.02)}; left: 0; width: ${px(S)}; text-align: center; font-size: ${px(S * 0.18)}; color: #f2b134`,
      text: "✠",
    });
  }
  return {
    wrap: `position: relative; display: inline-block; flex: none; width: ${px(S)}; height: ${px(S * 1.25)}`,
    layers,
  };
}

function karte(level: number, S: number, glyph: string): Badge {
  const { rank: r, sub } = splitLevel(level);
  const K = COLORS[r]!;
  const W = S * 0.78;
  const H = S * 1.08;
  const left = (S - W) / 2;
  const top = S * 0.08;
  const layers: Layer[] = [
    {
      css: `${ABS}top: ${px(top)}; left: ${px(left)}; width: ${px(W)}; height: ${px(H)}; border-radius: ${px(S * 0.07)}; background: linear-gradient(160deg, ${K.c}, ${K.a} 45%, ${K.b})`,
    },
    {
      css: `${ABS}top: ${px(top + S * 0.16)}; left: ${px(left + S * 0.06)}; width: ${px(W - S * 0.12)}; height: ${px(H * 0.52)}; border-radius: ${px(S * 0.04)}; background: radial-gradient(circle at 50% 40%, #fff, ${K.c} 70%); display: flex; align-items: center; justify-content: center; font-size: ${px(S * 0.3)}; color: ${K.b}`,
      text: glyph,
    },
  ];
  if (r >= 2) {
    layers.push({
      css: `${ABS}top: ${px(top)}; left: ${px(left)}; width: ${px(W)}; height: ${px(H)}; border-radius: ${px(S * 0.07)}; background: linear-gradient(115deg, transparent 20%, rgba(255,0,150,.35), rgba(0,220,255,.35), rgba(255,240,0,.35), transparent 80%); background-size: 200% 100%; mix-blend-mode: screen; opacity: ${(0.3 + r * 0.14).toFixed(2)}${r >= 4 ? "; animation: erfolg-holo 4s linear infinite" : ""}`,
    });
  }
  layers.push({
    css: `${ABS}top: ${px(top + S * 0.025)}; left: 0; width: ${px(S)}; text-align: center; font-weight: 800; font-size: ${px(Math.max(8, S * 0.11))}; color: #fff; text-shadow: 0 1px 1px rgba(0,0,0,.6)`,
    text: ROMAN[sub - 1],
  });
  layers.push({
    css: `${ABS}top: ${px(top + H * 0.76)}; left: 0; width: ${px(S)}; text-align: center; font-size: ${px(Math.max(8, S * 0.12))}; letter-spacing: 1px; color: #fff; text-shadow: 0 1px 1px rgba(0,0,0,.6)`,
    text: "◆".repeat(sub) + "◇".repeat(5 - sub),
  });
  return {
    wrap: `position: relative; display: inline-block; flex: none; width: ${px(S)}; height: ${px(S * 1.22)}${r >= 3 ? `; filter: drop-shadow(0 0 ${r * 2}px ${K.a})` : ""}`,
    layers,
  };
}

const DRAW: Record<BadgeStyle, (level: number, size: number, glyph: string) => Badge> = {
  wappen,
  neon,
  fantasy,
  pixel,
  flach,
  rang,
  karte,
};

/** Abzeichen einer Stufe (1–30) im Stil. Ohne erreichte Stufe: gesperrt (grau). */
export function drawBadge(style: BadgeStyle, level: number, size: number, glyph: string): Badge {
  if (level < 1) {
    const badge = DRAW[style](1, size, "?");
    return { ...badge, wrap: `${badge.wrap}; filter: grayscale(1) brightness(.55); opacity: .7` };
  }
  return DRAW[style](level, size, glyph);
}

/** CSS-Text in ein Style-Objekt für React (nur feste, eigene Werte, keine Nutzerdaten). */
export function cssObject(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of css.split(";")) {
    const at = part.indexOf(":");
    if (at < 0) {
      continue;
    }
    const name = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (!name || !value) {
      continue;
    }
    const key = name.startsWith("-webkit-")
      ? `Webkit${name
          .slice(8)
          .replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
          .replace(/^./, (c) => c.toUpperCase())}`
      : name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    out[key] = value;
  }
  return out;
}
