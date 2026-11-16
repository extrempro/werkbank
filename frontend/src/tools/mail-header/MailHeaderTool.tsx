import { useMemo, useState, type DragEvent } from "react";
import { Link } from "../../components/Link";
import { TOOLS_PATH } from "../../navigation";
import { findTool } from "../index";
import { domainOfAddress, firstEmail, type Bounce, type BounceRecipient } from "../lib/mail/bounce";
import { explainSmtpCode, explainStatus, hintsFor } from "../lib/mail/smtp-codes";
import { CopyButton, ErrorBox, InfoTable, Segmented, ToolSection } from "../ui";
import { loadFile, loadText, type LoadedMail } from "./load";
import {
  analyzeHeaders,
  decodeEncodedWords,
  formatDuration,
  getFirst,
  parseHeaders,
  type AuthResult,
  type Finding,
} from "./mail-header";

type Tone = "ok" | "bad" | "todo" | "neutral";

const authTone = (result: AuthResult): Tone =>
  result === "pass" || result === "bestguesspass"
    ? "ok"
    : result === "fail" || result === "permerror"
      ? "bad"
      : result === "softfail" || result === "temperror"
        ? "todo"
        : "neutral";

const FINDING_TONE: Record<Finding["level"], Tone> = {
  error: "bad",
  warn: "todo",
  info: "neutral",
};
const FINDING_LABEL: Record<Finding["level"], string> = {
  error: "Fehler",
  warn: "Warnung",
  info: "Hinweis",
};

const TIME = new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "medium" });
const MAX_FILE = 25 * 1024 * 1024;

export default function MailHeaderTool() {
  // Bewusst nur im Browser und ohne Adresszeile: Header enthalten personenbezogene Daten.
  const [raw, setRaw] = useState("");
  const [file, setFile] = useState<{ name: string; loaded: LoadedMail } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const fromText = useMemo(() => {
    if (!raw.trim()) {
      return { loaded: null, error: null };
    }
    try {
      return { loaded: loadText(raw), error: null };
    } catch (caught) {
      return { loaded: null, error: (caught as Error).message };
    }
  }, [raw]);
  const loaded = file?.loaded ?? fromText.loaded;

  const openFile = async (picked: File | undefined) => {
    if (!picked) {
      return;
    }
    setFileError(null);
    if (picked.size > MAX_FILE) {
      setFileError("Die Datei ist größer als 25 MB.");
      return;
    }
    try {
      const result = loadFile(picked.name, new Uint8Array(await picked.arrayBuffer()));
      setFile({ name: picked.name, loaded: result });
      setRaw("");
    } catch (caught) {
      setFile(null);
      setFileError(`${picked.name}: ${(caught as Error).message}`);
    }
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    void openFile(event.dataTransfer.files[0]);
  };

  return (
    <div className="tool-body settings-form">
      <ToolSection title="Nachricht">
        {file ? (
          <div className="tool-row">
            <span>
              <strong>{file.name}</strong> ·{" "}
              {file.loaded.kind === "msg" ? "Outlook-Nachricht" : "E-Mail-Datei"}
            </span>
            <button type="button" className="button button-secondary" onClick={() => setFile(null)}>
              Andere Nachricht
            </button>
          </div>
        ) : (
          <>
            <label
              className={dragging ? "tool-drop tool-drop-active" : "tool-drop"}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              E-Mail-Header oder kompletter Quelltext
              <textarea
                className="mono"
                rows={10}
                spellCheck={false}
                value={raw}
                placeholder="Kopfzeilen oder die ganze Nachrichtenquelle einfügen, oder eine .eml- oder .msg-Datei hierher ziehen. Auch Rückläufer („Unzustellbar“) werden ausgewertet."
                onChange={(event) => setRaw(event.target.value)}
              />
            </label>
            <label>
              Oder eine Datei öffnen (.eml, .msg)
              <input
                type="file"
                accept=".eml,.msg,.txt,message/rfc822,application/vnd.ms-outlook"
                onChange={(event) => {
                  void openFile(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </label>
          </>
        )}
        <p className="small">
          Alles wird nur in deinem Browser ausgewertet und nirgends gespeichert.
        </p>
        <SourceHelp />
      </ToolSection>

      {(fileError ?? fromText.error) && <ErrorBox>{fileError ?? fromText.error}</ErrorBox>}
      {loaded && <Result loaded={loaded} />}
    </div>
  );
}

/** Anleitung: So kommt man an Kopfzeilen und Quelltext. */
function SourceHelp() {
  const rows: [string, string][] = [
    [
      "Neues Outlook und Outlook im Web",
      "Nachricht öffnen, „…“ (Weitere Aktionen), Anzeigen, „Nachrichtenquelle anzeigen“ (vollständig) oder „Nachrichtendetails anzeigen“ (nur Kopfzeilen).",
    ],
    [
      "Klassisches Outlook (Windows)",
      "Nachricht per Doppelklick öffnen, Datei, Eigenschaften, Feld „Internetkopfzeilen“. Vollständig: Nachricht aus Outlook auf den Desktop ziehen (wird zur .msg-Datei) und hier öffnen.",
    ],
    ["Outlook für Mac", "Rechtsklick auf die Nachricht, „Quelle anzeigen“."],
    ["Gmail", "Nachricht öffnen, ⋮, „Original anzeigen“ oder „Nachricht herunterladen“ als .eml."],
    ["Thunderbird", "Nachricht auswählen, Strg+U, oder Datei, Speichern unter, .eml."],
    ["Apple Mail", "Nachricht öffnen, Darstellung, Nachricht, Rohdaten."],
  ];
  return (
    <details className="budget-more">
      <summary>So kommst du an Kopfzeilen und Quelltext</summary>
      <div className="budget-more-body">
        <dl className="budget-facts budget-facts-stack">
          {rows.map(([app, how]) => (
            <div key={app}>
              <dt>{app}</dt>
              <dd>{how}</dd>
            </div>
          ))}
        </dl>
        <p className="small">
          Für Rückläufer immer den vollständigen Quelltext oder die Datei nehmen; nur so sind
          Fehlercode und Original-Nachricht enthalten.
        </p>
      </div>
    </details>
  );
}

function Result({ loaded }: { loaded: LoadedMail }) {
  const { bounce } = loaded;
  const views = [
    ...(bounce?.original ? ([["original", "Original-Nachricht"]] as const) : []),
    ...(loaded.headerText ? ([["self", bounce ? "Rückläufer selbst" : "Nachricht"]] as const) : []),
  ];
  const [view, setView] = useState<"original" | "self">(bounce?.original ? "original" : "self");
  const current =
    view === "original" && bounce?.original ? bounce.original.headers : loaded.headerText;
  return (
    <>
      {loaded.notes.map((note) => (
        <p key={note} className="hint-box hint-warn">
          {note}
        </p>
      ))}
      {bounce && <BounceView bounce={bounce} selfHeaders={loaded.headerText} />}
      {current && (
        <>
          {bounce && views.length > 1 && (
            <Segmented
              label="Welche Header auswerten"
              value={view}
              options={views}
              onChange={(value) => setView(value)}
            />
          )}
          {bounce && view === "original" && !bounce.original?.complete && (
            <p className="small">Vom Original liegen nur Teile der Kopfzeilen vor.</p>
          )}
          <HeaderAnalysis key={view} raw={current} />
        </>
      )}
    </>
  );
}

function statusOf(recipient: BounceRecipient) {
  return (
    explainStatus(recipient.status, recipient.diagnostic) ?? explainSmtpCode(recipient.smtpCode)
  );
}

function BounceView({ bounce, selfHeaders }: { bounce: Bounce; selfHeaders?: string }) {
  const original = bounce.original ? parseHeaders(bounce.original.headers) : [];
  const originalFrom = getFirst(original, "From");
  const selfTo = selfHeaders ? getFirst(parseHeaders(selfHeaders), "To") : undefined;
  const senderDomain = domainOfAddress(firstEmail(originalFrom) ?? firstEmail(selfTo));
  const shown = bounce.recipients.filter(
    (recipient) =>
      recipient.address || recipient.status || recipient.diagnostic || recipient.smtpCode,
  );
  const delayed =
    shown.length > 0 &&
    shown.every(
      (recipient) => recipient.action === "delayed" || statusOf(recipient)?.permanent === false,
    );
  const originalSender = firstEmail(originalFrom);
  const bounceTo = firstEmail(selfTo);
  const facts = (
    [
      ["Von", originalFrom],
      ["An", getFirst(original, "To")],
      ["Betreff", getFirst(original, "Subject")],
      ["Gesendet", getFirst(original, "Date")],
      ["Message-ID", getFirst(original, "Message-ID")],
    ] as [string, string | undefined][]
  )
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([label, value]) => ({ label, value: decodeEncodedWords(value) }));

  return (
    <ToolSection title={delayed ? "Zustellung verzögert" : "Unzustellbar"}>
      <p>
        {delayed
          ? "Der Server konnte die Nachricht bisher nicht zustellen und versucht es weiter; noch ist nichts verloren."
          : "Die Nachricht wurde nicht zugestellt. Hier steht, an wen, warum und was zu tun ist."}
        {bounce.reportingMta && ` Gemeldet von ${bounce.reportingMta}.`}
      </p>
      {shown.length === 0 && (
        <p className="small">
          Empfänger und Fehlercode ließen sich aus dieser Meldung nicht auslesen; siehe Text unten.
        </p>
      )}
      {shown.map((recipient, index) => (
        <RecipientCard
          key={`${recipient.address}-${index}`}
          recipient={recipient}
          senderDomain={senderDomain}
        />
      ))}
      {bounce.original && (
        <>
          <h3>Betroffene Nachricht</h3>
          <InfoTable caption="Betroffene Nachricht" rows={facts} />
          {originalSender &&
            bounceTo &&
            domainOfAddress(originalSender) !== domainOfAddress(bounceTo) && (
              <p className="hint-box hint-warn">
                Der Rückläufer ging an {bounceTo}, die Original-Nachricht war aber von{" "}
                {originalSender}. Habt ihr sie nicht verschickt, hat jemand eure Adresse als
                Absender gefälscht (Backscatter); dann hilft eine DMARC-Richtlinie mit p=reject.
              </p>
            )}
        </>
      )}
      {!bounce.original && !delayed && (
        <p className="small">
          Die Original-Nachricht ist nicht enthalten. Kommt euch der Rückläufer unbekannt vor, kann
          es Rückstreu-Spam (Backscatter) sein: Jemand hat eure Adresse als Absender gefälscht.
        </p>
      )}
      {bounce.humanText && (
        <details className="budget-more">
          <summary>Meldung des Mailservers im Wortlaut</summary>
          <div className="budget-more-body">
            <pre className="value-block" tabIndex={0} aria-label="Meldung des Mailservers">
              {bounce.humanText}
            </pre>
          </div>
        </details>
      )}
    </ToolSection>
  );
}

function RecipientCard({
  recipient,
  senderDomain,
}: {
  recipient: BounceRecipient;
  senderDomain?: string;
}) {
  const info = statusOf(recipient);
  const hints = hintsFor(recipient.status, `${recipient.diagnostic ?? ""} ${info?.text ?? ""}`, {
    senderDomain,
    recipientDomain: domainOfAddress(recipient.address),
  });
  const permanent = info?.permanent ?? recipient.action !== "delayed";
  return (
    <div className="panel tool-card">
      <div className="tool-row">
        {recipient.address ? (
          <>
            <span className="mono tool-break">{recipient.address}</span>
            <CopyButton value={recipient.address} label="Adresse kopieren" />
          </>
        ) : (
          <span className="small">Empfänger nicht angegeben</span>
        )}
        <span className={permanent ? "pill pill-bad" : "pill pill-todo"}>
          {permanent ? "dauerhaft fehlgeschlagen" : "vorübergehend"}
        </span>
      </div>
      {recipient.originalRecipient &&
        recipient.originalRecipient.toLowerCase() !== recipient.address.toLowerCase() && (
          <p className="small">
            Ursprünglich adressiert an {recipient.originalRecipient} (weitergeleitet)
          </p>
        )}
      {info && (
        <p>
          <span className="pill pill-neutral mono">{info.code}</span> <strong>{info.text}</strong>
          {info.microsoft && <span className="small"> (Microsoft 365)</span>}
        </p>
      )}
      {recipient.diagnostic && (
        <>
          <p className="small">
            Antwort des Servers{recipient.remoteMta ? ` ${recipient.remoteMta}` : ""}
          </p>
          <pre className="value-block" tabIndex={0} aria-label="Antwort des Servers">
            {recipient.diagnostic}
          </pre>
        </>
      )}
      {!recipient.diagnostic && recipient.remoteMta && (
        <p className="small">Abgelehnt von {recipient.remoteMta}</p>
      )}
      {recipient.retryUntil && <p className="small">Weitere Versuche bis {recipient.retryUntil}</p>}
      {hints.length > 0 && (
        <ul className="tool-list" aria-label="Was zu tun ist">
          {hints.map((hint) => (
            <li key={hint.id}>
              <strong>{hint.title}</strong>
              <br />
              {hint.text}
              {hint.action && findTool(hint.action.tool) && (
                <>
                  <br />
                  <Link
                    to={`${TOOLS_PATH}/${hint.action.tool}?${new URLSearchParams(hint.action.search).toString()}`}
                  >
                    {hint.action.label}
                  </Link>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function HeaderAnalysis({ raw }: { raw: string }) {
  const { analysis, error } = useMemo(() => {
    try {
      return { analysis: analyzeHeaders(raw), error: null };
    } catch (caught) {
      return { analysis: null, error: (caught as Error).message };
    }
  }, [raw]);
  if (error) {
    return <ErrorBox>{error}</ErrorBox>;
  }
  if (!analysis) {
    return null;
  }
  return (
    <>
      {analysis.findings.length > 0 && (
        <ToolSection title="Befunde">
          <ul className="tool-list">
            {analysis.findings.map((finding, index) => (
              <li key={index}>
                <span className={`pill pill-${FINDING_TONE[finding.level]}`}>
                  {FINDING_LABEL[finding.level]}
                </span>{" "}
                {finding.message}
              </li>
            ))}
          </ul>
        </ToolSection>
      )}

      {analysis.auth.length > 0 && (
        <ToolSection title="Authentifizierung">
          <dl className="kpis">
            {analysis.auth.map((entry) => (
              <div key={entry.method} className="kpi">
                <dt>
                  {entry.method.toUpperCase()}{" "}
                  <span className={`pill pill-${authTone(entry.result)}`}>{entry.result}</span>
                </dt>
                <dd className="small">
                  {Object.entries(entry.details).map(([key, value]) => (
                    <span key={key} className="budget-line">
                      {key}: <span className="mono">{value}</span>
                    </span>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </ToolSection>
      )}

      <ToolSection title="Übersicht">
        <InfoTable
          caption="Übersicht der Nachricht"
          rows={analysis.summary.map((entry) => ({
            label: entry.label,
            value: entry.value,
            copy: entry.value,
          }))}
        />
      </ToolSection>

      {analysis.hops.length > 0 && (
        <ToolSection
          title={`Zustellweg (${analysis.hops.length} Stationen${
            analysis.totalSeconds !== null
              ? `, gesamt ${formatDuration(analysis.totalSeconds)}`
              : ""
          })`}
        >
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Zustellweg">
            <table>
              <caption className="visually-hidden">Stationen der Zustellung</caption>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Zeit</th>
                  <th scope="col">Verzögerung</th>
                  <th scope="col">Von</th>
                  <th scope="col">An (by)</th>
                  <th scope="col">Protokoll</th>
                </tr>
              </thead>
              <tbody>
                {analysis.hops.map((hop) => (
                  <tr key={hop.index}>
                    <th scope="row">{hop.index}</th>
                    <td>{hop.date ? TIME.format(hop.date) : "–"}</td>
                    <td>
                      {hop.delaySeconds === null ? (
                        "–"
                      ) : (
                        <span
                          className={
                            hop.delaySeconds > 300 ? "pill pill-todo" : "pill pill-neutral"
                          }
                        >
                          {formatDuration(hop.delaySeconds)}
                        </span>
                      )}
                    </td>
                    <td className="mono tool-break">
                      {hop.from ?? "–"}
                      {hop.fromIp && <span className="small budget-line">{hop.fromIp}</span>}
                    </td>
                    <td className="mono tool-break">{hop.by ?? "–"}</td>
                    <td>{hop.with ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ToolSection>
      )}

      {analysis.spamInfo.length > 0 && (
        <ToolSection title="Spamfilter">
          <InfoTable
            caption="Angaben des Spamfilters"
            rows={analysis.spamInfo.map((entry) => ({ label: entry.label, value: entry.value }))}
          />
        </ToolSection>
      )}

      <details className="budget-more">
        <summary>Alle {analysis.headers.length} Header anzeigen</summary>
        <div className="budget-more-body">
          <InfoTable
            caption="Alle Header"
            rows={analysis.headers.map((header) => ({ label: header.name, value: header.value }))}
          />
        </div>
      </details>
    </>
  );
}
