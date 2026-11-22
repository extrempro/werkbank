import { useId, useState, type ChangeEvent, type FormEvent } from "react";
import {
  errorText,
  removeBrandingImage,
  saveBranding,
  uploadBrandingImage,
  type BrandingImageKind,
} from "../api";
import { ConfirmButton } from "../components/ConfirmDialog";
import { setBranding, useBranding, type Branding } from "../branding";
import {
  ImageProblem,
  INPUT_TYPES,
  prepareImage,
  type Prepared,
  type ResizeMode,
  type Size,
} from "../imageResize";

type Message = { kind: "status" | "alert"; text: string };

const DEFAULT_ACCENT = "#1f57c3";

interface ImageSlot {
  kind: BrandingImageKind;
  title: string;
  hint: string;
  preview: "hell" | "dunkel";
  url: (branding: Branding) => string | null;
}

const SLOTS: ImageSlot[] = [
  {
    kind: "logo-hell",
    title: "Logo für hellen Hintergrund",
    hint: "Erscheint auf der Anmeldeseite in der hellen Darstellung.",
    preview: "hell",
    url: (branding) => branding.logo_light_url,
  },
  {
    kind: "logo-dunkel",
    title: "Logo für dunklen Hintergrund",
    hint: "Erscheint oben links in der Kopfzeile und auf der Anmeldeseite in der dunklen Darstellung. Auf dem Handy ist dort wenig Platz; ein eher quadratisches Logo bleibt gut erkennbar.",
    preview: "dunkel",
    url: (branding) => branding.logo_dark_url,
  },
  {
    kind: "favicon",
    title: "Favicon",
    hint: "Das kleine Bild im Browser-Tab. Ein nicht quadratisches Bild setzt die Werkbank mittig in ein Quadrat.",
    preview: "hell",
    url: (branding) => branding.favicon_url,
  },
];

const ACCEPT = INPUT_TYPES.join(",");

function sizeText(size: Size): string {
  return `${size.width} × ${size.height} Pixel`;
}

/** Sagt, was mit dem Bild geschehen ist, damit niemand über ein verändertes Bild stolpert. */
function savedText(title: string, prepared: Prepared): string {
  if (!prepared.changed || !prepared.before || !prepared.after) {
    return `${title}: gespeichert.`;
  }
  const same =
    prepared.before.width === prepared.after.width &&
    prepared.before.height === prepared.after.height;
  return same
    ? `${title}: gespeichert (in PNG umgewandelt).`
    : `${title}: gespeichert. Das Bild wurde von ${sizeText(prepared.before)} auf ${sizeText(prepared.after)} angepasst.`;
}

/** Verwaltung › Allgemein: Name, Akzentfarbe, Logos und Favicon. */
export function BrandingSettings() {
  const branding = useBranding();
  const [name, setName] = useState(branding.app_name);
  const [showName, setShowName] = useState(branding.show_name);
  const [ownAccent, setOwnAccent] = useState(branding.accent !== null);
  const [accent, setAccent] = useState(branding.accent ?? DEFAULT_ACCENT);
  const [message, setMessage] = useState<Message | null>(null);
  const [imageMessage, setImageMessage] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<ResizeMode>("auto");
  const modeHint = useId();
  const accentHint = useId();
  const nameHint = useId();
  const maxKb = Math.floor(branding.max_image_bytes / 1024);

  const onSave = (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    saveBranding({ app_name: name.trim(), accent: ownAccent ? accent : null, show_name: showName })
      .then((result) => {
        setBranding(result);
        setName(result.app_name);
        setMessage({ kind: "status", text: "Name und Farbe sind gespeichert." });
      })
      .catch((error: unknown) => {
        setMessage({
          kind: "alert",
          text: errorText(error, "Die Angaben konnten nicht gespeichert werden. Bitte prüfen."),
        });
      })
      .finally(() => setBusy(false));
  };

  const onFile = (slot: ImageSlot, event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    input.value = "";
    if (!INPUT_TYPES.includes(file.type)) {
      setImageMessage({ kind: "alert", text: "Erlaubt sind PNG-, WebP- und JPEG-Dateien." });
      return;
    }
    setBusy(true);
    setImageMessage(null);
    const kind = slot.kind === "favicon" ? "favicon" : "logo";
    prepareImage(file, kind, mode, branding.max_image_bytes)
      .then((prepared) => {
        if (prepared.bytes > branding.max_image_bytes) {
          throw new ImageProblem(`Die Datei ist zu groß (höchstens ${maxKb} KB).`);
        }
        return uploadBrandingImage(slot.kind, prepared.base64).then((result) => {
          setBranding(result);
          setImageMessage({ kind: "status", text: savedText(slot.title, prepared) });
        });
      })
      .catch((error: unknown) => {
        setImageMessage({
          kind: "alert",
          text:
            error instanceof ImageProblem
              ? error.message
              : errorText(error, "Das Bild konnte nicht gespeichert werden."),
        });
      })
      .finally(() => setBusy(false));
  };

  const onRemove = (slot: ImageSlot) => {
    setBusy(true);
    setImageMessage(null);
    return removeBrandingImage(slot.kind)
      .then((result) => {
        setBranding(result);
        setImageMessage({ kind: "status", text: `${slot.title}: entfernt.` });
      })
      .catch((error: unknown) => {
        setImageMessage({
          kind: "alert",
          text: errorText(error, "Das Bild konnte nicht entfernt werden."),
        });
      })
      .finally(() => setBusy(false));
  };

  return (
    <section className="panel" aria-labelledby="branding-titel">
      <div className="panel-head">
        <h3 id="branding-titel">Branding</h3>
        <span className="small">Name, Farbe, Logo</span>
      </div>
      <form className="detail-body settings-form" onSubmit={onSave}>
        <p className="small">
          Name und Bilder erscheinen auch auf der Anmeldeseite und sind damit ohne Anmeldung
          sichtbar.
        </p>
        <div className="form-grid">
          <label>
            Name der Anwendung
            <input
              type="text"
              value={name}
              maxLength={40}
              autoComplete="off"
              aria-describedby={nameHint}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        </div>
        <p className="small" id={nameHint}>
          Steht in der Kopfzeile, im Browser-Tab und auf der Anmeldeseite. Leer lassen für
          „Werkbank“.
        </p>
        <label className="check-label">
          <input
            type="checkbox"
            className="check"
            checked={showName}
            onChange={(event) => setShowName(event.target.checked)}
          />
          Name neben dem Logo anzeigen
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            className="check"
            checked={ownAccent}
            onChange={(event) => setOwnAccent(event.target.checked)}
          />
          Eigene Akzentfarbe verwenden
        </label>
        {ownAccent && (
          <div className="color-row">
            <label>
              Akzentfarbe
              <input
                type="color"
                value={accent}
                aria-describedby={accentHint}
                onChange={(event) => setAccent(event.target.value.toLowerCase())}
              />
            </label>
            <span className="mono small">{accent}</span>
          </div>
        )}
        <p className="small" id={accentHint}>
          Die Farbe gilt für Knöpfe, Links und Hervorhebungen. Damit alles lesbar bleibt, dunkelt
          die Werkbank sie bei Bedarf ab oder hellt sie auf, getrennt für hell und dunkel.
        </p>
        <div className="actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            Name und Farbe speichern
          </button>
        </div>
        {message && (
          <p
            role={message.kind}
            className={message.kind === "alert" ? "hint-box hint-bad" : "hint-box"}
          >
            {message.text}
          </p>
        )}
      </form>

      <div className="detail-body settings-form">
        <label className="narrow-auto">
          Größe beim Hochladen
          <select
            value={mode}
            aria-describedby={modeHint}
            onChange={(event) => setMode(event.target.value === "original" ? "original" : "auto")}
          >
            <option value="auto">Automatisch anpassen (empfohlen)</option>
            <option value="original">Original behalten</option>
          </select>
        </label>
        <p className="small" id={modeHint}>
          Automatisch: Zu große Bilder verkleinert die Werkbank vor dem Hochladen (Logos auf
          höchstens 800 Pixel, Favicons auf 256 Pixel im Quadrat). Vergrößert wird nie. Original:
          Das Bild bleibt, wie es ist, und muss selbst passen.
        </p>
        <div className="branding-images">
          {SLOTS.map((slot) => {
            const url = slot.url(branding);
            return (
              <fieldset className="branding-image" key={slot.kind}>
                <legend>{slot.title}</legend>
                <div className={`branding-preview branding-preview-${slot.preview}`}>
                  {url ? <img src={url} alt="" /> : <span>Kein eigenes Bild</span>}
                </div>
                <p className="small">{slot.hint}</p>
                <label>
                  {url ? "Bild ersetzen" : "Bild hochladen"}{" "}
                  <span className="visually-hidden">– {slot.title}</span>
                  <input
                    type="file"
                    accept={ACCEPT}
                    disabled={busy}
                    onChange={(event) => onFile(slot, event)}
                  />
                </label>
                {url && (
                  <div className="actions">
                    <ConfirmButton
                      className="button button-secondary"
                      disabled={busy}
                      confirm={{
                        title: `${slot.title} entfernen?`,
                        text: "Das Bild wird gelöscht. Du kannst jederzeit ein neues hochladen.",
                        action: "Entfernen",
                      }}
                      onConfirm={() => onRemove(slot)}
                    >
                      Entfernen <span className="visually-hidden">– {slot.title}</span>
                    </ConfirmButton>
                  </div>
                )}
              </fieldset>
            );
          })}
        </div>
        <p className="small">
          PNG, WebP oder JPEG (JPEG wird in PNG umgewandelt). Gespeichert werden höchstens {maxKb}{" "}
          KB je Bild. Ohne eigenes Bild erscheint das Zeichen der Werkbank.
        </p>
        {imageMessage && (
          <p
            role={imageMessage.kind}
            className={imageMessage.kind === "alert" ? "hint-box hint-bad" : "hint-box"}
          >
            {imageMessage.text}
          </p>
        )}
      </div>
    </section>
  );
}
