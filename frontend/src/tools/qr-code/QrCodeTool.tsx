import { useMemo, useState } from "react";
import { downloadBlob } from "../download";
import { clampInt, useToolParams } from "../params";
import { CopyButton, ErrorBox, Segmented, ToolSection } from "../ui";
import {
  contentTypeLabels,
  emailPayload,
  emptyVcard,
  phonePayload,
  smsPayload,
  urlPayload,
  vcardPayload,
  wifiPayload,
  type ContentType,
  type EmailData,
  type SmsData,
  type VcardData,
  type WifiData,
} from "./payloads";
import { eclInfo, encodeText, type Ecl } from "./qr";
import {
  CENTER_FONT,
  CENTER_MAX,
  CENTER_MIN,
  centerLayout,
  clearCenter,
  colorWarnings,
  encodeForCenter,
  pngBlob,
  pngScale,
  svgMarkup,
  svgPath,
  type Center,
} from "./render";

const TYPES = Object.keys(contentTypeLabels) as ContentType[];
const ECLS = Object.keys(eclInfo) as Ecl[];
const SIZES = ["256", "512", "1024", "2048"] as const;
const LOGO_MAX_BYTES = 1024 * 1024;
const MODE_LABELS = {
  numeric: "Ziffern",
  alphanumeric: "Alphanumerisch",
  byte: "Byte (UTF-8)",
} as const;

const DEFAULTS = {
  typ: "url",
  ecl: "M",
  rand: "4",
  vorne: "000000",
  hinten: "ffffff",
  px: "1024",
  mitte: "ohne",
  groesse: "22",
};

const hex = (value: string, fallback: string) =>
  /^[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;

/** Breite eines Textes bei Schriftgröße 1, damit das Kürzel die Mitte ausfüllt. */
function measureText(text: string): number | undefined {
  const context = document.createElement("canvas").getContext("2d");
  if (!context) {
    return undefined;
  }
  context.font = `700 100px ${CENTER_FONT}`;
  return context.measureText(text).width / 100;
}

export default function QrCodeTool() {
  // In der Adresszeile stehen nur Optionen, nie die Inhalte (z. B. WLAN-Kennwörter).
  const [params, setParams] = useToolParams(DEFAULTS);
  const type: ContentType = TYPES.includes(params.typ as ContentType)
    ? (params.typ as ContentType)
    : "url";
  const ecl: Ecl = ECLS.includes(params.ecl as Ecl) ? (params.ecl as Ecl) : "M";
  const margin = clampInt(params.rand, 0, 10, 4);
  const fg = `#${hex(params.vorne, "000000")}`;
  const bg = `#${hex(params.hinten, "ffffff")}`;
  const px = (SIZES as readonly string[]).includes(params.px) ? params.px : "1024";
  const centerMode = params.mitte === "kuerzel" || params.mitte === "logo" ? params.mitte : "ohne";
  const centerSize = clampInt(params.groesse, CENTER_MIN, CENTER_MAX, 22);

  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [wifi, setWifi] = useState<WifiData>({
    ssid: "",
    password: "",
    security: "WPA",
    hidden: false,
  });
  const [showPassword, setShowPassword] = useState(false);
  const [vcard, setVcard] = useState<VcardData>(emptyVcard);
  const [email, setEmail] = useState<EmailData>({ to: "", subject: "", body: "" });
  const [phone, setPhone] = useState("");
  const [sms, setSms] = useState<SmsData>({ phone: "", message: "" });
  const [labelText, setLabelText] = useState("");
  const [logo, setLogo] = useState<{
    href: string;
    width: number;
    height: number;
    name: string;
  } | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [pngError, setPngError] = useState<string | null>(null);

  const label = [...labelText.trim()].slice(0, 3).join("");
  const center: Center | null =
    centerMode === "kuerzel" && label
      ? { kind: "text", text: label }
      : centerMode === "logo" && logo
        ? { kind: "image", href: logo.href, width: logo.width, height: logo.height }
        : null;

  const loadLogo = (file: File | undefined) => {
    setLogoError(null);
    if (!file) {
      return;
    }
    if (!/^image\/(png|jpeg|webp|svg\+xml|gif)$/.test(file.type)) {
      setLogoError("Bitte wähle ein Bild (PNG, JPG, WebP, SVG oder GIF).");
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      setLogoError("Das Bild ist größer als 1 MB. Bitte nimm ein kleineres Logo.");
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setLogoError("Die Datei konnte nicht gelesen werden.");
    reader.onload = () => {
      const href = String(reader.result);
      const image = new Image();
      image.onerror = () => setLogoError("Das Bild konnte nicht geladen werden.");
      // SVG ohne feste Größe meldet 0, dann wird es quadratisch eingepasst.
      image.onload = () =>
        setLogo({
          href,
          width: image.naturalWidth || 1,
          height: image.naturalHeight || 1,
          name: file.name,
        });
      image.src = href;
    };
    reader.readAsDataURL(file);
  };

  const payload = useMemo(() => {
    switch (type) {
      case "text":
        return text;
      case "url":
        return urlPayload(url);
      case "wifi":
        return wifiPayload(wifi);
      case "vcard":
        return vcardPayload(vcard);
      case "email":
        return emailPayload(email);
      case "phone":
        return phonePayload(phone);
      case "sms":
        return smsPayload(sms);
    }
  }, [type, text, url, wifi, vcard, email, phone, sms]);

  const hasCenter = center !== null;
  const { qr, error, centerSafe, grown } = useMemo(() => {
    const none = { qr: null, error: null as string | null, centerSafe: true, grown: false };
    if (!payload) {
      return none;
    }
    try {
      if (!hasCenter) {
        return { ...none, qr: encodeText(payload, { ecl }) };
      }
      // Mit Mitte: Fehlerkorrektur und Größe so, dass die verdeckten Module ausgeglichen werden.
      const result = encodeForCenter(payload, ecl, centerSize);
      return {
        qr: result.qr,
        error: null,
        centerSafe: result.safe,
        grown: result.qr.version > encodeText(payload, { ecl: result.qr.ecl }).version,
      };
    } catch (caught) {
      return { ...none, error: (caught as Error).message };
    }
  }, [payload, ecl, centerSize, hasCenter]);

  const centerText = center?.kind === "text" ? center.text : "";
  const textWidth = centerText ? measureText(centerText) : undefined;
  const render = {
    margin,
    foreground: fg,
    background: bg,
    center,
    centerPercent: centerSize,
    textWidth,
  };
  const mid = qr ? centerLayout(qr, render) : null;
  const warnings = colorWarnings(fg, bg);
  if (center && qr && !centerSafe) {
    warnings.push(
      "Die Mitte verdeckt bei diesem Inhalt zu viel. Bitte stell sie kleiner, sonst ist der Code womöglich nicht lesbar.",
    );
  }
  if (margin < 4) {
    warnings.push(
      `Rand von ${margin} Modulen: Die Norm empfiehlt mindestens 4, sonst erkennen manche Scanner den Code schlechter.`,
    );
  }
  const png = qr ? pngScale(qr, margin, Number(px)) : null;
  const fileBase = `qr-${type}`;
  const dim = qr ? qr.size + margin * 2 : 0;

  const field = (
    labelTextValue: string,
    value: string,
    onChange: (value: string) => void,
    options: { type?: string; placeholder?: string; wide?: boolean } = {},
  ) => (
    <label className={options.wide ? "tool-wide" : undefined}>
      {labelTextValue}
      <input
        type={options.type ?? "text"}
        value={value}
        placeholder={options.placeholder}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
  const vcardField = (key: keyof VcardData, text: string, type = "text", wide = false) =>
    field(text, vcard[key], (value) => setVcard({ ...vcard, [key]: value }), { type, wide });

  return (
    <div className="tool-body settings-form">
      <Segmented
        label="Art des Inhalts"
        value={type}
        options={TYPES.map((key) => [key, contentTypeLabels[key]] as const)}
        onChange={(value) => setParams({ typ: value })}
      />

      <div className="tool-columns qr-layout">
        <div className="settings-form">
          <ToolSection title="Inhalt">
            {type === "text" && (
              <label>
                Text
                <textarea rows={5} value={text} onChange={(event) => setText(event.target.value)} />
              </label>
            )}
            {type === "url" &&
              field("Adresse (https:// wird ergänzt, falls es fehlt)", url, setUrl, {
                placeholder: "intranet.example.com/wiki",
              })}
            {type === "wifi" && (
              <div className="tool-columns">
                {field("Netzwerkname (SSID)", wifi.ssid, (ssid) => setWifi({ ...wifi, ssid }))}
                <label>
                  Verschlüsselung
                  <select
                    value={wifi.security}
                    onChange={(event) =>
                      setWifi({ ...wifi, security: event.target.value as WifiData["security"] })
                    }
                  >
                    <option value="WPA">WPA / WPA2 / WPA3</option>
                    <option value="WEP">WEP (veraltet)</option>
                    <option value="nopass">Offen (kein Kennwort)</option>
                  </select>
                </label>
                {wifi.security !== "nopass" && (
                  <div className="tool-row">
                    <label>
                      Kennwort
                      <input
                        type={showPassword ? "text" : "password"}
                        autoComplete="off"
                        value={wifi.password}
                        onChange={(event) => setWifi({ ...wifi, password: event.target.value })}
                      />
                    </label>
                    <button
                      type="button"
                      className="button button-secondary"
                      aria-pressed={showPassword}
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? "Verbergen" : "Anzeigen"}
                    </button>
                  </div>
                )}
                <label className="check-label">
                  <input
                    type="checkbox"
                    className="check"
                    checked={wifi.hidden}
                    onChange={(event) => setWifi({ ...wifi, hidden: event.target.checked })}
                  />
                  Verstecktes Netzwerk
                </label>
              </div>
            )}
            {type === "vcard" && (
              <div className="tool-columns">
                {vcardField("firstName", "Vorname")}
                {vcardField("lastName", "Nachname")}
                {vcardField("organization", "Firma oder Abteilung")}
                {vcardField("title", "Position")}
                {vcardField("phoneWork", "Telefon (geschäftlich)", "tel")}
                {vcardField("phoneMobile", "Mobil", "tel")}
                {vcardField("email", "E-Mail", "email")}
                {vcardField("website", "Webseite")}
                {vcardField("street", "Straße und Hausnummer", "text", true)}
                {vcardField("zip", "PLZ")}
                {vcardField("city", "Ort")}
                {vcardField("country", "Land")}
              </div>
            )}
            {type === "email" && (
              <>
                {field("Empfänger", email.to, (to) => setEmail({ ...email, to }), {
                  type: "email",
                  placeholder: "it-support@example.com",
                })}
                {field("Betreff (freiwillig)", email.subject, (subject) =>
                  setEmail({ ...email, subject }),
                )}
                <label>
                  Text (freiwillig)
                  <textarea
                    rows={4}
                    value={email.body}
                    onChange={(event) => setEmail({ ...email, body: event.target.value })}
                  />
                </label>
              </>
            )}
            {type === "phone" &&
              field("Telefonnummer (am besten mit Ländervorwahl, z. B. +49)", phone, setPhone, {
                type: "tel",
              })}
            {type === "sms" && (
              <>
                {field("Telefonnummer", sms.phone, (value) => setSms({ ...sms, phone: value }), {
                  type: "tel",
                })}
                <label>
                  Nachricht (freiwillig)
                  <textarea
                    rows={3}
                    value={sms.message}
                    onChange={(event) => setSms({ ...sms, message: event.target.value })}
                  />
                </label>
              </>
            )}
          </ToolSection>

          <ToolSection title="Darstellung">
            <div className="tool-columns">
              <label>
                Fehlerkorrektur
                <select value={ecl} onChange={(event) => setParams({ ecl: event.target.value })}>
                  {ECLS.map((key) => (
                    <option key={key} value={key}>
                      {eclInfo[key].label} ({eclInfo[key].recovery} wiederherstellbar)
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Rand: {margin} Module
                <input
                  type="range"
                  min={0}
                  max={10}
                  value={margin}
                  onChange={(event) => setParams({ rand: event.target.value })}
                />
              </label>
              <div className="tool-row">
                <label>
                  Code
                  <input
                    type="color"
                    value={fg}
                    onChange={(event) => setParams({ vorne: event.target.value.slice(1) })}
                  />
                </label>
                <label>
                  Hintergrund
                  <input
                    type="color"
                    value={bg}
                    onChange={(event) => setParams({ hinten: event.target.value.slice(1) })}
                  />
                </label>
                {(fg !== "#000000" || bg !== "#ffffff") && (
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => setParams({ vorne: "000000", hinten: "ffffff" })}
                  >
                    Schwarz auf Weiß
                  </button>
                )}
              </div>
              <label>
                PNG-Größe
                <select value={px} onChange={(event) => setParams({ px: event.target.value })}>
                  {SIZES.map((size) => (
                    <option key={size} value={size}>
                      ca. {size} × {size} px
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="small">
              Höhere Fehlerkorrektur macht den Code robuster (z. B. für Aufkleber oder Ausdrucke),
              aber auch größer und feiner.
            </p>
          </ToolSection>

          <ToolSection title="Mitte">
            <Segmented
              label="Inhalt der Mitte"
              value={centerMode}
              options={[
                ["ohne", "Ohne"],
                ["kuerzel", "Kürzel"],
                ["logo", "Logo"],
              ]}
              onChange={(value) => setParams({ mitte: value })}
            />
            {centerMode === "kuerzel" && (
              <label className="narrow">
                Kürzel (bis 3 Zeichen)
                <input
                  type="text"
                  value={labelText}
                  maxLength={3}
                  placeholder="IT"
                  autoComplete="off"
                  onChange={(event) => setLabelText(event.target.value)}
                />
              </label>
            )}
            {centerMode === "logo" && (
              <div className="tool-field">
                <label>
                  {logo ? "Anderes Logo wählen" : "Logo auswählen"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
                    onChange={(event) => {
                      loadLogo(event.target.files?.[0]);
                      event.target.value = "";
                    }}
                  />
                </label>
                {logo && (
                  <div className="tool-row">
                    <span className="small tool-break">{logo.name}</span>
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => setLogo(null)}
                    >
                      Logo entfernen
                    </button>
                  </div>
                )}
                {logoError && <ErrorBox>{logoError}</ErrorBox>}
                <p className="small">
                  Am besten ein quadratisches Logo mit deckendem Hintergrund. Die Datei bleibt im
                  Browser und wird nirgends gespeichert.
                </p>
              </div>
            )}
            {centerMode !== "ohne" && (
              <>
                <label>
                  Größe: {centerSize} % der Breite
                  <input
                    type="range"
                    min={CENTER_MIN}
                    max={CENTER_MAX}
                    value={centerSize}
                    onChange={(event) => setParams({ groesse: event.target.value })}
                  />
                </label>
                <p className="small">
                  Unter der Mitte fehlen Module, die Fehlerkorrektur gleicht das aus.
                  {qr && center && qr.ecl !== ecl
                    ? ` Dafür wird sie automatisch auf „${eclInfo[qr.ecl].label}“ angehoben.`
                    : ""}
                  {qr && center && grown
                    ? " Der Code ist außerdem eine Stufe größer als nötig, damit genug Reserve bleibt."
                    : ""}{" "}
                  Den fertigen Code vor dem Druck einmal mit dem Handy testen.
                </p>
              </>
            )}
          </ToolSection>
        </div>

        <div className="settings-form qr-preview-column">
          <div className="qr-preview">
            {qr ? (
              <svg
                viewBox={`0 0 ${dim} ${dim}`}
                role="img"
                aria-label={`QR-Code: ${contentTypeLabels[type]}${
                  mid?.text ? ` mit Kürzel ${mid.text.value}` : mid?.image ? " mit Logo" : ""
                }`}
              >
                <rect width={dim} height={dim} fill={bg} />
                <path
                  d={svgPath(mid ? clearCenter(qr.modules, mid.k) : qr.modules, margin)}
                  fill={fg}
                  shapeRendering="crispEdges"
                />
                {mid?.text && (
                  <text
                    x={mid.text.x}
                    y={mid.text.y}
                    fontFamily={CENTER_FONT}
                    fontWeight={700}
                    fontSize={mid.text.fontSize}
                    textAnchor="middle"
                    fill={fg}
                  >
                    {mid.text.value}
                  </text>
                )}
                {mid?.image && (
                  <image
                    href={mid.image.href}
                    x={mid.image.x}
                    y={mid.image.y}
                    width={mid.image.width}
                    height={mid.image.height}
                    preserveAspectRatio="xMidYMid meet"
                  />
                )}
              </svg>
            ) : (
              <p className="small">
                {error
                  ? "Kein Code, siehe Hinweis."
                  : "Inhalt eingeben, um den QR-Code zu erzeugen."}
              </p>
            )}
          </div>

          {error && <ErrorBox>{error}</ErrorBox>}

          {qr && (
            <>
              <p className="tool-row">
                <span className="pill pill-neutral">Version {qr.version}</span>
                <span className="pill pill-neutral">
                  {qr.size} × {qr.size} Module
                </span>
                <span className="pill pill-neutral">{MODE_LABELS[qr.mode]}</span>
                {mid && <span className="pill pill-neutral">Fehlerkorrektur {qr.ecl}</span>}
              </p>
              <div className="tool-row">
                <button
                  type="button"
                  className="button"
                  onClick={() =>
                    downloadBlob(
                      new Blob([svgMarkup(qr, render)], { type: "image/svg+xml" }),
                      `${fileBase}.svg`,
                    )
                  }
                >
                  SVG herunterladen
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => {
                    setPngError(null);
                    pngBlob(qr, render, Number(px)).then(
                      (blob) => downloadBlob(blob, `${fileBase}.png`),
                      (caught: unknown) => setPngError((caught as Error).message),
                    );
                  }}
                >
                  PNG ({png?.px} px)
                </button>
              </div>
              {pngError && <ErrorBox>{pngError}</ErrorBox>}
              <p className="small">
                SVG bleibt in jeder Größe scharf, ideal für Druck und Dokumente.
              </p>
            </>
          )}

          {warnings.map((warning) => (
            <p key={warning} className="hint-box hint-warn">
              {warning}
            </p>
          ))}

          {payload && (
            <details className="budget-more">
              <summary>Kodierten Inhalt anzeigen</summary>
              <div className="budget-more-body">
                <pre className="value-block" tabIndex={0} aria-label="Kodierter Inhalt">
                  {payload}
                </pre>
                <CopyButton value={payload} label="Kodierten Inhalt kopieren" />
              </div>
            </details>
          )}
        </div>
      </div>

      <p className="small">
        Alles wird im Browser erzeugt. Inhalte wie WLAN-Kennwörter werden weder gespeichert noch
        übertragen und stehen nicht in der Adresszeile.
      </p>
    </div>
  );
}
