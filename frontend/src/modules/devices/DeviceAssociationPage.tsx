import { ConfirmButton, useConfirm } from "../../components/ConfirmDialog";
import { InfoTip } from "../../components/InfoTip";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { FilterBar } from "../../components/FilterBar";
import { errorText } from "../../api";
import { Icon } from "../../components/Icon";
import { useModal } from "../../components/nav/useModal";
import {
  ADMIN_LOGIN_URL,
  STATUS,
  VIEWS,
  approve,
  countFor,
  disconnectAdmin,
  discard,
  fetchAdmin,
  fetchDevice,
  fetchDevices,
  fetchPolicies,
  importNow,
  intuneUrl,
  refreshAll,
  refreshOne,
  scanCode,
  sendForApproval,
  type Admin,
  type Device,
  type DeviceList,
  type DeviceView,
  type Duplicate,
  type Policy,
  type Problem,
  type ScanResult,
} from "./api";
import { Scanner } from "./Scanner";
import { Feedback } from "../../components/Feedback";

const PAGE = "/m365/geraete/zuordnung";
const shortDateTime = new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short" });
const timeOnly = new Intl.DateTimeFormat("de-DE", { timeStyle: "short" });

function when(iso: string | null): string {
  return iso ? shortDateTime.format(new Date(iso)) : "–";
}

const ADMIN_MESSAGES: Record<string, { text: string; bad: boolean }> = {
  verbunden: { text: "Admin-Konto verbunden.", bad: false },
  fehler: {
    text: "Die Anmeldung mit dem Admin-Konto hat nicht geklappt. Bitte versuch es noch einmal, mit einem Konto aus diesem Tenant.",
    bad: true,
  },
  schluessel: {
    text: "Die Anmeldung ging, aber die Werkbank kann das Admin-Konto gerade nicht sicher ablegen. Bitte gib der Verwaltung Bescheid.",
    bad: true,
  },
};

function readView(): DeviceView {
  const value = new URLSearchParams(window.location.search).get("ansicht");
  return VIEWS.some((view) => view.id === value) ? (value as DeviceView) : "alle";
}

function readAdminResult(): { text: string; bad: boolean } | null {
  const result = new URLSearchParams(window.location.search).get("admin");
  return (result && ADMIN_MESSAGES[result]) || null;
}

/** Schritte im Verlauf eines Geräts (Entwurf: 4 Stufen). */
function timeline(device: Device) {
  const level = STATUS[device.status].level;
  const stale = device.status === "nicht_abgeschlossen";
  const approvedBy = device.approved_by
    ? `von ${device.approved_by}${device.approved_admin ? ` mit ${device.approved_admin}` : ""}`
    : "";
  return [
    {
      title: "Gescannt",
      text: `${when(device.scanned_at)}${device.scanned_by ? ` · von ${device.scanned_by}` : ""}`,
      state: "ok",
    },
    {
      title: "Freigegeben, vorab zugeordnet",
      text:
        level >= 1
          ? `${when(device.approved_at)} · ${approvedBy}`
          : "Wartet auf Freigabe mit einem Admin-Konto",
      state: level >= 1 ? "ok" : "wait",
    },
    {
      title: "Zugeordnet",
      text:
        level >= 2
          ? `${when(device.associated_at)} · am Gerät wurde „Weiter“ geklickt`
          : stale
            ? "Keine Rückmeldung vom Gerät"
            : "Wartet darauf, dass am Gerät „Weiter“ geklickt wird",
      state: level >= 2 ? "ok" : level === 1 && !stale ? "wait" : "open",
    },
    {
      title: "In Intune registriert",
      text:
        level >= 3
          ? `${when(device.enrolled_at)}${device.device_name ? ` · ${device.device_name}` : ""}`
          : "Noch nicht registriert",
      state: level >= 3 ? "ok" : level === 2 ? "wait" : "open",
    },
  ];
}

function Steps({ device }: { device: Device }) {
  const level = device.status === "nicht_abgeschlossen" ? 1 : STATUS[device.status].level;
  return (
    <span className="dev-steps" aria-hidden="true">
      {[0, 1, 2, 3].map((step) => (
        <span key={step} className={step <= level ? "dev-step-dot is-done" : "dev-step-dot"} />
      ))}
    </span>
  );
}

function StatusPill({ device }: { device: Device }) {
  const info = STATUS[device.status];
  return <span className={`pill ${info.pill}`}>{info.label}</span>;
}

function CopyId({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="dev-copy">
      <span className="mono">{value}</span>
      <button
        type="button"
        className="button button-secondary dev-copy-button"
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => setCopied(true));
        }}
      >
        <Icon name="kopieren" /> {copied ? "Kopiert" : "Kopieren"}
      </button>
    </span>
  );
}

/** Fehler von Microsoft: Titel, Erklärung, bei 5xx die Voraussetzungen, immer die Request-ID. */
function ProblemBox({ problem }: { problem: Problem }) {
  return (
    <div role="alert" className="hint-box hint-bad dev-problem">
      <p className="hint-title">{problem.title}</p>
      <p>{problem.detail}</p>
      {problem.requirements && problem.requirements.length > 0 && (
        <>
          <p>Bitte am Gerät prüfen:</p>
          <ul>
            {problem.requirements.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </>
      )}
      {problem.request_id && (
        <p>
          Request-ID für den Microsoft-Support: <CopyId value={problem.request_id} />
        </p>
      )}
    </div>
  );
}

function PolicySelect({
  policies,
  value,
  onChange,
}: {
  policies: Policy[];
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="dev-field">
      <label htmlFor={id}>Device-Preparation-Richtlinie</label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Ohne Richtlinie (nur zuordnen)</option>
        {policies.map((policy) => (
          <option key={policy.id} value={policy.id}>
            {policy.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function AdminCard({ admin, onDisconnect }: { admin: Admin; onDisconnect: () => unknown }) {
  if (!admin.connected) {
    return (
      <section className="panel dev-admin" aria-labelledby="dev-admin-title">
        <Icon name="schluessel" />
        <div className="dev-admin-text">
          <h2 id="dev-admin-title">Zum Zuordnen brauchst du dein Admin-Konto</h2>
          <p className="small">
            Angemeldet bist du mit deinem Office-Konto. Die Zuordnung bei Microsoft läuft mit den
            Intune-Rechten deines Admin-Kontos.
          </p>
        </div>
        <a className="button" href={ADMIN_LOGIN_URL}>
          Mit Admin-Konto anmelden
        </a>
      </section>
    );
  }
  return (
    <section className="panel dev-admin dev-admin-on" aria-labelledby="dev-admin-title">
      <Icon name="haken" />
      <div className="dev-admin-text">
        <h2 id="dev-admin-title">
          Admin-Konto verbunden: <span className="mono">{admin.upn}</span>
        </h2>
        <p className="small">
          Nur für die Gerätezuordnung
          {admin.expires_at ? `, gilt bis ${timeOnly.format(new Date(admin.expires_at))} Uhr` : ""}.
          Endet beim Abmelden.
        </p>
      </div>
      <ConfirmButton
        className="button button-secondary"
        confirm={{
          title: "Admin-Konto trennen?",
          text: `Die Verbindung mit ${admin.upn} endet. Zum Freigeben meldest du dich danach neu mit dem Admin-Konto an.`,
          action: "Trennen",
        }}
        onConfirm={onDisconnect}
      >
        Trennen
      </ConfirmButton>
    </section>
  );
}

interface DrawerProps {
  device: Device;
  admin: Admin;
  onClose: () => void;
  onChanged: (device: Device | null, message: string) => void;
}

/** Seitenleiste zu einem Gerät: Verlauf, Daten, Aktionen. */
function DeviceDrawer({ device, admin, onClose, onChanged }: DrawerProps) {
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModal(dialog, true, onClose);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [problem, setProblem] = useState<Problem | null>(null);
  const [policies, setPolicies] = useState<Policy[] | null>(null);
  const [policy, setPolicy] = useState("");
  const pending = device.status === "freigabe";
  const link = intuneUrl(device);

  useEffect(() => {
    if (!pending || !admin.connected) {
      return;
    }
    let active = true;
    fetchPolicies()
      .then((result) => {
        if (active) {
          setPolicies(result.policies);
          setProblem(result.problem);
        }
      })
      .catch(() => active && setPolicies([]));
    return () => {
      active = false;
    };
  }, [pending, admin.connected]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setProblem(null);
    try {
      await action();
    } catch (failure) {
      setError(errorText(failure, "Das hat nicht geklappt."));
    } finally {
      setBusy(false);
    }
  };

  const onApprove = () =>
    run(async () => {
      const result = await approve(device.id, policy || null);
      if (result.ok && result.entry) {
        onChanged(result.entry, "Vorab zugeordnet. Jetzt am Gerät auf „Weiter“ klicken.");
      } else if (result.duplicate) {
        setError(
          "Für diese Seriennummer gibt es schon eine Zuordnung. Ein zweiter Import ist gesperrt.",
        );
      } else if (result.error) {
        setProblem(result.error);
      }
    });

  const onDiscard = () =>
    run(async () => {
      await discard(device.id);
      onChanged(null, "Eintrag verworfen, Gerätedaten gelöscht.");
    });

  const onRefresh = () =>
    run(async () => {
      const updated = await refreshOne(device.id);
      onChanged(updated, "Status aktualisiert.");
    });

  return (
    <div
      className="dev-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        ref={dialog}
        className="dev-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="dev-drawer-head">
          <div>
            <p className="small">{device.manufacturer}</p>
            <h2 id={titleId}>{device.model}</h2>
            <StatusPill device={device} />
          </div>
          <button type="button" className="button button-secondary dev-close" onClick={onClose}>
            <Icon name="schliessen" />
            <span className="visually-hidden">Schließen</span>
          </button>
        </div>
        <div className="dev-drawer-body" tabIndex={0} role="region" aria-label="Details zum Gerät">
          <section aria-labelledby={`${titleId}-verlauf`}>
            <h3 id={`${titleId}-verlauf`}>Verlauf</h3>
            <ol className="dev-timeline">
              {timeline(device).map((step) => (
                <li key={step.title} className={`dev-tl-${step.state}`}>
                  <span className="dev-tl-dot" aria-hidden="true">
                    {step.state === "ok" && <Icon name="haken" />}
                  </span>
                  <span>
                    <span className="dev-tl-title">
                      {step.title}
                      <span className="visually-hidden">
                        {step.state === "ok"
                          ? " (erledigt)"
                          : step.state === "wait"
                            ? " (wartet)"
                            : " (offen)"}
                      </span>
                    </span>
                    <span className="small dev-tl-text">{step.text}</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>

          {device.status === "nicht_abgeschlossen" && (
            <p className="hint-box hint-warn">
              Das Gerät hat sich 7 Tage lang nicht gemeldet. Die Werkbank prüft nicht mehr
              automatisch. Wenn das Gerät noch eingerichtet werden soll: am Gerät in der Einrichtung
              auf „Weiter“ klicken und hier „Status aktualisieren“ wählen.
            </p>
          )}
          {pending && (
            <p className="hint-box">
              Gescannt, aber noch nicht an Microsoft übertragen. Die Gerätedaten liegen
              verschlüsselt in der Werkbank und werden nach der Freigabe gelöscht, spätestens{" "}
              {when(device.link_expires_at)}. Das Gerät wartet so lange in der Einrichtung.
            </p>
          )}

          <section aria-labelledby={`${titleId}-geraet`}>
            <h3 id={`${titleId}-geraet`}>Gerät</h3>
            <dl className="dev-facts">
              <dt>Seriennummer</dt>
              <dd className="mono">{device.serial_number}</dd>
              <dt>Richtlinie</dt>
              <dd>{device.policy_name ?? "–"}</dd>
              <dt>Gescannt von</dt>
              <dd>{device.scanned_by ?? "–"}</dd>
              <dt>Freigegeben von</dt>
              <dd>
                {device.approved_by
                  ? `${device.approved_by}${device.approved_admin ? ` (${device.approved_admin})` : ""}`
                  : "–"}
              </dd>
              <dt>Letzte Prüfung</dt>
              <dd>{when(device.last_checked_at)}</dd>
              {device.request_id && (
                <>
                  <dt>Request-ID</dt>
                  <dd>
                    <CopyId value={device.request_id} />
                  </dd>
                </>
              )}
              {device.last_error && (
                <>
                  <dt>Letzter Fehler</dt>
                  <dd>{device.last_error}</dd>
                </>
              )}
            </dl>
          </section>

          {device.status === "registriert" && (
            <section aria-labelledby={`${titleId}-intune`}>
              <h3 id={`${titleId}-intune`}>In Intune</h3>
              <dl className="dev-facts">
                <dt>Gerätename</dt>
                <dd>{device.device_name ?? "–"}</dd>
                <dt>Registriert am</dt>
                <dd>{when(device.enrolled_at)}</dd>
                <dt>Benutzer</dt>
                <dd>{device.user_principal_name ?? "–"}</dd>
                <dt>
                  Konformität <InfoTip term="geraete.konformitaet" />
                </dt>
                <dd>{device.compliance ?? "–"}</dd>
              </dl>
            </section>
          )}

          {error && (
            <p role="alert" className="hint-box hint-bad">
              {error}
            </p>
          )}
          {problem && <ProblemBox problem={problem} />}
        </div>

        <div className="dev-drawer-actions">
          {pending && (
            <>
              {admin.connected ? (
                <>
                  {policies && policies.length > 0 && (
                    <PolicySelect policies={policies} value={policy} onChange={setPolicy} />
                  )}
                  <p className="small">
                    Wird freigegeben mit <span className="mono">{admin.upn}</span>.
                  </p>
                  <ConfirmButton
                    className="button"
                    disabled={busy}
                    confirm={{
                      title: "Gerät jetzt freigeben?",
                      text: `${device.model} (${device.serial_number}) wird mit ${admin.upn} bei Microsoft dem Tenant zugeordnet. Zurücknehmen geht danach nur in Intune.`,
                      action: "Freigeben",
                    }}
                    onConfirm={onApprove}
                  >
                    {busy ? "Wird zugeordnet …" : "Jetzt freigeben"}
                  </ConfirmButton>
                </>
              ) : (
                <a className="button" href={ADMIN_LOGIN_URL}>
                  Mit Admin-Konto anmelden
                </a>
              )}
              <ConfirmButton
                className="button button-secondary"
                disabled={busy}
                confirm={{
                  title: "Eintrag verwerfen?",
                  text: `Eintrag und Gerätedaten von ${device.model} (${device.serial_number}) werden gelöscht. Das Gerät muss danach neu gescannt werden.`,
                  action: "Verwerfen",
                  danger: true,
                }}
                onConfirm={onDiscard}
              >
                Verwerfen
              </ConfirmButton>
            </>
          )}
          {!pending && device.status !== "registriert" && (
            <button
              type="button"
              className="button button-secondary"
              disabled={busy}
              onClick={() => void onRefresh()}
            >
              <Icon name="aktualisieren" /> {busy ? "Wird geprüft …" : "Status aktualisieren"}
            </button>
          )}
          {link && (
            <a className="button button-secondary" href={link} target="_blank" rel="noreferrer">
              <Icon name="extern" /> In Intune öffnen
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

type ScanStep =
  | { kind: "kamera" }
  | { kind: "pruefen"; qr: string; scan: ScanResult | null; error: string }
  | { kind: "laeuft"; qr: string; scan: ScanResult }
  | { kind: "gesendet"; scan: ScanResult }
  | { kind: "vorab"; scan: ScanResult; device: Device }
  | { kind: "doppelt"; scan: ScanResult; duplicate: Duplicate }
  | { kind: "fehler"; qr: string; scan: ScanResult; problem: Problem };

interface ScanDialogProps {
  onClose: () => void;
  onDone: () => void;
  onOpenEntry: (id: number) => void;
}

/** Scan-Dialog in drei Schritten: Scannen › Prüfen › Zuordnen. Auf dem Handy bildschirmfüllend. */
function ScanDialog({ onClose, onDone, onOpenEntry }: ScanDialogProps) {
  const [ask, confirmDialog] = useConfirm();
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModal(dialog, true, onClose);
  const [step, setStep] = useState<ScanStep>({ kind: "kamera" });
  const [policy, setPolicy] = useState("");
  const [tenantOk, setTenantOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const onCode = useCallback((qr: string) => {
    setStep({ kind: "pruefen", qr, scan: null, error: "" });
    setTenantOk(false);
    setPolicy("");
    setError("");
    scanCode(qr)
      .then((scan) => setStep({ kind: "pruefen", qr, scan, error: "" }))
      .catch((failure: unknown) =>
        setStep({
          kind: "pruefen",
          qr,
          scan: null,
          error: errorText(failure, "Der QR-Code ließ sich nicht prüfen. Bitte scanne neu."),
        }),
      );
  }, []);

  const again = () => {
    setStep({ kind: "kamera" });
    setError("");
  };

  const onImport = async (qr: string, scan: ScanResult) => {
    setStep({ kind: "laeuft", qr, scan });
    setError("");
    try {
      const result = await importNow(qr, policy || null);
      if (result.ok && result.entry) {
        setStep({ kind: "vorab", scan, device: result.entry });
      } else if (result.duplicate) {
        setStep({ kind: "doppelt", scan, duplicate: result.duplicate });
      } else if (result.error) {
        setStep({ kind: "fehler", qr, scan, problem: result.error });
      }
      onDone();
    } catch (failure) {
      setStep({ kind: "pruefen", qr, scan, error: "" });
      setError(errorText(failure, "Das hat nicht geklappt."));
    }
  };

  const onSend = async (qr: string, scan: ScanResult) => {
    setBusy(true);
    setError("");
    try {
      await sendForApproval(qr, policy || null);
      setStep({ kind: "gesendet", scan });
      onDone();
    } catch (failure) {
      setError(errorText(failure, "Das hat nicht geklappt."));
    } finally {
      setBusy(false);
    }
  };

  const stage =
    step.kind === "kamera" ? 1 : step.kind === "pruefen" ? 2 : step.kind === "laeuft" ? 3 : 3;
  const scanned = step.kind === "kamera" ? null : step.scan;
  const label = scanned ? `${scanned.model} (${scanned.serial_number})` : "";

  const askSend = () => {
    if (step.kind !== "pruefen" || !step.scan) {
      return;
    }
    const { qr, scan } = step;
    ask(
      {
        title: "Zur Freigabe senden?",
        text: `${label} wartet dann unter „Wartet auf Freigabe“. Freigeben kann jede Person mit Admin-Konto.`,
        action: "Senden",
      },
      () => onSend(qr, scan),
    );
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (step.kind === "pruefen" && step.scan?.admin_connected && tenantOk) {
      const { qr, scan } = step;
      ask(
        {
          title: "Gerät jetzt freigeben?",
          text: `${label} wird mit ${scan.admin_upn ?? "dem Admin-Konto"} bei Microsoft dem Tenant zugeordnet. Zurücknehmen geht danach nur in Intune.`,
          action: "Freigeben",
        },
        () => onImport(qr, scan),
      );
    }
  };

  return (
    <div className="dev-backdrop dev-backdrop-center">
      <div
        ref={dialog}
        className="dev-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="dev-dialog-head">
          <h2 id={titleId}>Gerät zuordnen</h2>
          <button type="button" className="button button-secondary dev-close" onClick={onClose}>
            <Icon name="schliessen" />
            <span className="visually-hidden">Schließen</span>
          </button>
        </div>
        <ol className="dev-stages" aria-label="Schritte">
          {["Scannen", "Prüfen", "Zuordnen"].map((name, index) => (
            <li
              key={name}
              className={index + 1 <= stage ? "is-done" : undefined}
              aria-current={index + 1 === stage ? "step" : undefined}
            >
              <span className="dev-stage-number" aria-hidden="true">
                {index + 1}
              </span>
              {name}
            </li>
          ))}
        </ol>

        <div className="dev-dialog-body" tabIndex={0} role="region" aria-label="Schritt">
          {step.kind === "kamera" && <Scanner onCode={onCode} />}

          {step.kind === "pruefen" && !step.scan && !step.error && (
            <p role="status">QR-Code wird geprüft …</p>
          )}
          {step.kind === "pruefen" && step.error && (
            <>
              <p role="alert" className="hint-box hint-bad">
                {step.error}
              </p>
              <div className="actions">
                <button type="button" className="button" onClick={again}>
                  Neu scannen
                </button>
              </div>
            </>
          )}

          {step.kind === "pruefen" && step.scan && (
            <form className="dev-check" onSubmit={submit} noValidate>
              <h3>Gerät prüfen</h3>
              <dl className="dev-facts">
                <dt>Hersteller</dt>
                <dd>{step.scan.manufacturer}</dd>
                <dt>Modell</dt>
                <dd>{step.scan.model}</dd>
                <dt>Seriennummer</dt>
                <dd className="mono">{step.scan.serial_number}</dd>
                <dt>QR-Code erzeugt</dt>
                <dd>{when(step.scan.generated_at)}</dd>
                {step.scan.tenant_name && (
                  <>
                    <dt>
                      Ziel-Tenant <InfoTip term="geraete.ziel-tenant" />
                    </dt>
                    <dd>{step.scan.tenant_name}</dd>
                  </>
                )}
              </dl>

              {step.scan.problem && <ProblemBox problem={step.scan.problem} />}

              {step.scan.duplicate ? (
                <>
                  <p role="alert" className="hint-box hint-warn">
                    Für diese Seriennummer gibt es schon eine Zuordnung bei Microsoft (Status:{" "}
                    {step.scan.duplicate.association_state}). Ein zweiter Import ist gesperrt.
                  </p>
                  <div className="actions">
                    <button type="button" className="button button-secondary" onClick={again}>
                      Anderes Gerät scannen
                    </button>
                    {step.scan.duplicate.entry_id !== null && (
                      <button
                        type="button"
                        className="button"
                        onClick={() => {
                          const id = step.scan?.duplicate?.entry_id;
                          if (id) {
                            onOpenEntry(id);
                          }
                        }}
                      >
                        Eintrag öffnen
                      </button>
                    )}
                  </div>
                </>
              ) : step.scan.admin_connected ? (
                <>
                  {step.scan.policies.length > 0 && (
                    <PolicySelect
                      policies={step.scan.policies}
                      value={policy}
                      onChange={setPolicy}
                    />
                  )}
                  <label className="check-label dev-tenant">
                    <input
                      type="checkbox"
                      checked={tenantOk}
                      onChange={(event) => setTenantOk(event.target.checked)}
                    />
                    <span>
                      Das Gerät gehört in den Tenant{" "}
                      <strong>{step.scan.tenant_name ?? "dieses Admin-Kontos"}</strong>.
                    </span>
                  </label>
                  <p className="small">
                    Wird zugeordnet mit <span className="mono">{step.scan.admin_upn}</span>.
                  </p>
                  {error && (
                    <p role="alert" className="hint-box hint-bad">
                      {error}
                    </p>
                  )}
                  <div className="actions">
                    <button type="button" className="button button-secondary" onClick={again}>
                      Neu scannen
                    </button>
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={busy}
                      onClick={askSend}
                    >
                      Zur Freigabe senden
                    </button>
                    <button type="submit" className="button" disabled={!tenantOk}>
                      Jetzt freigeben
                    </button>
                  </div>
                  {!tenantOk && (
                    <p className="small">Zum Freigeben erst den Ziel-Tenant bestätigen.</p>
                  )}
                </>
              ) : (
                <>
                  <p className="hint-box">
                    Zum Freigeben brauchst du dein Admin-Konto. Ohne Admin-Konto hier: „Zur Freigabe
                    senden“. Freigeben kannst dann du selbst oder jemand anderes am PC, unter
                    „Wartet auf Freigabe“.
                  </p>
                  {error && (
                    <p role="alert" className="hint-box hint-bad">
                      {error}
                    </p>
                  )}
                  <div className="actions">
                    <button type="button" className="button button-secondary" onClick={again}>
                      Neu scannen
                    </button>
                    <button type="button" className="button" disabled={busy} onClick={askSend}>
                      {busy ? "Wird gesendet …" : "Zur Freigabe senden"}
                    </button>
                  </div>
                </>
              )}
            </form>
          )}

          {step.kind === "laeuft" && (
            <div role="status" className="dev-running">
              <p className="hint-title">Gerät wird zugeordnet …</p>
              <ul>
                <li>Gerätedaten an Microsoft übertragen</li>
                <li>Auf Bestätigung „vorab zugeordnet“ warten</li>
              </ul>
              <p className="small">Das dauert meist nur ein paar Sekunden.</p>
            </div>
          )}

          {step.kind === "gesendet" && (
            <div className="dev-result" role="status">
              <p className="hint-title">
                <Icon name="haken" /> Zur Freigabe gesendet: {label}
              </p>
              <p className="dev-result-lead">Gerät in der Einrichtung stehen lassen</p>
              <p>
                Freigeben kann jetzt jede Person mit Admin-Konto am PC, unter „Wartet auf Freigabe“.
                Nach der Freigabe am Gerät auf „Weiter“ klicken. Ohne Freigabe werden die Daten nach
                24 Stunden gelöscht.
              </p>
            </div>
          )}

          {step.kind === "vorab" && (
            <div className="dev-result" role="status">
              <p className="hint-title">
                <Icon name="haken" /> Vorab zugeordnet: {label}
              </p>
              <p className="dev-result-lead">Jetzt am Gerät auf „Weiter“ klicken</p>
              <p>
                Damit schließt das Gerät die Zuordnung ab. Für den Status braucht es das Admin-Konto
                nicht mehr: Die Werkbank prüft im Hintergrund weiter und meldet sich per Push,
                sobald das Gerät in Intune registriert ist.
              </p>
            </div>
          )}

          {step.kind === "doppelt" && (
            <p role="alert" className="hint-box hint-warn">
              Für diese Seriennummer gibt es schon eine Zuordnung bei Microsoft. Ein zweiter Import
              ist gesperrt.
            </p>
          )}

          {step.kind === "fehler" && <ProblemBox problem={step.problem} />}
        </div>

        {(step.kind === "gesendet" ||
          step.kind === "vorab" ||
          step.kind === "doppelt" ||
          step.kind === "fehler") && (
          <div className="dev-dialog-actions">
            {step.kind === "fehler" && step.problem.kind === "gedrosselt" && (
              <button
                type="button"
                className="button button-secondary"
                onClick={() => void onImport(step.qr, step.scan)}
              >
                Noch einmal versuchen
              </button>
            )}
            <button type="button" className="button button-secondary" onClick={onClose}>
              Zur Liste
            </button>
            <button type="button" className="button" onClick={again}>
              Nächstes Gerät scannen
            </button>
          </div>
        )}
      </div>
      {confirmDialog}
    </div>
  );
}

/** Seite „Gerätezuordnung“ (Microsoft 365 › Geräte), spec.md Kapitel 7c. */
export function DeviceAssociationPage() {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [list, setList] = useState<DeviceList | null>(null);
  const [view, setView] = useState<DeviceView>(readView);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(readAdminResult);
  const [selected, setSelected] = useState<Device | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setList(await fetchDevices(view, query));
      setError("");
    } catch (failure) {
      setError(errorText(failure, "Die Geräte ließen sich nicht laden."));
    }
  }, [view, query]);

  const loadAdmin = useCallback(async () => {
    try {
      setAdmin(await fetchAdmin());
    } catch {
      setAdmin({ connected: false, upn: null, name: null, expires_at: null });
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadAdmin(), 0);
    // Rückmeldung der Anmeldung mit dem Admin-Konto aus der Adresse entfernen
    const params = new URLSearchParams(window.location.search);
    if (params.has("admin")) {
      params.delete("admin");
      const rest = params.toString();
      window.history.replaceState(null, "", rest ? `${PAGE}?${rest}` : PAGE);
    }
    return () => window.clearTimeout(timer);
  }, [loadAdmin]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), query ? 250 : 0);
    // Offene Einträge prüft der Server alle 5 Minuten; die Liste lädt jede Minute neu.
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void load();
      }
    }, 60_000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, [load, query]);

  const chooseView = (next: DeviceView) => {
    setView(next);
    window.history.replaceState(null, "", next === "alle" ? PAGE : `${PAGE}?ansicht=${next}`);
  };

  const onDisconnect = async () => {
    try {
      await disconnectAdmin();
      setMessage({ text: "Admin-Konto getrennt.", bad: false });
    } catch (failure) {
      setMessage({ text: errorText(failure, "Trennen hat nicht geklappt."), bad: true });
    }
    await loadAdmin();
  };

  const onRefreshAll = async () => {
    setRefreshing(true);
    try {
      const result = await refreshAll();
      setMessage({ text: `${result.checked} Geräte geprüft.`, bad: false });
      await load();
    } catch (failure) {
      setMessage({ text: errorText(failure, "Aktualisieren hat nicht geklappt."), bad: true });
    } finally {
      setRefreshing(false);
    }
  };

  const openEntry = (id: number) => {
    setScanOpen(false);
    fetchDevice(id)
      .then(setSelected)
      .catch((failure: unknown) =>
        setMessage({ text: errorText(failure, "Der Eintrag ließ sich nicht öffnen."), bad: true }),
      );
  };

  const counts = list?.counts;
  const entries = list?.entries ?? [];

  return (
    <div className="page page-wide dev-page">
      <header className="page-head dev-head">
        <div>
          <p className="module-label">Microsoft 365 › Geräte</p>
          <h1>Gerätezuordnung</h1>
          <p className="page-sub">
            Neue Windows-Geräte per QR-Code aus der Einrichtung dem Tenant zuordnen und verfolgen,
            bis sie in Intune registriert sind.
          </p>
        </div>
        <div className="actions">
          <button
            type="button"
            className="button button-secondary"
            disabled={refreshing}
            onClick={() => void onRefreshAll()}
          >
            <Icon name="aktualisieren" /> {refreshing ? "Wird geprüft …" : "Alle aktualisieren"}
          </button>
          <button type="button" className="button" onClick={() => setScanOpen(true)}>
            <Icon name="qr" /> QR-Code scannen
          </button>
        </div>
      </header>

      <Feedback
        message={message ? { kind: message.bad ? "alert" : "status", text: message.text } : null}
        onClose={() => setMessage(null)}
      />
      {error && (
        <p role="alert" className="hint-box hint-bad">
          {error}
        </p>
      )}

      {admin && <AdminCard admin={admin} onDisconnect={onDisconnect} />}

      {counts && counts.freigabe > 0 && view !== "freigabe" && (
        <div className="hint-box hint-warn dev-pending">
          <p>
            <strong>Wartet auf Freigabe:</strong> {counts.freigabe}{" "}
            {counts.freigabe === 1 ? "Gerät wurde" : "Geräte wurden"} gescannt und{" "}
            {counts.freigabe === 1 ? "wartet" : "warten"} auf Freigabe mit einem Admin-Konto.
          </p>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => chooseView("freigabe")}
          >
            Anzeigen
          </button>
        </div>
      )}

      {counts && (
        <dl className="kpis dev-kpis">
          <div className="kpi">
            <dt>Vorab zugeordnet</dt>
            <dd>
              <span className="kpi-number">{counts.vorab}</span>
              <span className="small">warten auf „Weiter“ am Gerät</span>
            </dd>
          </div>
          <div className="kpi">
            <dt>Zugeordnet</dt>
            <dd>
              <span className="kpi-number">{counts.zugeordnet}</span>
              <span className="small">noch nicht in Intune registriert</span>
            </dd>
          </div>
          <div className="kpi">
            <dt>In Intune registriert</dt>
            <dd>
              <span className="kpi-number">{counts.registriert}</span>
              <span className="small">abgeschlossen</span>
            </dd>
          </div>
          <div className="kpi">
            <dt>Nicht abgeschlossen</dt>
            <dd>
              <span className="kpi-number">{counts.nicht_abgeschlossen}</span>
              <span className="small">nach 7 Tagen ohne Rückmeldung</span>
            </dd>
          </div>
        </dl>
      )}

      <FilterBar
        search={{
          label: "Suchen",
          value: query,
          placeholder: "Seriennummer oder Modell",
          onChange: setQuery,
          hits: entries.map((device) => ({
            key: device.id,
            title: device.serial_number,
            extra: device.model ?? undefined,
            onOpen: () => setSelected(device),
          })),
          total: list?.total ?? entries.length,
        }}
        status={{
          label: "Ansicht",
          value: view,
          onChange: chooseView,
          options: VIEWS.map((item) => ({
            value: item.id,
            label: item.label,
            count: item.count && counts ? countFor(counts, item.count) : null,
          })),
        }}
      />

      <div className="panel dev-list">
        {list && entries.length === 0 ? (
          <p className="empty">Keine Geräte in dieser Ansicht.</p>
        ) : (
          <>
            <table className="dev-table" aria-label="Geräte">
              <thead>
                <tr>
                  <th scope="col">Seriennummer</th>
                  <th scope="col">Gerät</th>
                  <th scope="col">Richtlinie</th>
                  <th scope="col">Status</th>
                  <th scope="col">Letzte Prüfung</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((device) => (
                  <tr key={device.id}>
                    <td>
                      <button
                        type="button"
                        className="row-button mono"
                        onClick={() => setSelected(device)}
                      >
                        {device.serial_number}
                      </button>
                    </td>
                    <td>
                      {device.model}
                      <span className="small dev-sub">{device.manufacturer}</span>
                    </td>
                    <td>{device.policy_name ?? "–"}</td>
                    <td>
                      <span className="dev-status">
                        <Steps device={device} />
                        <StatusPill device={device} />
                      </span>
                    </td>
                    <td className="nowrap">
                      {device.status === "registriert"
                        ? "abgeschlossen"
                        : when(device.last_checked_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="dev-cards">
              {entries.map((device) => (
                <li key={device.id}>
                  <button type="button" className="dev-card" onClick={() => setSelected(device)}>
                    <span className="dev-card-top">
                      <span className="mono">{device.serial_number}</span>
                      <StatusPill device={device} />
                    </span>
                    <span>
                      {device.manufacturer} {device.model}
                    </span>
                    <span className="dev-card-foot small">
                      <Steps device={device} />
                      {device.policy_name ?? "Ohne Richtlinie"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {list && list.total > entries.length && (
              <p className="small panel-note" role="status">
                Angezeigt werden die neuesten {entries.length} von {list.total} Geräten. Grenze mit
                Suche oder Ansicht weiter ein.
              </p>
            )}
          </>
        )}
      </div>

      {list && (
        <p className="small dev-footnote">
          <Icon name="info" />{" "}
          {list.monitor
            ? `Offene Einträge werden im Hintergrund alle 5 Minuten geprüft, höchstens 7 Tage lang. Letzter Lauf: ${when(list.last_run)}.`
            : "Die Prüfung im Hintergrund ist aus. Den Status prüfst du mit „Alle aktualisieren“, solange das Admin-Konto verbunden ist."}
        </p>
      )}

      {selected && admin && (
        <DeviceDrawer
          key={selected.id}
          device={selected}
          admin={admin}
          onClose={() => setSelected(null)}
          onChanged={(device, text) => {
            setSelected(device);
            setMessage({ text, bad: false });
            void load();
          }}
        />
      )}
      {scanOpen && (
        <ScanDialog
          onClose={() => setScanOpen(false)}
          onDone={() => void load()}
          onOpenEntry={openEntry}
        />
      )}
    </div>
  );
}
