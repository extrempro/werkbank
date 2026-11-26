# Hinweise zu Fremdcode

Die Werkbank steht unter der MIT-Lizenz (siehe `LICENSE`). Teile beruhen auf fremdem Code oder
liefern fremden Code mit aus. Hier stehen die Lizenzhinweise, die dafür mitgegeben werden müssen.
Abhängigkeiten, die nur als Paket eingebunden sind, bringen ihre Lizenz im jeweiligen Paket mit.

## AutopilotQR

Vorlage für die Gerätezuordnung (Microsoft 365 › Geräte): Lesen des QR-Codes aus der
Windows-Einrichtung, Umwandeln in die Gerätedaten für Microsoft Graph, Ablauf des Scanners.
Übernommen und angepasst in:

- `backend/werkbank/modules/devices/devicelink.py`
- `backend/tests/test_devices_devicelink.py` (Testfälle)
- `frontend/src/modules/devices/decode.ts`
- `frontend/src/modules/devices/Scanner.tsx`

Quelle: https://github.com/Simsen/AutopilotQR

```
MIT License

Copyright (c) 2026 Simon Eriksen

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## zxing-wasm und ZXing-C++

QR-Erkennung im Browser (Paket `zxing-wasm`, nur der Leseteil). Die WebAssembly-Datei liefert die
Werkbank selbst aus, ohne CDN.

- zxing-wasm, https://github.com/Sec-ant/zxing-wasm – MIT-Lizenz, Copyright (c) 2023 Ze-Zheng Wu
  (Lizenztext im Paket unter `node_modules/zxing-wasm/LICENSE`).
- ZXing-C++, https://github.com/zxing-cpp/zxing-cpp, in der WebAssembly-Datei enthalten –
  Apache License 2.0, https://www.apache.org/licenses/LICENSE-2.0

## pdf.js

PDF-Seiten als Bild im Bild-Konverter (Paket `pdfjs-dist`). Bibliothek, Worker, Schriften, CMaps
und WebAssembly-Dekoder liefert die Werkbank selbst aus (unter `/assets/` und `/pdfjs/`), ohne CDN.
Die Lizenztexte der Dekoder liegen mit unter `/pdfjs/wasm/`.

- pdf.js, https://github.com/mozilla/pdf.js – Apache License 2.0, Copyright Mozilla Foundation
  (Lizenztext im Paket unter `node_modules/pdfjs-dist/LICENSE`).
- OpenJPEG (JPEG 2000) – BSD-Lizenz mit 2 Klauseln; PDFium JBIG2 – BSD-Lizenz mit 3 Klauseln;
  qcms (Farbprofile) – MIT-Lizenz. Lizenztexte im Paket unter `node_modules/pdfjs-dist/wasm/`.

## Tiptap und ProseMirror

Editor der Dokumentation (Pakete `@tiptap/*` in Version 3.34.0). Wird mit der Oberfläche
gebündelt ausgeliefert, ohne CDN und ohne Tiptap-Cloud-Dienste.

- Tiptap, https://github.com/ueberdosis/tiptap – MIT-Lizenz, Copyright (c) 2025, Tiptap GmbH
  (Lizenztext im Paket unter `node_modules/@tiptap/core/LICENSE.md`).
- ProseMirror (`prosemirror-*`), https://prosemirror.net – MIT-Lizenz, Copyright (C) 2015-2017
  Marijn Haverbeke und andere.
- linkifyjs, https://github.com/nfrasser/linkifyjs – MIT-Lizenz, Copyright (c) 2024 Nick Frasser.
- Floating UI, https://github.com/floating-ui/floating-ui – MIT-Lizenz, Copyright (c)
  2021-present Floating UI contributors.
- Weitere kleine Abhängigkeiten, alle MIT-Lizenz: orderedmap, rope-sequence, w3c-keyname (Marijn
  Haverbeke), fast-equals, use-sync-external-store.

## Yjs und pycrdt (Live-Bearbeitung der Dokumentation)

- Yjs, https://github.com/yjs/yjs – MIT-Lizenz, Copyright (c) 2023 Kevin Jahns und Mitwirkende.
- y-protocols, y-websocket (nur der Teil im Browser), lib0, https://github.com/yjs – MIT-Lizenz,
  Copyright (c) Kevin Jahns.
- @tiptap/y-tiptap, @tiptap/extension-collaboration, @tiptap/extension-collaboration-caret –
  MIT-Lizenz, Copyright (c) Tiptap GmbH bzw. Kevin Jahns (y-prosemirror, auf dem y-tiptap beruht).
- pycrdt, https://github.com/y-crdt/pycrdt – MIT-Lizenz, Copyright (c) 2023 David Brochart;
  enthält y-crdt (yrs) – MIT-Lizenz.

## Hervorhebung von Code in der Doku

Farbige Hervorhebung in Codeblöcken der Dokumentation. Die Sprachdateien von highlight.js werden
in das Frontend gebündelt (nur Bash, PowerShell, Python, JSON, YAML, XML, SQL, INI, Dockerfile,
Nginx, JavaScript, CSS, Markdown, Diff).

- highlight.js, https://github.com/highlightjs/highlight.js – BSD-3-Clause-Lizenz,
  Copyright (c) 2006, Ivan Sagalaev (Lizenztext im Paket unter `node_modules/highlight.js/LICENSE`).
- lowlight, https://github.com/wooorm/lowlight – MIT-Lizenz, Copyright (c) Titus Wormer.
- @tiptap/extension-code-block-lowlight – MIT-Lizenz, Copyright (c) Tiptap GmbH.
