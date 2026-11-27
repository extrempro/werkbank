import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { errorText } from "../api";
import {
  base64Bytes,
  browserLabel,
  canCaptureScreen,
  captureScreen,
  FEEDBACK_KIND_LABELS,
  FEEDBACK_PATH,
  FEEDBACK_TEXT_MAX,
  FEEDBACK_TEXT_MIN,
  feedbackDraft,
  imageFileToJpeg,
  keepFeedbackDraft,
  sendFeedback,
  technicalInfo,
  type Feedback,
  type FeedbackKind,
} from "../feedback";
import { navigate } from "../router";
import { ChoiceCards, Field } from "./Field";
import { Icon } from "./Icon";
import { useModal } from "./nav/useModal";

/**
 * Rückmeldung geben (Fehler oder Idee) zur aktuellen Seite: Fenster über der Seite, am Handy
 * als Blatt von unten. Bei Fehlern freiwillig ein Bildschirmfoto (aufnehmen, auswählen oder
 * einfügen) und sichtbar, welche technischen Angaben mitgehen. Ein Entwurf bleibt je Seite
 * erhalten, solange die Werkbank offen ist.
 */
export function FeedbackDialog({
  page,
  pageTitle,
  onClose,
}: {
  page: string;
  pageTitle: string;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const draft = feedbackDraft(page);
  const [kind, setKind] = useState<FeedbackKind | null>(draft.kind);
  const [text, setText] = useState(draft.text);
  const [shot, setShot] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [shotProblem, setShotProblem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<Feedback | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const tech = technicalInfo();

  const close = () => {
    if (!sent) {
      keepFeedbackDraft(page, kind, text);
    }
    onClose();
  };
  useModal(box, true, close);

  useEffect(() => {
    if (sent) {
      keepFeedbackDraft(page, null, "");
    }
  }, [sent, page]);

  const takeImage = (promise: Promise<string>) => {
    setShotProblem(null);
    promise.then(setShot, (reason: unknown) => {
      // Abbruch beim Aufnehmen ist kein Fehler
      if (reason instanceof DOMException && reason.name === "NotAllowedError") {
        return;
      }
      setShotProblem(reason instanceof Error ? reason.message : "Das Bild ließ sich nicht lesen.");
    });
  };

  const onPaste = (event: ClipboardEvent) => {
    if (kind !== "fehler") {
      return;
    }
    const item = Array.from(event.clipboardData.items).find((entry) =>
      entry.type.startsWith("image/"),
    );
    const blob = item?.getAsFile();
    if (blob) {
      event.preventDefault();
      takeImage(imageFileToJpeg(blob));
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!kind) {
      setProblem("Bitte wähle, ob es ein Fehler oder eine Idee ist.");
      return;
    }
    const trimmed = text.trim();
    if (trimmed.length < FEEDBACK_TEXT_MIN) {
      setProblem(
        kind === "fehler"
          ? "Beschreib es bitte etwas genauer: Was wolltest du tun, und was ist passiert?"
          : "Beschreib deine Idee bitte mit ein paar Worten.",
      );
      return;
    }
    setProblem(null);
    setBusy(true);
    setError(null);
    sendFeedback({
      kind,
      text: trimmed,
      page,
      ...(kind === "fehler" ? { technical: tech, ...(shot ? { screenshot: shot } : {}) } : {}),
    }).then(
      (result) => {
        setSent(result);
        setBusy(false);
      },
      (reason: unknown) => {
        setError(errorText(reason, "Die Rückmeldung konnte nicht gesendet werden."));
        setBusy(false);
      },
    );
  };

  return createPortal(
    <div className="confirm-backdrop feedback-backdrop" onClick={close}>
      <div
        ref={box}
        className="confirm-dialog feedback-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rueckmeldung-titel"
        onClick={(event) => event.stopPropagation()}
        onPaste={onPaste}
      >
        <div className="feedback-head">
          <h2 id="rueckmeldung-titel">Rückmeldung geben</h2>
          <button type="button" className="sheet-close" aria-label="Schließen" onClick={close}>
            <Icon name="schliessen" />
          </button>
        </div>
        {sent ? (
          <div className="feedback-body">
            <p role="status" className="hint-box hint-ok">
              Danke, deine Meldung {sent.number} ist angekommen.
            </p>
            <p>
              Antwortet die IT oder ändert sich der Stand, bekommst du eine Benachrichtigung an der
              Glocke.
            </p>
            <div className="project-actions">
              <a
                className="button button-secondary"
                href={FEEDBACK_PATH}
                onClick={(event) => {
                  event.preventDefault();
                  onClose();
                  navigate(FEEDBACK_PATH);
                }}
              >
                Meine Rückmeldungen
              </a>
              <button type="button" className="button button-primary" onClick={onClose}>
                Schließen
              </button>
            </div>
          </div>
        ) : (
          <form className="feedback-body" onSubmit={onSubmit} noValidate>
            <p className="small">
              Zur Seite <strong>{pageTitle}</strong>
            </p>
            <ChoiceCards
              legend="Was möchtest du melden?"
              value={kind}
              onChange={(value) => {
                setKind(value);
                setProblem(null);
              }}
              error={kind ? null : problem}
              options={[
                {
                  value: "fehler",
                  label: FEEDBACK_KIND_LABELS.fehler,
                  hint: "Etwas funktioniert nicht wie erwartet",
                },
                { value: "idee", label: FEEDBACK_KIND_LABELS.idee, hint: "Was besser werden kann" },
              ]}
            />
            {kind && (
              <>
                <Field
                  label={kind === "fehler" ? "Was ist passiert?" : "Deine Idee"}
                  required
                  hint="5 bis 2000 Zeichen. Keine Passwörter oder Daten anderer Personen eintragen."
                  error={problem}
                >
                  {(control) => (
                    <textarea
                      {...control}
                      rows={4}
                      maxLength={FEEDBACK_TEXT_MAX}
                      value={text}
                      onChange={(event) => setText(event.target.value)}
                    />
                  )}
                </Field>
                {kind === "fehler" && (
                  <div className="feedback-shot">
                    <span className="field-label">Bildschirmfoto (freiwillig)</span>
                    {shot ? (
                      <div className="feedback-shot-preview">
                        <img
                          src={`data:image/jpeg;base64,${shot}`}
                          alt="Vorschau des Bildschirmfotos"
                        />
                        <span className="small">{Math.round(base64Bytes(shot) / 1024)} KB</span>
                        <button
                          type="button"
                          className="button button-secondary"
                          onClick={() => setShot(null)}
                        >
                          Entfernen
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="project-actions">
                          {canCaptureScreen() && (
                            <button
                              type="button"
                              className="button button-secondary"
                              onClick={() => takeImage(captureScreen())}
                            >
                              <Icon name="kamera" /> Bildschirm aufnehmen
                            </button>
                          )}
                          <button
                            type="button"
                            className="button button-secondary"
                            onClick={() => file.current?.click()}
                          >
                            <Icon name="bild" /> Bild auswählen
                          </button>
                          <input
                            ref={file}
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            hidden
                            aria-label="Bild auswählen"
                            onChange={(event) => {
                              const picked = event.target.files?.[0];
                              event.target.value = "";
                              if (picked) {
                                takeImage(imageFileToJpeg(picked));
                              }
                            }}
                          />
                        </div>
                        <span className="small">
                          Oder mit Strg + V einfügen. Du siehst es vor dem Senden.
                        </span>
                      </>
                    )}
                    {shotProblem && (
                      <p role="alert" className="field-error">
                        {shotProblem}
                      </p>
                    )}
                    <details className="feedback-tech">
                      <summary>Was zusätzlich mitgeht</summary>
                      <dl>
                        <dt>Version</dt>
                        <dd>{tech.version || "–"}</dd>
                        <dt>Seite</dt>
                        <dd className="mono">{page}</dd>
                        <dt>Fenster</dt>
                        <dd>{tech.window}</dd>
                        <dt>Browser</dt>
                        <dd>{browserLabel()}</dd>
                        <dt>Fehler im Browser</dt>
                        <dd>
                          {tech.browser_errors.length === 0
                            ? "keine"
                            : `${tech.browser_errors.length} Meldung${tech.browser_errors.length === 1 ? "" : "en"}`}
                        </dd>
                      </dl>
                    </details>
                  </div>
                )}
              </>
            )}
            {error && (
              <p role="alert" className="hint-box hint-bad">
                {error}
              </p>
            )}
            <div className="project-actions feedback-actions">
              <button type="button" className="button button-secondary" onClick={close}>
                Abbrechen
              </button>
              <button type="submit" className="button button-primary" disabled={busy}>
                Senden
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
