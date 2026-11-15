/** Zeilen- und Wort-Diff (Myers, O((N+M)·D)) */

export type Op = { type: "equal" | "insert" | "delete"; a?: number; b?: number; text: string };

export function diffSeq<T>(
  a: T[],
  b: T[],
  eq: (x: T, y: T) => boolean = (x, y) => x === y,
): { type: Op["type"]; ai: number; bi: number }[] {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const v = new Map<number, number>([[1, 0]]);
  const trace: Map<number, number>[] = [];
  outer: for (let d = 0; d <= max; d++) {
    trace.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && (v.get(k - 1) ?? -1) < (v.get(k + 1) ?? -1))
          ? v.get(k + 1)!
          : v.get(k - 1)! + 1;
      let y = x - k;
      while (x < n && y < m && eq(a[x]!, b[y]!)) {
        x++;
        y++;
      }
      v.set(k, x);
      if (x >= n && y >= m) break outer;
    }
    if (d > 20000) throw new Error("Die Texte unterscheiden sich zu stark für einen Vergleich");
  }
  // Rückweg
  const ops: { type: Op["type"]; ai: number; bi: number }[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const vd = trace[d]!;
    const k = x - y;
    const prevK =
      k === -d || (k !== d && (vd.get(k - 1) ?? -1) < (vd.get(k + 1) ?? -1)) ? k + 1 : k - 1;
    const prevX = vd.get(prevK) ?? 0;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) ops.push({ type: "equal", ai: --x, bi: --y });
    if (d > 0) {
      if (x === prevX) ops.push({ type: "insert", ai: x, bi: --y });
      else ops.push({ type: "delete", ai: --x, bi: y });
    }
  }
  return ops.reverse();
}

export interface DiffOptions {
  ignoreWhitespace: boolean;
  ignoreCase: boolean;
}

export interface LineDiff {
  ops: Op[];
  added: number;
  removed: number;
}

export function diffLines(left: string, right: string, o: DiffOptions): LineDiff {
  const a = left.split(/\r?\n/);
  const b = right.split(/\r?\n/);
  const norm = (s: string) => {
    let t = o.ignoreWhitespace ? s.trim().replace(/\s+/g, " ") : s;
    if (o.ignoreCase) t = t.toLowerCase();
    return t;
  };
  const na = a.map(norm);
  const nb = b.map(norm);
  const raw = diffSeq(na, nb);
  const ops: Op[] = raw.map((r) =>
    r.type === "insert"
      ? { type: "insert", b: r.bi, text: b[r.bi]! }
      : r.type === "delete"
        ? { type: "delete", a: r.ai, text: a[r.ai]! }
        : { type: "equal", a: r.ai, b: r.bi, text: a[r.ai]! },
  );
  return {
    ops,
    added: ops.filter((x) => x.type === "insert").length,
    removed: ops.filter((x) => x.type === "delete").length,
  };
}

/** Wort-Diff zweier Zeilen für die Hervorhebung innerhalb geänderter Zeilen */
export function diffWords(a: string, b: string): { type: Op["type"]; text: string }[] {
  const ta = a.split(/(\s+|\b)/).filter(Boolean);
  const tb = b.split(/(\s+|\b)/).filter(Boolean);
  const out: { type: Op["type"]; text: string }[] = [];
  for (const r of diffSeq(ta, tb)) {
    const text = r.type === "insert" ? tb[r.bi]! : ta[r.ai]!;
    const last = out[out.length - 1];
    if (last && last.type === r.type) last.text += text;
    else out.push({ type: r.type, text });
  }
  return out;
}

/** Zeilen paaren: Blöcke aus gelöscht+eingefügt nebeneinander stellen */
export interface Row {
  left?: { no: number; text: string };
  right?: { no: number; text: string };
  type: "equal" | "change" | "insert" | "delete";
}

export function sideBySide(ops: Op[]): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < ops.length;) {
    const op = ops[i]!;
    if (op.type === "equal") {
      rows.push({
        type: "equal",
        left: { no: op.a! + 1, text: op.text },
        right: { no: op.b! + 1, text: op.text },
      });
      i++;
      continue;
    }
    const dels: Op[] = [];
    const ins: Op[] = [];
    while (i < ops.length && ops[i]!.type !== "equal") {
      (ops[i]!.type === "delete" ? dels : ins).push(ops[i]!);
      i++;
    }
    for (let j = 0; j < Math.max(dels.length, ins.length); j++) {
      const d = dels[j];
      const n = ins[j];
      rows.push({
        type: d && n ? "change" : d ? "delete" : "insert",
        left: d ? { no: d.a! + 1, text: d.text } : undefined,
        right: n ? { no: n.b! + 1, text: n.text } : undefined,
      });
    }
  }
  return rows;
}

export function unifiedDiff(ops: Op[], context = 3, names = ["vorher", "nachher"]): string {
  const lines = [`--- ${names[0]}`, `+++ ${names[1]}`];
  const changed = ops.map((o, i) => (o.type !== "equal" ? i : -1)).filter((i) => i >= 0);
  if (!changed.length) return "";
  let i = 0;
  while (i < changed.length) {
    const start = Math.max(0, changed[i]! - context);
    let end = Math.min(ops.length - 1, changed[i]! + context);
    while (i + 1 < changed.length && changed[i + 1]! - context <= end + 1) {
      i++;
      end = Math.min(ops.length - 1, changed[i]! + context);
    }
    const hunk = ops.slice(start, end + 1);
    const aStart = (hunk.find((o) => o.a !== undefined)?.a ?? 0) + 1;
    const bStart = (hunk.find((o) => o.b !== undefined)?.b ?? 0) + 1;
    const aLen = hunk.filter((o) => o.type !== "insert").length;
    const bLen = hunk.filter((o) => o.type !== "delete").length;
    lines.push(`@@ -${aStart},${aLen} +${bStart},${bLen} @@`);
    for (const o of hunk)
      lines.push(`${o.type === "insert" ? "+" : o.type === "delete" ? "-" : " "}${o.text}`);
    i++;
  }
  return lines.join("\n");
}
