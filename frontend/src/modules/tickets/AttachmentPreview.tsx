import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../components/Icon";
import { useModal } from "../../components/nav/useModal";
import {
  attachmentText,
  attachmentUrl,
  attachmentViewUrl,
  formatSize,
  type Attachment,
  type Entry,
  type TextPreview,
} from "./api";

const IMAGE_MARK = /\[Bild(?: (\d{1,3}))?\]/g;

/** Kurzform des Dateityps aus der Endung, z. B. „PDF“. */
function typeLabel(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(dot + 1, dot + 6).toUpperCase() : "Datei";
}

function imageLabel(att: Attachment): string {
  return att.inline_number !== null ? `Bild ${att.inline_number}` : att.filename;
}

/**
 * Text einer Nachricht mit „[Bild n]“ als Knopf, der das Bild groß zeigt. Fehlt das Bild
 * (entfernt oder unbekannt), bleibt ein Hinweis ohne Knopf.
 */
function MessageText({
  text,
  images,
  onOpen,
}: {
  text: string;
  images: Map<number, number>;
  onOpen: (index: number) => void;
}) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(IMAGE_MARK)) {
    const start = match.index ?? 0;
    parts.push(text.slice(last, start));
    const number = match[1] ? Number(match[1]) : null;
    const index = number !== null ? images.get(number) : undefined;
    if (index !== undefined) {
      parts.push(
        <button
          key={start}
          type="button"
          className="ticket-image-chip"
          onClick={() => onOpen(index)}
          aria-label={`Bild ${number} groß anzeigen`}
        >
          <Icon name="bild" />
          Bild {number}
        </button>,
      );
    } else {
      parts.push(
        <span key={start} className="ticket-image-chip ticket-image-missing">
          {number !== null ? `Bild ${number}` : "Bild"} (nicht verfügbar)
        </span>,
      );
    }
    last = start + match[0].length;
  }
  parts.push(text.slice(last));
  return <p className="ticket-entry-body">{parts}</p>;
}

/** Bilder groß: dunkle Fläche, blättern mit Knöpfen oder Pfeiltasten, Esc schließt. */
function Lightbox({
  number,
  images,
  index,
  onIndex,
  onClose,
}: {
  number: number;
  images: Attachment[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useModal(box, true, onClose, close);
  const current = images[index];
  const many = images.length > 1;
  const step = useCallback(
    (delta: number) => onIndex((index + delta + images.length) % images.length),
    [index, images.length, onIndex],
  );
  useEffect(() => {
    if (!many) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        step(-1);
      } else if (event.key === "ArrowRight") {
        step(1);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [many, step]);
  if (!current) {
    return null;
  }
  return createPortal(
    <div
      ref={box}
      className="ticket-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={imageLabel(current)}
    >
      <div className="ticket-lightbox-head">
        <p>
          <strong>{imageLabel(current)}</strong>
          <span>
            {current.inline_number !== null ? ` · ${current.filename}` : ""} ·{" "}
            {formatSize(current.size)}
            {many && ` · ${index + 1} von ${images.length}`}
          </span>
        </p>
        <a className="ticket-lightbox-button" href={attachmentUrl(number, current.id)} download>
          <Icon name="herunterladen" />
          <span className="ticket-lightbox-label">Herunterladen</span>
        </a>
        <button
          ref={close}
          type="button"
          className="ticket-lightbox-button ticket-lightbox-icon"
          onClick={onClose}
          aria-label="Schließen"
        >
          <Icon name="schliessen" />
        </button>
      </div>
      <div className="ticket-lightbox-stage">
        {many && (
          <button
            type="button"
            className="ticket-lightbox-step"
            onClick={() => step(-1)}
            aria-label="Vorheriges Bild"
          >
            <Icon name="zurueck" />
          </button>
        )}
        <img src={attachmentViewUrl(number, current.id)} alt={imageLabel(current)} />
        {many && (
          <button
            type="button"
            className="ticket-lightbox-step"
            onClick={() => step(1)}
            aria-label="Nächstes Bild"
          >
            <Icon name="weiter" />
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Textdatei als Auszug in einem Fenster. */
function TextDialog({
  number,
  attachment,
  onClose,
}: {
  number: number;
  attachment: Attachment;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [data, setData] = useState<TextPreview | null>(null);
  const [failed, setFailed] = useState(false);
  useModal(box, true, onClose, close);
  useEffect(() => {
    let active = true;
    attachmentText(number, attachment.id).then(
      (result) => active && setData(result),
      () => active && setFailed(true),
    );
    return () => {
      active = false;
    };
  }, [number, attachment.id]);
  return createPortal(
    <div className="confirm-backdrop" onClick={onClose}>
      <div
        ref={box}
        className="confirm-dialog ticket-text-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="ticket-text-head">
          <h2 id={titleId}>{attachment.filename}</h2>
          <a
            className="button button-secondary"
            href={attachmentUrl(number, attachment.id)}
            download
          >
            Herunterladen
          </a>
          <button
            ref={close}
            type="button"
            className="button button-secondary ticket-icon-only"
            onClick={onClose}
            aria-label="Schließen"
          >
            <Icon name="schliessen" />
          </button>
        </div>
        {failed ? (
          <p role="alert">Die Datei lässt sich nicht anzeigen. Lade sie herunter.</p>
        ) : data === null ? (
          <p role="status">Wird geladen …</p>
        ) : (
          <>
            <pre className="ticket-text-preview" tabIndex={0} aria-label="Inhalt">
              {data.text || "(leer)"}
            </pre>
            <p className="small">
              Nur als Text angezeigt
              {data.truncated ? ", gekürzt auf die ersten 200 KB." : "."}
            </p>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

function FileCard({
  number,
  att,
  onImage,
  onText,
}: {
  number: number;
  att: Attachment;
  onImage: () => void;
  onText: () => void;
}) {
  const info = `${typeLabel(att.filename)} · ${formatSize(att.size)}`;
  return (
    <li className="ticket-file">
      {att.preview === "image" ? (
        <button
          type="button"
          className="ticket-file-thumb"
          onClick={onImage}
          aria-label={`${att.filename} groß anzeigen`}
        >
          <img src={attachmentViewUrl(number, att.id)} alt="" loading="lazy" />
        </button>
      ) : (
        <span className="ticket-file-thumb ticket-file-type" aria-hidden="true">
          <Icon name={att.preview === "pdf" ? "pdf" : att.preview === "text" ? "text" : "datei"} />
          {typeLabel(att.filename)}
        </span>
      )}
      <div className="ticket-file-body">
        <span className="ticket-file-name">{att.filename}</span>
        <span className="small">
          {info}
          {att.preview === "pdf" && " · öffnet im neuen Tab"}
        </span>
        <span className="ticket-file-actions">
          {att.preview === "image" && (
            <button
              type="button"
              className="button button-secondary"
              onClick={onImage}
              aria-label={`${att.filename} ansehen`}
            >
              Ansehen
            </button>
          )}
          {att.preview === "text" && (
            <button
              type="button"
              className="button button-secondary"
              onClick={onText}
              aria-label={`${att.filename} ansehen`}
            >
              Ansehen
            </button>
          )}
          {att.preview === "pdf" && (
            <a
              className="button button-secondary"
              href={attachmentViewUrl(number, att.id)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${att.filename} ansehen (neuer Tab)`}
            >
              Ansehen
            </a>
          )}
          <a
            className="button button-secondary"
            href={attachmentUrl(number, att.id)}
            download
            aria-label={`${att.filename} herunterladen`}
          >
            Herunterladen
          </a>
        </span>
      </div>
    </li>
  );
}

/**
 * Text einer Nachricht mit ihren Bildern und Anhängen (spec.md 8e, „Vorschau“): eingebettete
 * Bilder als Vorschau und an ihrer Stelle im Text, Anhänge als Karten. Bilder öffnen groß,
 * PDF im neuen Tab, Textdateien als Auszug; alles andere nur zum Herunterladen.
 */
export function EntryContent({
  number,
  entry,
  text,
  children,
}: {
  number: number;
  entry: Entry;
  /** Angezeigter Text (bei langen Nachrichten gekürzt). */
  text: string;
  /** Zwischen Text und Bildern, z. B. „Ganze Nachricht anzeigen“ und das Zitat. */
  children?: ReactNode;
}) {
  const [viewer, setViewer] = useState<number | null>(null);
  const [textFile, setTextFile] = useState<Attachment | null>(null);
  const usable = entry.attachments.filter((a) => !a.removed_reason && !a.original);
  const inline = usable
    .filter((a) => a.inline_number !== null && a.preview === "image")
    .sort((a, b) => (a.inline_number ?? 0) - (b.inline_number ?? 0));
  const files = usable.filter((a) => a.inline_number === null);
  // Reihenfolge beim Blättern: erst die Bilder aus dem Text, dann die angehängten
  const gallery = [...inline, ...files.filter((a) => a.preview === "image")];
  const byNumber = new Map(inline.map((a, i) => [a.inline_number ?? 0, i]));
  const others = entry.attachments.filter((a) => a.removed_reason || a.original);
  const closeViewer = useCallback(() => setViewer(null), []);
  const closeText = useCallback(() => setTextFile(null), []);
  return (
    <>
      <MessageText text={text} images={byNumber} onOpen={setViewer} />
      {children}
      {inline.length > 0 && (
        <section className="ticket-media" aria-label="Bilder in der Nachricht">
          <p className="ticket-media-title" aria-hidden="true">
            Bilder in der Nachricht
          </p>
          <ul className="plain ticket-thumbs">
            {inline.map((att, i) => (
              <li key={att.id}>
                <button
                  type="button"
                  className="ticket-thumb"
                  onClick={() => setViewer(i)}
                  aria-label={`${imageLabel(att)} groß anzeigen`}
                >
                  <img src={attachmentViewUrl(number, att.id)} alt="" loading="lazy" />
                  <span>{imageLabel(att)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {files.length > 0 && (
        <section className="ticket-media" aria-label={`Anhänge (${files.length})`}>
          <p className="ticket-media-title" aria-hidden="true">
            Anhänge ({files.length})
          </p>
          <ul className="plain ticket-files">
            {files.map((att) => (
              <FileCard
                key={att.id}
                number={number}
                att={att}
                onImage={() => setViewer(gallery.indexOf(att))}
                onText={() => setTextFile(att)}
              />
            ))}
          </ul>
        </section>
      )}
      {others.length > 0 && (
        <ul className="plain ticket-attachments" aria-label="Weitere Dateien">
          {others.map((att) => (
            <li key={att.id}>
              {att.removed_reason ? (
                <span className="small">
                  {att.filename}: entfernt ({att.removed_reason})
                </span>
              ) : (
                <a href={attachmentUrl(number, att.id)} download>
                  Original-Mail (.eml)
                  <span className="small"> · {formatSize(att.size)}</span>
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      {viewer !== null && (
        <Lightbox
          number={number}
          images={gallery}
          index={viewer}
          onIndex={setViewer}
          onClose={closeViewer}
        />
      )}
      {textFile && <TextDialog number={number} attachment={textFile} onClose={closeText} />}
    </>
  );
}
