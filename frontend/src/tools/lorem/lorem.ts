/** Blindtext (klassisches Lorem ipsum) */
import { randomInt } from "../password/password";

const WORDS = (
  "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam " +
  "quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum " +
  "eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum praesent " +
  "luptatum zzril delenit augue duis feugait facilisi nam liber tempor cum soluta nobis eleifend option congue nihil imperdiet doming quod mazim " +
  "placerat facer possim assum typi non habent claritatem insitam est usus legentis iis qui facit eorum claritatem investigationes demonstraverunt"
).split(" ");

const START = "Lorem ipsum dolor sit amet, consectetur adipiscing elit.";

function sentence(): string {
  const n = 6 + randomInt(10);
  const w = Array.from({ length: n }, () => WORDS[randomInt(WORDS.length)]!);
  if (n > 8) w[3 + randomInt(n - 6)] += ",";
  const s = w.join(" ");
  return `${s[0]!.toUpperCase()}${s.slice(1)}.`;
}

export function lorem(
  kind: "paragraphs" | "sentences" | "words",
  count: number,
  classicStart: boolean,
): string {
  if (kind === "words") {
    const w = Array.from({ length: count }, () => WORDS[randomInt(WORDS.length)]!);
    if (classicStart)
      w.splice(
        0,
        Math.min(5, count),
        ...START.replace(/[,.]/g, "").toLowerCase().split(" ").slice(0, Math.min(5, count)),
      );
    return w.join(" ");
  }
  if (kind === "sentences") {
    const s = Array.from({ length: count }, sentence);
    if (classicStart && count) s[0] = START;
    return s.join(" ");
  }
  const p = Array.from({ length: count }, () =>
    Array.from({ length: 4 + randomInt(4) }, sentence).join(" "),
  );
  if (classicStart && count) p[0] = `${START} ${p[0]!.split(". ").slice(1).join(". ")}`;
  return p.join("\n\n");
}
