// Wortliste „de-7776-v1“ von dys2p/wordlists-de (CC0) – wird erst bei Bedarf geladen
import raw from "./de-7776.txt?raw";

export const words: string[] = raw
  .split("\n")
  .map((w) => w.trim())
  .filter(Boolean);
