import { FixedChoice } from "../../components/ListChoice";
import { useEffect, useId, useRef, useState } from "react";
import { useConfirm } from "../../components/ConfirmDialog";
import { PHONE_QUERY, useMediaQuery } from "../../components/FilterBar";
import { downloadBlob } from "../download";
import { fetchNetStatus } from "../lib/net";
import { CopyButton, Segmented } from "../ui";
import {
  countText,
  formatHtml,
  PREVIEW_MESSAGE,
  PREVIEW_READY,
  PREVIEW_URL,
  TEMPLATES,
  type TemplateId,
} from "./html";

type Width = "pc" | "tablet" | "handy";

const WIDTHS: readonly (readonly [Width, string])[] = [
  ["pc", "PC"],
  ["tablet", "Tablet"],
  ["handy", "Handy"],
];
const WIDTH_TEXT: Record<Width, string> = {
  pc: "volle Breite",
  tablet: "Tablet, 768 px",
  handy: "Handy, 375 px",
};

/** Wartezeit nach dem Tippen, bevor die Vorschau neu gezeichnet wird. */
const PREVIEW_DELAY = 250;

/**
 * HTML eingeben und als Vorschau sehen. Die Vorschau ist eine eigene Seite der Werkbank im
 * iframe mit enger Sicherheitsrichtlinie (kein Zugriff auf Konto und Werkbank, keine Skripte
 * aus dem HTML); der Inhalt bleibt im Browser und kommt über einen eigenen Nachrichtenkanal hinein.
 */
export default function HtmlEditorTool() {
  const [html, setHtml] = useState("");
  const [template, setTemplate] = useState<TemplateId>("leer");
  const [width, setWidth] = useState<Width>("pc");
  const [view, setView] = useState<"html" | "vorschau">("html");
  const [internet, setInternet] = useState<boolean | null>(null);
  // Kanal zur Vorschau; jede neue Meldung „bereit“ (auch nach Neuladen) bringt einen neuen.
  const [port, setPort] = useState<MessagePort | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const phone = useMediaQuery(PHONE_QUERY);
  const [ask, dialog] = useConfirm();
  const codeId = useId();
  const counts = countText(html);

  useEffect(() => {
    let active = true;
    fetchNetStatus().then(
      (status) => active && setInternet(status.enabled),
      () => active && setInternet(null),
    );
    return () => {
      active = false;
    };
  }, []);

  // Die Vorschau meldet sich, sobald sie bereit ist (auch nach jedem Neuladen des Rahmens).
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (
        event.source === frame.current?.contentWindow &&
        (event.data as { type?: unknown } | null)?.type === PREVIEW_READY &&
        event.ports[0]
      ) {
        setPort(event.ports[0]);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (!port) {
      return undefined;
    }
    const timer = window.setTimeout(
      () => port.postMessage({ type: PREVIEW_MESSAGE, html }),
      PREVIEW_DELAY,
    );
    return () => window.clearTimeout(timer);
  }, [html, port]);

  useEffect(() => () => port?.close(), [port]);

  const showCode = !phone || view === "html";
  const showPreview = !phone || view === "vorschau";
  const previewWidth = phone ? "handy" : width;

  return (
    <div className="tool-body settings-form">
      <div className="tool-row">
        <FixedChoice
          label="Vorlage"
          value={template}
          options={(Object.keys(TEMPLATES) as TemplateId[]).map((key) => ({
            value: key,
            label: TEMPLATES[key].label,
          }))}
          onChange={(next) => {
            const load = () => {
              setTemplate(next);
              setHtml(TEMPLATES[next].html);
            };
            if (html.trim() && html !== TEMPLATES[template].html) {
              ask(
                {
                  title: "Vorlage laden?",
                  text: "Dein HTML wird ersetzt. Es ist nirgends gespeichert.",
                  action: "Laden",
                },
                load,
              );
            } else {
              load();
            }
          }}
        />
        <button
          type="button"
          className="button button-secondary"
          disabled={!html.trim()}
          onClick={() => setHtml(formatHtml(html))}
        >
          Formatieren
        </button>
        {!phone && (
          <Segmented
            label="Breite der Vorschau"
            value={width}
            options={WIDTHS}
            onChange={setWidth}
          />
        )}
      </div>

      {phone && (
        <Segmented
          label="Ansicht"
          value={view}
          options={[
            ["html", "HTML"],
            ["vorschau", "Vorschau"],
          ]}
          onChange={setView}
        />
      )}

      <div className="html-editor">
        {showCode && (
          <div className="html-editor-pane">
            <label htmlFor={codeId}>HTML</label>
            <textarea
              id={codeId}
              className="html-editor-code"
              value={html}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              rows={phone ? 16 : 24}
              placeholder="<p>Hallo Welt</p>"
              onChange={(event) => setHtml(event.target.value)}
            />
            <p className="small">
              {counts.lines} {counts.lines === 1 ? "Zeile" : "Zeilen"} · {counts.chars} Zeichen ·
              Der Inhalt bleibt nur auf dieser Seite.
            </p>
          </div>
        )}
        {/* Der Rahmen bleibt am Handy geladen, damit die Vorschau beim Umschalten sofort steht. */}
        <div className="html-editor-pane" hidden={!showPreview}>
          <p className="html-editor-label">
            Vorschau <span className="small">· {WIDTH_TEXT[previewWidth]}</span>
          </p>
          <div className="html-editor-stage">
            <iframe
              ref={frame}
              className={`html-editor-frame html-editor-frame-${previewWidth}`}
              src={PREVIEW_URL}
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              title="Vorschau des eingegebenen HTML"
            />
          </div>
          <p className="small">
            Nur HTML und CSS; Skripte, Formulare und eingebettete Seiten zeigt die Vorschau nicht.{" "}
            {internet === true &&
              "Bilder aus dem Internet lädt dein Browser direkt von der angegebenen Adresse."}
            {internet === false &&
              "Bilder aus dem Internet sind aus, weil die Verwaltung Abfragen ins Internet ausgeschaltet hat; eingebettete Bilder (data:) gehen."}
          </p>
        </div>
      </div>

      <div className="tool-row">
        <CopyButton value={html} label="HTML kopieren" />
        <button
          type="button"
          className="button button-secondary"
          disabled={!html.trim()}
          onClick={() =>
            downloadBlob(new Blob([html], { type: "text/html;charset=utf-8" }), "vorschau.html")
          }
        >
          Als .html herunterladen
        </button>
        <button
          type="button"
          className="button button-danger"
          disabled={!html}
          onClick={() =>
            ask(
              {
                title: "HTML leeren?",
                text: "Dein HTML wird gelöscht. Es ist nirgends gespeichert und lässt sich nicht zurückholen.",
                action: "Leeren",
                danger: true,
              },
              () => {
                setHtml("");
                setTemplate("leer");
              },
            )
          }
        >
          Leeren
        </button>
      </div>
      {dialog}
    </div>
  );
}
