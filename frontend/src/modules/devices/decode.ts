// QR-Erkennung für die Gerätezuordnung, nach der Vorlage AutopilotQR
// (https://github.com/Simsen/AutopilotQR, MIT-Lizenz, Copyright (c) 2026 Simon Eriksen).
// Lizenztext: THIRD_PARTY_NOTICES.md.
import type { ReaderOptions } from "zxing-wasm/reader";
// WASM selbst gehostet (kein CDN): Vite legt die Datei mit Versionskennung unter /assets/ ab.
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";

const OPTIONS: ReaderOptions = {
  formats: ["QRCode"],
  tryHarder: true,
  tryRotate: true,
  tryInvert: false,
  tryDownscale: true,
  maxNumberOfSymbols: 1,
};

type Reader = typeof import("zxing-wasm/reader");
let reader: Promise<Reader> | null = null;

/** Lädt den Decoder erst beim ersten Scan (die WASM-Datei ist knapp 1 MB groß). */
function load(): Promise<Reader> {
  reader ??= import("zxing-wasm/reader").then((module) => {
    module.prepareZXingModule({
      overrides: {
        locateFile: (path: string, prefix: string) =>
          path.endsWith(".wasm") ? wasmUrl : prefix + path,
      },
    });
    return module;
  });
  return reader;
}

/** Text des QR-Codes aus einem Kamerabild oder Foto, sonst `null`. */
export async function decodeQr(input: ImageData | Blob): Promise<string | null> {
  const module = await load();
  const results = await module.readBarcodes(input, OPTIONS);
  const hit = results.find((result) => result.isValid && result.text);
  return hit ? hit.text : null;
}
