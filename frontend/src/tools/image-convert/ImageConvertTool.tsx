import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { downloadBlob } from "../download";
import { clampInt, useToolParams } from "../params";
import { ErrorBox, ToolSection } from "../ui";
import {
  convertImage,
  dataUrl,
  detectEncoders,
  loadImage,
  type ConvertSettings,
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
import { resizeLabels, type ResizeMode } from "./resize";
import { createZip } from "./zip";

interface Item {
  id: number;
  file: File;
  preview?: string;
  format?: InputFormat;
  width?: number;
  height?: number;
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

const OUTPUT_ORDER: OutputFormat[] = ["png", "jpeg", "webp", "avif", "ico", "favicon", "svg"];
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
};

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

  const [items, setItems] = useState<Item[]>([]);
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
  };
  const settingsKey = JSON.stringify(settings);
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
      try {
        const image = await loadImage(item.file);
        const preview =
          item.file.size <= MAX_PREVIEW_BYTES ? await dataUrl(item.file).catch(() => undefined) : undefined;
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
      const files = [...(event.clipboardData?.files ?? [])].filter((file) =>
        file.type.startsWith("image/"),
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

  const convertAll = async () => {
    setBusy(true);
    const taken = new Set<string>();
    const queue = itemsRef.current.filter((item) => item.status === "ready");
    for (const item of queue) {
      update(item.id, { status: "converting" });
      try {
        const image = await loadImage(item.file);
        try {
          const converted = await convertImage(image, settings, item.file);
          const base =
            format === "favicon"
              ? item.file.name.replace(/(\.[^.]+)?$/, "-favicon$1")
              : item.file.name;
          update(item.id, {
            status: "ready",
            result: {
              settings: settingsKey,
              blob: converted.blob,
              name: outputName(base, converted.extension, taken),
              width: converted.width,
              height: converted.height,
              notes: converted.notes,
            },
          });
        } finally {
          image.release();
        }
      } catch (caught) {
        update(item.id, { status: "error", error: (caught as Error).message });
      }
      // Dem Browser zwischen großen Bildern Luft lassen
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
    setBusy(false);
  };

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
  const current = (item: Item) =>
    item.result?.settings === settingsKey ? item.result : undefined;
  const ready = items.filter((item) => item.status === "ready").length;
  const results = items.filter((item) => current(item));
  const totalBefore = results.reduce((sum, item) => sum + item.file.size, 0);
  const totalAfter = results.reduce((sum, item) => sum + (current(item)?.blob.size ?? 0), 0);
  const converting = items.some((item) => item.status === "converting");

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
        Bilder auswählen oder hierher ziehen
        <input
          type="file"
          multiple
          accept="image/*,.svg,.ico,.heic,.heif,.avif"
          onChange={(event) => {
            void addFiles([...(event.target.files ?? [])]);
            event.target.value = "";
          }}
        />
      </label>
      <p className="small">
        PNG, JPEG, WebP, GIF, BMP, SVG, ICO und AVIF, mehrere Dateien auf einmal. Ein Screenshot
        lässt sich mit Strg+V einfügen.
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

          {(format === "jpeg" || format === "favicon") && (
            <label>
              {format === "jpeg"
                ? "Hintergrund für transparente Bereiche"
                : "Hintergrund des Apple-Touch-Icons"}
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

      {items.length > 0 && (
        <ToolSection title={`Dateien (${items.length})`}>
          <div className="tool-row">
            <button
              type="button"
              className="button"
              disabled={busy || ready === 0 || formatUnsupported}
              onClick={() => void convertAll()}
            >
              {busy ? "Wandle um …" : `${ready} ${ready === 1 ? "Bild" : "Bilder"} umwandeln`}
            </button>
            {results.length > 1 && (
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
          {results.length > 0 && !converting && (
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
                    {item.width ? ` · ${item.width} × ${item.height} px` : ""} ·{" "}
                    {formatBytes(item.file.size)}
                  </span>
                  {item.error && <span className="hint-box hint-bad">{item.error}</span>}
                  {item.status === "converting" && (
                    <span className="small">wird umgewandelt …</span>
                  )}
                  {result && (
                    <span className="small">
                      → <span className="mono tool-break">{result.name}</span> ·{" "}
                      {result.width} × {result.height} px ·{" "}
                      {formatBytes(result.blob.size)}{" "}
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
        Alle Bilder werden nur in deinem Browser verarbeitet und nirgends hochgeladen. Beim
        Umwandeln gehen Metadaten wie EXIF, Kameradaten und GPS-Position verloren; Handyfotos
        werden dabei richtig herum gedreht.
      </p>
    </div>
  );
}
