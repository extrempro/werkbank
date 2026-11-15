/** Passphrasen aus einer Wortliste (Diceware-Prinzip) */
import { randomInt } from "../password/password";

export interface PassphraseOptions {
  words: number;
  separator: string;
  capitalize: boolean;
  addNumber: boolean;
  addSymbol: boolean;
}

const SYMBOLS = "!#$%&*+-=?@";

export function makePassphrase(list: string[], o: PassphraseOptions): string {
  const words = Array.from({ length: o.words }, () => list[randomInt(list.length)]!).map((w) =>
    o.capitalize ? w[0]!.toUpperCase() + w.slice(1) : w,
  );
  if (o.addNumber) {
    const i = randomInt(words.length);
    words[i] = `${words[i]}${randomInt(10)}`;
  }
  if (o.addSymbol) {
    const i = randomInt(words.length);
    words[i] = `${words[i]}${SYMBOLS[randomInt(SYMBOLS.length)]}`;
  }
  return words.join(o.separator);
}

/** Entropie in Bit (Großschreibung erhöht nicht, Zahl/Zeichen leicht) */
export function passphraseBits(listSize: number, o: PassphraseOptions): number {
  return (
    o.words * Math.log2(listSize) +
    (o.addNumber ? Math.log2(10 * o.words) : 0) +
    (o.addSymbol ? Math.log2(SYMBOLS.length * o.words) : 0)
  );
}
