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
