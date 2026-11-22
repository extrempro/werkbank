import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { downloadBlob } from "../download";
import { clampInt, useToolParams } from "../params";
import { ErrorBox, ToolSection } from "../ui";
import {
  canvasImage,
  convertImage,
  dataUrl,
  detectEncoders,
  loadImage,
  pdfBlob,
  pdfPage,
  type ConvertSettings,
  type LoadedImage,
} from "./convert";
import {
  detectFormat,
  formatBytes,
  inputLabels,
  outputInfo,
  outputName,
  sizeChange,
  type InputFormat,
  type OutputFormat,
} from "./formats";
import { ICO_SIZES } from "./ico";
import { parsePageRange, pdfPageSizeLabels, type PdfPage, type PdfPageSize } from "./pdf";
import { resizeLabels, type ResizeMode } from "./resize";
import { createZip, type ZipEntry } from "./zip";

interface Item {
  id: number;
  file: File;
  preview?: string;
  format?: InputFormat;
  width?: number;
  height?: number;
  /** Seitenzahl bei PDFs */
  pages?: number;
  error?: string;
  status: "loading" | "ready" | "converting" | "error";
  /** Ergebnis samt den Einstellungen, mit denen es entstand. */
  result?: {
    settings: string;
    blob: Blob;
    name: string;
    width: number;
    height: number;
    notes: string[];
  };
}

const OUTPUT_ORDER: OutputFormat[] = [
  "png",
  "jpeg",
  "webp",
  "avif",
  "pdf",
  "ico",
  "favicon",
  "svg",
];
const PAGE_SIZES = Object.keys(pdfPageSizeLabels) as PdfPageSize[];
const DPI_OPTIONS = ["72", "150", "300"];
/** Vorschau der ersten PDF-Seite: etwa so breit wie das Vorschaubild in der Liste */
const PREVIEW_DPI = 24;
const RESIZE_MODES = Object.keys(resizeLabels) as ResizeMode[];
const MAX_FILE_BYTES = 200 * 1024 * 1024;
/** Größere Dateien bekommen keine Vorschau, damit der Speicher nicht volläuft. */
const MAX_PREVIEW_BYTES = 10 * 1024 * 1024;

const DEFAULTS = {
  format: "png",
  qualitaet: "85",
  groesse: "original",
  wert: "1920",
  vergroessern: "0",
  hintergrund: "ffffff",
  ico: "16,32,48,256",
  seite: "a4",
  einzeln: "0",
  dpi: "150",
  seiten: "",
};

interface Combined {
  settings: string;
  blob: Blob;
  name: string;
  pages: number;
}

/** Lädt pdf.js erst, wenn wirklich eine PDF kommt. */
const pdfReader = () => import("./pdfread");

/** Bilder eines Eintrags: ein Bild oder die gewählten Seiten einer PDF, nacheinander. */
async function* imagesOf(
  item: Item,
  pageNumbers: number[],
  dpi: number,
): AsyncGenerator<{ image: LoadedImage; page?: number }> {
  if (item.format !== "pdf") {
    yield { image: await loadImage(item.file) };
    return;
  }
  const { openPdf, renderPage } = await pdfReader();
  const pdf = await openPdf(item.file);
  try {
    for (const page of pageNumbers) {
      yield { image: canvasImage(await renderPage(pdf.document, page, dpi)), page };
    }
  } finally {
    pdf.close();
  }
}

const pageSuffix = (page: number, count: number) =>
  `-seite-${String(page).padStart(String(count).length, "0")}`;

let nextId = 1;

export default function ImageConvertTool() {
  // In der Adresszeile stehen nur Einstellungen; die Bilder bleiben im Browser.
  const [params, setParams] = useToolParams(DEFAULTS);
  const format: OutputFormat = OUTPUT_ORDER.includes(params.format as OutputFormat)
    ? (params.format as OutputFormat)
    : "png";
  const quality = clampInt(params.qualitaet, 1, 100, 85);
  const resize: ResizeMode = RESIZE_MODES.includes(params.groesse as ResizeMode)
    ? (params.groesse as ResizeMode)
    : "original";
  const size = clampInt(params.wert, 1, 16384, 1920);
  const background = /^[0-9a-f]{6}$/i.test(params.hintergrund) ? params.hintergrund : "ffffff";
  const parsedIco = params.ico
    .split(",")
    .map(Number)
    .filter((value) => ICO_SIZES.includes(value));
  const icoSizes = parsedIco.length > 0 ? parsedIco : [16, 32, 48, 256];
  const pageSize: PdfPageSize = PAGE_SIZES.includes(params.seite as PdfPageSize)
    ? (params.seite as PdfPageSize)
    : "a4";
  const separate = params.einzeln === "1";
  const dpi = DPI_OPTIONS.includes(params.dpi) ? Number(params.dpi) : 150;
  const pageText = params.seiten.slice(0, 200);

  const [items, setItems] = useState<Item[]>([]);
  const [combined, setCombined] = useState<Combined | null>(null);
  const [encoders, setEncoders] = useState<Set<OutputFormat> | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const settings: ConvertSettings = {
    format,
    quality,
    resize: { mode: resize, value: size, noUpscale: params.vergroessern !== "1" },
    background: `#${background}`,
    icoSizes,
    pageSize,
  };
  const settingsKey = JSON.stringify({ settings, separate, dpi, pageText });
  const info = outputInfo[format];
  const formatUnsupported = encoders !== null && !encoders.has(format);

  useEffect(() => {
    void detectEncoders().then(setEncoders);
  }, []);

  const update = (id: number, patch: Partial<Item>) =>
    setItems((list) => list.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  const addFiles = useCallback(async (files: File[]) => {
    const fresh: Item[] = files.map((file) => ({ id: nextId++, file, status: "loading" }));
    setItems((list) => [...list, ...fresh]);
    for (const item of fresh) {
      if (item.file.size > MAX_FILE_BYTES) {
        update(item.id, {
          status: "error",
          error: `Datei zu groß (${formatBytes(item.file.size)}, höchstens 200 MB).`,
        });
        continue;
      }
      const detected = detectFormat(new Uint8Array(await item.file.slice(0, 1024).arrayBuffer()));
      if (detected === "pdf") {
        try {
          const { openPdf, renderPage } = await pdfReader();
          const pdf = await openPdf(item.file);
          try {
            const first = await renderPage(pdf.document, 1, PREVIEW_DPI);
            update(item.id, {
              status: "ready",
              format: detected,
              pages: pdf.pages,
              // Maße der ersten Seite bei 96 dpi, wie ein Bild auf dem Bildschirm
              width: Math.round((pdf.width * 96) / 72),
              height: Math.round((pdf.height * 96) / 72),
              preview: first.toDataURL("image/png"),
            });
          } finally {
            pdf.close();
          }
        } catch (caught) {
          update(item.id, { status: "error", format: detected, error: (caught as Error).message });
        }
        continue;
      }
      try {
        const image = await loadImage(item.file);
        const preview =
          item.file.size <= MAX_PREVIEW_BYTES
            ? await dataUrl(item.file).catch(() => undefined)
            : undefined;
        update(item.id, {
          status: "ready",
          format: detected,
          width: image.width,
          height: image.height,
          preview,
        });
        image.release();
      } catch (caught) {
        update(item.id, { status: "error", format: detected, error: (caught as Error).message });
      }
    }
  }, []);

  // Bilder aus der Zwischenablage, z. B. ein Screenshot mit Strg+V
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
        return;
      }
      const files = [...(event.clipboardData?.files ?? [])].filter(
        (file) => file.type.startsWith("image/") || file.type === "application/pdf",
      );
      if (files.length === 0) {
        return;
      }
      event.preventDefault();
      const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
      void addFiles(
        files.map(
          (file, index) =>
            new File(
              [file],
              file.name && file.name !== "image.png"
                ? file.name
                : `eingefuegt-${stamp}${index ? `-${index + 1}` : ""}.png`,
              { type: file.type },
            ),
        ),
      );
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addFiles]);

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    void addFiles([...event.dataTransfer.files]);
  };

  /** Gewählte Seiten einer PDF oder null, wenn die Angabe nicht passt. */
  const pagesFor = (item: Item): number[] | null =>
    item.format === "pdf" ? parsePageRange(pageText, item.pages ?? 1) : [1];

  const convertAll = async () => {
    setBusy(true);
    setCombined(null);
    const queue = itemsRef.current.filter((item) => item.status === "ready");
    if (format === "pdf" && !separate) await convertToOnePdf(queue);
    else await convertEach(queue);
    setBusy(false);
  };

  /** Alle Bilder und PDF-Seiten der Liste nacheinander in eine PDF. */
  const convertToOnePdf = async (queue: Item[]) => {
    const pages: PdfPage[] = [];
    for (const item of queue) {
      const numbers = pagesFor(item);
      if (!numbers) {
        update(item.id, { status: "error", error: pageRangeError(item) });
        continue;
      }
      update(item.id, { status: "converting", result: undefined });
      try {
        for await (const { image } of imagesOf(item, numbers, dpi)) {
          try {
            pages.push(await pdfPage(image, settings));
          } finally {
            image.release();
          }
        }
        update(item.id, { status: "ready" });
      } catch (caught) {
        update(item.id, { status: "error", error: (caught as Error).message });
      }
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
    if (pages.length > 0) {
      const first = queue[0]?.file.name ?? "dokument";
      setCombined({
        settings: settingsKey,
        blob: pdfBlob(pages),
        name: queue.length === 1 ? outputName(first, "pdf", new Set()) : "bilder.pdf",
        pages: pages.length,
      });
    }
  };

  /** Jede Datei für sich; mehrere Seiten einer PDF werden ein ZIP. */
  const convertEach = async (queue: Item[]) => {
    const taken = new Set<string>();
    const singleImage = format === "ico" || format === "favicon";
    for (const item of queue) {
      const selected = pagesFor(item);
      if (!selected) {
        update(item.id, { status: "error", error: pageRangeError(item) });
        continue;
      }
      // Symbole entstehen aus einem Bild: bei PDFs aus der ersten gewählten Seite
      const numbers = singleImage ? selected.slice(0, 1) : selected;
      update(item.id, { status: "converting" });
      try {
        const onePageOfMany =
          item.format === "pdf" && (item.pages ?? 1) > 1 && numbers.length === 1;
        const named = onePageOfMany
          ? item.file.name.replace(/(\.[^.]+)?$/, `${pageSuffix(numbers[0]!, item.pages ?? 1)}$1`)
          : item.file.name;
        const base = format === "favicon" ? named.replace(/(\.[^.]+)?$/, "-favicon$1") : named;
        const entries: ZipEntry[] = [];
        const pdfPages: PdfPage[] = [];
        const notes = new Set<string>();
        let last: { blob: Blob; extension: string; width: number; height: number } | null = null;
        let first: { width: number; height: number } | null = null;
        const inner = new Set<string>();
        for await (const { image, page } of imagesOf(item, numbers, dpi)) {
          try {
            if (format === "pdf") {
              const converted = await pdfPage(image, settings);
              pdfPages.push(converted);
              first ??= { width: converted.pixelWidth, height: converted.pixelHeight };
              continue;
            }
            const converted = await convertImage(image, settings, item.file);
            converted.notes.forEach((note) => notes.add(note));
            first ??= converted;
            last = converted;
            if (page !== undefined && numbers.length > 1) {
              entries.push({
                name: outputName(
                  base.replace(/(\.[^.]+)?$/, `${pageSuffix(page, item.pages ?? 1)}$1`),
                  converted.extension,
                  inner,
                ),
                data: new Uint8Array(await converted.blob.arrayBuffer()),
              });
            }
          } finally {
            image.release();
          }
          await new Promise((resolve) => window.setTimeout(resolve, 0));
        }
        if (singleImage && item.format === "pdf" && (item.pages ?? 1) > 1) {
          notes.add(`Aus Seite ${numbers[0]} der PDF.`);
        }
        let blob: Blob;
        let extension: string;
        if (format === "pdf") {
          blob = pdfBlob(pdfPages);
          extension = "pdf";
          if (item.format === "pdf") {
            notes.add("Seiten als Bild übernommen – Text lässt sich nicht mehr markieren.");
          }
        } else if (entries.length > 0) {
          blob = new Blob([createZip(entries) as BlobPart], { type: "application/zip" });
          extension = "zip";
          notes.add(`${entries.length} Seiten als einzelne Bilder im ZIP.`);
        } else {
          blob = last!.blob;
          extension = last!.extension;
        }
        update(item.id, {
          status: "ready",
          result: {
            settings: settingsKey,
            blob,
            name: outputName(base, extension, taken),
            width: first!.width,
            height: first!.height,
            notes: [...notes],
          },
        });
      } catch (caught) {
        update(item.id, { status: "error", error: (caught as Error).message });
      }
      // Dem Browser zwischen großen Bildern Luft lassen
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
  };

  const pageRangeError = (item: Item) =>
    `Die Seitenangabe „${pageText}“ passt nicht zu dieser PDF (${item.pages ?? 1} Seiten).`;

  const downloadAll = async () => {
    const done = itemsRef.current.filter((item) => item.result?.settings === settingsKey);
    const entries = await Promise.all(
      done.map(async (item) => ({
        name: item.result!.name,
        data: new Uint8Array(await item.result!.blob.arrayBuffer()),
      })),
    );
    downloadBlob(
      new Blob([createZip(entries) as BlobPart], { type: "application/zip" }),
      `bilder-${outputInfo[format].extension}.zip`,
    );
  };

  // Ergebnisse gelten nur für die Einstellungen, mit denen sie entstanden.
  const current = (item: Item) => (item.result?.settings === settingsKey ? item.result : undefined);
  const ready = items.filter((item) => item.status === "ready").length;
  const results = items.filter((item) => current(item));
  const totalBefore = results.reduce((sum, item) => sum + item.file.size, 0);
  const totalAfter = results.reduce((sum, item) => sum + (current(item)?.blob.size ?? 0), 0);
  const converting = items.some((item) => item.status === "converting");
  const hasPdf = items.some((item) => item.format === "pdf");
  const pageTextInvalid =
    pageText.trim() !== "" &&
    items.some((item) => item.format === "pdf" && pagesFor(item) === null);
  const oneFile = format === "pdf" && !separate;
  const currentCombined = combined?.settings === settingsKey ? combined : null;

  const toggleIco = (value: number) => {
    const next = icoSizes.includes(value)
      ? icoSizes.filter((entry) => entry !== value)
      : [...icoSizes, value].sort((a, b) => a - b);
    if (next.length > 0) {
      setParams({ ico: next.join(",") });
    }
  };

  return (
    <div className="tool-body settings-form">
      <label
        className={dragging ? "tool-drop tool-drop-active" : "tool-drop"}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        Bilder oder PDFs auswählen oder hierher ziehen
        <input
          type="file"
          multiple
          accept="image/*,.svg,.ico,.heic,.heif,.avif,application/pdf,.pdf"
          onChange={(event) => {
            void addFiles([...(event.target.files ?? [])]);
            event.target.value = "";
          }}
        />
      </label>
      <p className="small">
        PNG, JPEG, WebP, GIF, BMP, SVG, ICO, AVIF und PDF, mehrere Dateien auf einmal. Ein
        Screenshot lässt sich mit Strg+V einfügen.
      </p>

      <ToolSection title="Zielformat">
        <div className="chips" role="group" aria-label="Zielformat">
          {OUTPUT_ORDER.map((key) => {
            const unsupported = encoders !== null && !encoders.has(key);
            return (
              <button
                key={key}
                type="button"
                className="chip chip-filter"
                aria-pressed={format === key}
                disabled={unsupported}
                onClick={() => setParams({ format: key })}
              >
                {outputInfo[key].label}
              </button>
            );
          })}
        </div>
        <p className="small">{info.hint}</p>
        {formatUnsupported && (
          <ErrorBox>
            Dieser Browser kann {info.label} nicht erzeugen. Bitte ein anderes Format wählen.
          </ErrorBox>
        )}
      </ToolSection>

      <ToolSection title="Einstellungen">
        <div className="tool-columns">
          {format !== "ico" && format !== "favicon" && (
            <div className="tool-field">
              <div className="tool-row">
                <label>
                  Größe
                  <select
                    value={resize}
                    onChange={(event) => setParams({ groesse: event.target.value })}
                  >
                    {RESIZE_MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {resizeLabels[mode]}
                      </option>
                    ))}
                  </select>
                </label>
                {resize !== "original" && (
                  <label className="narrow">
                    {resize === "percent" ? "Prozent" : "Pixel"}
                    <input
                      type="number"
                      min={1}
                      value={params.wert}
                      onChange={(event) => setParams({ wert: event.target.value })}
                    />
                  </label>
                )}
              </div>
              {resize !== "original" && (
                <label className="check-label">
                  <input
                    type="checkbox"
                    className="check"
                    checked={params.vergroessern === "1"}
                    onChange={(event) =>
                      setParams({ vergroessern: event.target.checked ? "1" : "0" })
                    }
                  />
                  Kleinere Bilder vergrößern
                </label>
              )}
            </div>
          )}

          {info.lossy && (
            <div className="tool-field">
              <label>
                Qualität: {quality}
                <input
                  type="range"
                  min={1}
                  max={100}
                  value={quality}
                  onChange={(event) => setParams({ qualitaet: event.target.value })}
                />
              </label>
              <p className="small">75 bis 85 ist für Fotos meist der beste Kompromiss.</p>
            </div>
          )}

          {format === "pdf" && (
            <div className="tool-field">
              <label>
                Seitengröße
                <select
                  value={pageSize}
                  onChange={(event) => setParams({ seite: event.target.value })}
                >
                  {PAGE_SIZES.map((key) => (
                    <option key={key} value={key}>
                      {pdfPageSizeLabels[key]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  className="check"
                  checked={separate}
                  onChange={(event) => setParams({ einzeln: event.target.checked ? "1" : "0" })}
                />
                Je Datei eine eigene PDF
              </label>
              <p className="small">
                {pageSize === "a4"
                  ? "Hoch oder quer wie das Bild, mit 1 cm Rand; kleine Bilder werden nicht vergrößert."
                  : "Jede Seite so groß wie ihr Bild, ohne Rand."}
              </p>
            </div>
          )}

          {(format === "jpeg" || format === "favicon" || format === "pdf") && (
            <label>
              {format === "favicon"
                ? "Hintergrund des Apple-Touch-Icons"
                : "Hintergrund für transparente Bereiche"}
              <input
                type="color"
                value={`#${background}`}
                onChange={(event) => setParams({ hintergrund: event.target.value.slice(1) })}
              />
            </label>
          )}

          {format === "ico" && (
            <fieldset className="tool-options">
              <legend>Enthaltene Größen</legend>
              <div className="tool-row">
                {ICO_SIZES.map((value) => (
                  <label key={value} className="check-label">
                    <input
                      type="checkbox"
                      className="check"
                      checked={icoSizes.includes(value)}
                      onChange={() => toggleIco(value)}
                    />
                    {value} px
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </div>
      </ToolSection>

      {hasPdf && (
        <ToolSection title="PDF-Seiten">
          <div className="tool-columns">
            <label>
              Auflösung
              <select
                value={String(dpi)}
                onChange={(event) => setParams({ dpi: event.target.value })}
              >
                {DPI_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value} dpi
                    {value === "72" ? " (Bildschirm)" : value === "300" ? " (Druck)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Seiten (leer = alle)
              <input
                type="text"
                inputMode="numeric"
                placeholder="z. B. 1-3, 5"
                maxLength={200}
                value={params.seiten}
                aria-invalid={pageTextInvalid || undefined}
                aria-describedby="pdf-seiten-hinweis"
                onChange={(event) => setParams({ seiten: event.target.value })}
              />
            </label>
          </div>
          <p id="pdf-seiten-hinweis" className="small">
            Jede Seite wird ein eigenes Bild, mehrere Seiten kommen als ZIP. Die Seitenangabe gilt
            für alle PDFs in der Liste.
          </p>
          {pageTextInvalid && (
            <ErrorBox>Die Seitenangabe passt nicht zu jeder PDF in der Liste.</ErrorBox>
          )}
        </ToolSection>
      )}

      {items.length > 0 && (
        <ToolSection title={`Dateien (${items.length})`}>
          <div className="tool-row">
            <button
              type="button"
              className="button"
              disabled={busy || ready === 0 || formatUnsupported}
              onClick={() => void convertAll()}
            >
              {busy
                ? "Wandle um …"
                : oneFile
                  ? `${ready} ${ready === 1 ? "Datei" : "Dateien"} in eine PDF`
                  : `${ready} ${ready === 1 ? "Datei" : "Dateien"} umwandeln`}
            </button>
            {results.length > 1 && !oneFile && (
              <button
                type="button"
                className="button button-secondary"
                disabled={busy}
                onClick={() => void downloadAll()}
              >
                Alle als ZIP herunterladen
              </button>
            )}
            <button
              type="button"
              className="button button-secondary"
              disabled={busy}
              onClick={() => setItems([])}
            >
              Liste leeren
            </button>
          </div>
          {currentCombined && !converting && (
            <div className="hint-box tool-result" role="status">
              <span>
                <span className="mono tool-break">{currentCombined.name}</span> ·{" "}
                {currentCombined.pages} {currentCombined.pages === 1 ? "Seite" : "Seiten"} ·{" "}
                {formatBytes(currentCombined.blob.size)}
              </span>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => downloadBlob(currentCombined.blob, currentCombined.name)}
              >
                PDF herunterladen
              </button>
            </div>
          )}
          {results.length > 0 && !converting && !oneFile && (
            <p className="small" role="status">
              Gesamt {formatBytes(totalBefore)} → {formatBytes(totalAfter)} (
              {sizeChange(totalBefore, totalAfter)})
            </p>
          )}

          <ul className="image-list">
            {items.map((item) => {
              const result = current(item);
              return (
                <li key={item.id} className="image-item">
                  {item.preview ? (
                    <img src={item.preview} alt="" className="image-thumb" />
                  ) : (
                    <span className="image-thumb" aria-hidden="true" />
                  )}
                  <div className="image-info">
                    <strong className="tool-break">{item.file.name}</strong>
                    <span className="small">
                      {item.format ? inputLabels[item.format] : "…"}
                      {item.pages
                        ? ` · ${item.pages} ${item.pages === 1 ? "Seite" : "Seiten"}`
                        : item.width
                          ? ` · ${item.width} × ${item.height} px`
                          : ""}{" "}
                      · {formatBytes(item.file.size)}
                    </span>
                    {item.error && <span className="hint-box hint-bad">{item.error}</span>}
                    {item.status === "converting" && (
                      <span className="small">wird umgewandelt …</span>
                    )}
                    {result && (
                      <span className="small">
                        → <span className="mono tool-break">{result.name}</span> · {result.width} ×{" "}
                        {result.height} px · {formatBytes(result.blob.size)}{" "}
                        <span
                          className={
                            result.blob.size <= item.file.size
                              ? "pill pill-ok"
                              : "pill pill-neutral"
                          }
                        >
                          {sizeChange(item.file.size, result.blob.size)}
                        </span>
                      </span>
                    )}
                    {result?.notes.map((note) => (
                      <span key={note} className="small">
                        {note}
                      </span>
                    ))}
                  </div>
                  <div className="tool-row">
                    {result && (
                      <button
                        type="button"
                        className="button button-secondary"
                        onClick={() => downloadBlob(result.blob, result.name)}
                      >
                        Herunterladen
                      </button>
                    )}
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={busy}
                      aria-label={`${item.file.name} entfernen`}
                      onClick={() =>
                        setItems((list) => list.filter((entry) => entry.id !== item.id))
                      }
                    >
                      Entfernen
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </ToolSection>
      )}

      <p className="small">
        Alle Dateien werden nur in deinem Browser verarbeitet und nirgends hochgeladen. Beim
        Umwandeln gehen Metadaten wie EXIF, Kameradaten und GPS-Position verloren; Handyfotos werden
        dabei richtig herum gedreht. PDF-Seiten werden als Bild übernommen, Text und Links gehen
        dabei verloren.
      </p>
    </div>
  );
}
