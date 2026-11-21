import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { errorText } from "../../api";
import { InfoTip } from "../../components/InfoTip";
import { Link } from "../../components/Link";
import type { HelpKey } from "../../help/terms";
import { Tabs, tabIds } from "../../components/Tabs";
import { Timeline } from "../../components/Timeline";
import { FormStep } from "../budget/shared";
import type { LookupItem } from "../inventory/api";
import { LookupPicker } from "../inventory/LookupPicker";
import {
  CODETERMINATION,
  DEFAULT_STATES,
  ENTRY_STATES,
  NOTE_LABELS,
  SOURCE_LABELS,
  addNote,
  closeEntry,
  daysUntil,
  fetchEntry,
  formatDate,
  kindPill,
  reopenEntry,
  saveAssessment,
  searchSettings,
  type Codetermination,
  type DefaultState,
  type Entry,
  type Phase,
} from "./api";

const NOTE_MAX = 4000;
const TEXT_MAX = 4000;
const MAX_PHASES = 6;
const SUGGESTED = "Vorschlag, ungeprüft";
const CODETERMINATION_HELP =
  "Eignet sich die Funktion zur Leistungs- oder Verhaltenskontrolle, oder verarbeitet sie neue personenbezogene Daten?";

type TabId = "bewertung" | "microsoft" | "verlauf";

function SuggestedPill() {
  return (
    <span className="ev-suggested-wrap">
      <span className="pill pill-neutral ev-suggested">{SUGGESTED}</span>
      <InfoTip term="evergreen.vorschlag" />
    </span>
  );
}

function deadlineText(iso: string): string {
  const days = daysUntil(iso);
  if (days > 1) {
    return `noch ${days} Tage`;
  }
  if (days === 1) {
    return "morgen";
  }
  if (days === 0) {
    return "heute";
  }
  return days === -1 ? "seit gestern vorbei" : `seit ${-days} Tagen vorbei`;
}

function Fact({
  label,
  info,
  value,
  sub,
  warn = false,
  extra,
}: {
  label: string;
  info: HelpKey;
  value: string;
  sub?: string | null;
  warn?: boolean;
  extra?: ReactNode;
}) {
  return (
    <div className={warn ? "ev-fact ev-fact-warn" : "ev-fact"}>
      <dt>
        {label} <InfoTip term={info} />
      </dt>
      <dd>
        <span className="ev-fact-value">{value}</span>
        {sub && <span className="small">{sub}</span>}
        {extra}
      </dd>
    </div>
  );
}

/** Oberste Karte: Kopf, Badges, vier Kacheln und Rollout. */
function Profile({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const tags = new Set(entry.tags.map((tag) => tag.toLowerCase()));
  const state = ENTRY_STATES[entry.status];
  const suggested = new Set(entry.suggested);
  const fromMicrosoft = entry.source === "nachrichtencenter";
  return (
    <section className="panel ev-profile" aria-labelledby="eintrag-titel">
      <div className="ev-profile-top small">
        <span className="mono">{entry.number}</span>
        {fromMicrosoft && entry.source_ref && (
          <>
            <span aria-hidden="true">·</span>
            <span className="mono">{entry.source_ref}</span>
          </>
        )}
        <span aria-hidden="true">·</span>
        <span>
          {entry.published_at
            ? `veröffentlicht am ${formatDate(entry.published_at)}`
            : `${SOURCE_LABELS[entry.source] ?? entry.source}, angelegt am ${formatDate(entry.created_at)}`}
        </span>
        <span className={`pill ${state.pill} ev-profile-status`}>{state.label}</span>
        <button
          type="button"
          className="button button-secondary case-close"
          aria-label="Ansicht schließen"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <h2 id="eintrag-titel">{entry.title}</h2>
      <ul className="ev-badges" aria-label="Kennzeichen">
        {entry.services.map((service) => (
          <li key={service} className="pill pill-neutral">
            {service}
          </li>
        ))}
        {entry.kind && <li className={`pill ${kindPill(entry.kind)}`}>{entry.kind}</li>}
        {tags.has("user impact") && <li className="pill pill-todo">Betrifft Nutzer</li>}
        {tags.has("admin impact") && <li className="pill pill-todo">Betrifft Admins</li>}
        {entry.major_change && <li className="pill pill-todo">Größere Änderung</li>}
        {entry.action_required_by && <li className="pill pill-todo">Handlung nötig</li>}
      </ul>
      <dl className="ev-facts">
        <Fact
          label="Betroffen"
          info="evergreen.betroffen"
          value={entry.affected ?? "Noch offen"}
          extra={suggested.has("affected") ? <SuggestedPill /> : null}
        />
        <Fact
          label="Standard"
          info="evergreen.standard"
          value={entry.default_state ? DEFAULT_STATES[entry.default_state] : "Noch offen"}
          sub={
            entry.default_state && entry.default_state !== "entfaellt" ? "nach dem Rollout" : null
          }
          warn={entry.default_state === "an"}
        />
        <Fact
          label="Steuerbar"
          info="evergreen.steuerbar"
          value={entry.controllable === null ? "Noch offen" : entry.controllable ? "Ja" : "Nein"}
          sub={entry.controllable ? entry.controllable_how : null}
        />
        <Fact
          label="Handeln bis"
          info="evergreen.handeln-bis"
          value={entry.action_required_by ? formatDate(entry.action_required_by) : "–"}
          sub={
            entry.action_required_by
              ? deadlineText(entry.action_required_by)
              : fromMicrosoft
                ? "keine Frist von Microsoft"
                : null
          }
          warn={entry.action_required_by !== null}
        />
      </dl>
      <div className="ev-rollout">
        <div className="ev-rollout-head">
          <h3>Rollout</h3>
          <InfoTip term="evergreen.rollout" />
          {suggested.has("phases") && <SuggestedPill />}
          {entry.schedule_changed_at && (
            <span className="ev-changed">
              Zeitplan geändert am {formatDate(entry.schedule_changed_at)}
            </span>
          )}
        </div>
        {entry.phases.length > 0 || entry.phases_previous.length > 0 ? (
          <Timeline label="Rollout-Phasen" phases={entry.phases} previous={entry.phases_previous} />
        ) : (
          <p className="small">Noch kein Zeitplan eingetragen.</p>
        )}
        {entry.schedule_previous && (
          <details className="ev-previous">
            <summary>Vorheriger Zeitplan von Microsoft</summary>
            <p lang="en" className="ev-text">
              {entry.schedule_previous}
            </p>
          </details>
        )}
      </div>
    </section>
  );
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function settingItem(entry: Entry): LookupItem | null {
  return entry.setting
    ? {
        id: entry.setting.id,
        label: entry.setting.path,
        detail: entry.setting.value ? `Aktuell: ${entry.setting.value}` : "",
      }
    : null;
}

/** Reiter „Unsere Bewertung“ für Bearbeiter: Formular in Abschnitten. */
function AssessmentForm({ entry, onSaved }: { entry: Entry; onSaved: (entry: Entry) => void }) {
  const [summary, setSummary] = useState(entry.summary ?? "");
  const [staffChange, setStaffChange] = useState(entry.staff_change ?? "");
  const [training, setTraining] = useState(entry.training ?? "");
  const [codetermination, setCodetermination] = useState<Codetermination | null>(
    entry.codetermination,
  );
  const [reason, setReason] = useState(entry.codetermination_reason ?? "");
  const [setting, setSetting] = useState<LookupItem | null>(settingItem(entry));
  const [affected, setAffected] = useState(entry.affected ?? "");
  const [defaultState, setDefaultState] = useState<DefaultState | "">(entry.default_state ?? "");
  const [controllable, setControllable] = useState<"" | "ja" | "nein">(
    entry.controllable === null ? "" : entry.controllable ? "ja" : "nein",
  );
  const [controllableHow, setControllableHow] = useState(entry.controllable_how ?? "");
  const [phases, setPhases] = useState<Phase[]>(entry.phases);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const id = useId();
  const suggested = new Set(entry.suggested);

  const changePhase = (index: number, patch: Partial<Phase>) =>
    setPhases(phases.map((phase, at) => (at === index ? { ...phase, ...patch } : phase)));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const broken = phases.find((phase) => !phase.name.trim() || !phase.start || !phase.end);
    if (broken) {
      setError("Jede Rollout-Phase braucht einen Namen, einen Beginn und ein Ende.");
      return;
    }
    const backwards = phases.find((phase) => phase.end < phase.start);
    if (backwards) {
      setError(`Rollout „${backwards.name}“: Das Ende liegt vor dem Beginn.`);
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    saveAssessment(entry.id, {
      summary: emptyToNull(summary),
      staff_change: emptyToNull(staffChange),
      training: emptyToNull(training),
      codetermination,
      codetermination_reason: emptyToNull(reason),
      setting_id: setting ? setting.id : null,
      affected: emptyToNull(affected),
      default_state: defaultState || null,
      controllable: controllable === "" ? null : controllable === "ja",
      controllable_how: controllable === "ja" ? emptyToNull(controllableHow) : null,
      phases: phases.map((phase) => ({ ...phase, name: phase.name.trim() })),
    }).then(
      (updated) => {
        setBusy(false);
        setSaved(true);
        onSaved(updated);
      },
      (problem: unknown) => {
        setBusy(false);
        setError(errorText(problem, "Die Bewertung konnte nicht gespeichert werden."));
      },
    );
  };

  const textField = (
    key: string,
    label: string,
    value: string,
    onChange: (value: string) => void,
    hint?: string,
  ) => (
    <div className="form-wide form-field ev-field">
      <label htmlFor={`${id}-${key}`} className="form-label">
        {label}
      </label>
      {hint && (
        <span id={`${id}-${key}-hint`} className="form-hint">
          {hint}
        </span>
      )}
      <textarea
        id={`${id}-${key}`}
        aria-describedby={hint ? `${id}-${key}-hint` : undefined}
        rows={3}
        maxLength={TEXT_MAX}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );

  return (
    <form className="settings-form budget-form ev-assessment" onSubmit={submit} noValidate>
      {error && (
        <p role="alert" className="hint-box hint-bad">
          {error}
        </p>
      )}
      <FormStep number={1} title="Bewertung">
        {textField(
          "summary",
          "Kurzfassung",
          summary,
          setSummary,
          "In Klartext, auch für Menschen ohne IT-Hintergrund.",
        )}
        {textField("staff", "Was ändert sich für Mitarbeitende?", staffChange, setStaffChange)}
        {textField("training", "Schulung / Kommunikation", training, setTraining)}
      </FormStep>
      <FormStep number={2} title="Mitbestimmungsrelevant?">
        <div className="form-wide form-field">
          <span className="ev-help-row">
            <span id={`${id}-cd-help`} className="form-hint">
              {CODETERMINATION_HELP}
            </span>
            <InfoTip term="evergreen.mitbestimmung" />
          </span>
          <div
            className="segmented"
            role="radiogroup"
            aria-label="Mitbestimmungsrelevant"
            aria-describedby={`${id}-cd-help`}
          >
            {(Object.keys(CODETERMINATION) as Codetermination[]).map((value) => (
              <label key={value} className="segmented-radio check-label">
                <input
                  type="radio"
                  name={`${id}-cd`}
                  value={value}
                  checked={codetermination === value}
                  onChange={() => setCodetermination(value)}
                />
                <span>{CODETERMINATION[value].label}</span>
              </label>
            ))}
          </div>
        </div>
        {textField("reason", "Begründung", reason, setReason)}
      </FormStep>
      <FormStep number={3} title="Verknüpfte Einstellung" hint="optional">
        <div className="form-wide form-field ev-field">
          <LookupPicker
            label="Einstellung aus der M365-Konfiguration"
            placeholder="Pfad suchen, z. B. Teams"
            search={searchSettings}
            value={setting}
            onChange={setSetting}
          />
          {setting && (
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setSetting(null)}
            >
              Verknüpfung lösen
            </button>
          )}
        </div>
      </FormStep>
      <FormStep number={4} title="Steckbrief und Rollout">
        <div className="form-wide form-field ev-field">
          <label htmlFor={`${id}-affected`} className="form-label">
            Betroffen
          </label>
          {suggested.has("affected") && <SuggestedPill />}
          <input
            id={`${id}-affected`}
            maxLength={200}
            placeholder="z. B. Alle Nutzer mit Copilot-Lizenz"
            value={affected}
            onChange={(event) => setAffected(event.target.value)}
          />
        </div>
        <div className="form-field ev-field">
          <label htmlFor={`${id}-default`} className="form-label">
            Standard nach dem Rollout
          </label>
          <select
            id={`${id}-default`}
            value={defaultState}
            onChange={(event) => setDefaultState(event.target.value as DefaultState | "")}
          >
            <option value="">Noch offen</option>
            {(Object.keys(DEFAULT_STATES) as DefaultState[]).map((value) => (
              <option key={value} value={value}>
                {DEFAULT_STATES[value]}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field ev-field">
          <label htmlFor={`${id}-control`} className="form-label">
            Steuerbar
          </label>
          <select
            id={`${id}-control`}
            value={controllable}
            onChange={(event) => setControllable(event.target.value as "" | "ja" | "nein")}
          >
            <option value="">Noch offen</option>
            <option value="ja">Ja</option>
            <option value="nein">Nein</option>
          </select>
        </div>
        {controllable === "ja" && (
          <div className="form-wide form-field ev-field">
            <label htmlFor={`${id}-how`} className="form-label">
              Steuerbar womit?
            </label>
            <input
              id={`${id}-how`}
              maxLength={300}
              placeholder="z. B. Besprechungsrichtlinie"
              value={controllableHow}
              onChange={(event) => setControllableHow(event.target.value)}
            />
          </div>
        )}
        <fieldset className="form-wide ev-phases">
          <legend>Rollout-Phasen {suggested.has("phases") && <SuggestedPill />}</legend>
          {phases.length === 0 && <p className="small">Noch keine Phase eingetragen.</p>}
          {phases.map((phase, index) => (
            <div className="ev-phase" key={index}>
              <label>
                <span>Phase {index + 1}</span>
                <input
                  maxLength={60}
                  value={phase.name}
                  onChange={(event) => changePhase(index, { name: event.target.value })}
                />
              </label>
              <label>
                <span>Beginn</span>
                <input
                  type="month"
                  value={phase.start}
                  onChange={(event) => changePhase(index, { start: event.target.value })}
                />
              </label>
              <label>
                <span>Ende</span>
                <input
                  type="month"
                  value={phase.end}
                  onChange={(event) => changePhase(index, { end: event.target.value })}
                />
              </label>
              <button
                type="button"
                className="button button-secondary button-danger"
                aria-label={`Phase ${index + 1} entfernen`}
                onClick={() => setPhases(phases.filter((_, at) => at !== index))}
              >
                Entfernen
              </button>
            </div>
          ))}
          {phases.length < MAX_PHASES && (
            <button
              type="button"
              className="button button-secondary ev-add-phase"
              onClick={() => setPhases([...phases, { name: "", start: "", end: "" }])}
            >
              Phase hinzufügen
            </button>
          )}
        </fieldset>
      </FormStep>
      <div className="project-actions">
        <button type="submit" className="button button-primary" disabled={busy}>
          Bewertung speichern
        </button>
      </div>
      {saved && (
        <p role="status" className="small">
          Gespeichert.
        </p>
      )}
    </form>
  );
}

function Text({ value }: { value: string | null }) {
  return value ? <p className="ev-text">{value}</p> : <p className="small">Noch nicht bewertet.</p>;
}

/** Reiter „Unsere Bewertung“ für Leser: nur Text. */
function AssessmentView({ entry }: { entry: Entry }) {
  const cd = entry.codetermination ? CODETERMINATION[entry.codetermination] : null;
  return (
    <div className="ev-assessment-view">
      <h3>Kurzfassung</h3>
      <Text value={entry.summary} />
      <h3>Was ändert sich für Mitarbeitende?</h3>
      <Text value={entry.staff_change} />
      <h3>Schulung / Kommunikation</h3>
      <Text value={entry.training} />
      <div className="ev-codetermination">
        <div className="ev-help-row">
          <h3>Mitbestimmungsrelevant?</h3>
          <InfoTip term="evergreen.mitbestimmung" />
        </div>
        <p className="small">{CODETERMINATION_HELP}</p>
        {cd ? (
          <p>
            <span className={`pill ${cd.pill}`}>{cd.label}</span>
          </p>
        ) : (
          <p className="small">Noch nicht bewertet.</p>
        )}
        {entry.codetermination_reason && <p className="ev-text">{entry.codetermination_reason}</p>}
      </div>
    </div>
  );
}

function LinkedSettingBox({ entry }: { entry: Entry }) {
  if (!entry.setting) {
    return null;
  }
  return (
    <div className="ev-setting">
      <h3>Verknüpfte Einstellung</h3>
      <div className="ev-setting-row">
        <span className="mono">{entry.setting.path}</span>
        {entry.setting.value && <span className="pill pill-neutral">{entry.setting.value}</span>}
        {entry.setting.can_open && (
          <Link to={`/m365/einstellungen/${entry.setting.id}`}>Einstellung und Verlauf öffnen</Link>
        )}
      </div>
    </div>
  );
}

/** Reiter „Text von Microsoft“: Abschnitte zum Aufklappen. */
function MessageText({ entry }: { entry: Entry }) {
  const fromMicrosoft = entry.source === "nachrichtencenter";
  if (entry.sections.length === 0) {
    return <p className="small">Kein Text vorhanden.</p>;
  }
  return (
    <div className="ev-sections">
      {fromMicrosoft && entry.modified_at && (
        <p className="small">Zuletzt von Microsoft geändert: {formatDate(entry.modified_at)}</p>
      )}
      {entry.sections.map((section, index) => (
        <details key={index} className="ev-section" open={index === 0}>
          <summary>{section.head ?? (fromMicrosoft ? "Text der Meldung" : "Beschreibung")}</summary>
          <p className="ev-text" lang={fromMicrosoft ? "en" : undefined}>
            {section.text}
          </p>
        </details>
      ))}
    </div>
  );
}

/** Reiter „Notizen und Verlauf“: Verlauf, Notiz, Abschließen und Wieder öffnen. */
function History({ entry, onChanged }: { entry: Entry; onChanged: (entry: Entry) => void }) {
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const noteId = useId();
  const done = entry.status === "abgeschlossen";

  const run = (action: () => Promise<Entry>) => {
    setBusy(true);
    setNotice(null);
    action().then(
      (updated) => {
        setNote("");
        setBusy(false);
        onChanged(updated);
      },
      (problem: unknown) => {
        setBusy(false);
        setNotice(errorText(problem, "Das hat nicht geklappt."));
      },
    );
  };
  const submitNote = (event: FormEvent) => {
    event.preventDefault();
    if (!note.trim()) {
      setNotice("Bitte eine Notiz eingeben.");
      return;
    }
    run(() => addNote(entry.id, note.trim()));
  };

  return (
    <>
      {notice && (
        <p role="alert" className="hint-box hint-bad">
          {notice}
        </p>
      )}
      {entry.notes.length === 0 ? (
        <p className="empty">Noch keine Notizen.</p>
      ) : (
        <ol className="timeline">
          {entry.notes.map((item) => (
            <li key={item.id}>
              <div className="timeline-head">
                <strong>{NOTE_LABELS[item.kind] ?? item.kind}</strong>
                <span className="small">
                  {formatDate(item.created_at)} · {item.author ?? "Werkbank"}
                </span>
              </div>
              {item.text && <span className="ev-note">{item.text}</span>}
              {item.changes.length > 0 && (
                <ul className="ev-changes">
                  {item.changes.map((change, index) => (
                    <li key={index}>
                      <strong>{change.field}:</strong> {change.old ?? "leer"} →{" "}
                      {change.new ?? "leer"}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
      {entry.can_edit && (
        <form className="settings-form form-stack ev-note-form" onSubmit={submitNote}>
          <label htmlFor={noteId}>{done ? "Notiz zum Wiederöffnen (optional)" : "Notiz"}</label>
          <textarea
            id={noteId}
            value={note}
            rows={3}
            maxLength={NOTE_MAX}
            onChange={(event) => setNote(event.target.value)}
          />
          <div className="project-actions">
            {done ? (
              <button
                type="button"
                className="button button-primary"
                disabled={busy}
                onClick={() => run(() => reopenEntry(entry.id, note.trim()))}
              >
                Wieder öffnen
              </button>
            ) : (
              <>
                <button type="submit" className="button button-primary" disabled={busy}>
                  Notiz anfügen
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={busy}
                  onClick={() => run(() => closeEntry(entry.id, note.trim()))}
                >
                  Abschließen
                </button>
              </>
            )}
          </div>
          {!done && (
            <p className="small">
              „Abschließen“ nimmt den Text oben als letzte Notiz mit, wenn du etwas eingetragen
              hast.
            </p>
          )}
        </form>
      )}
    </>
  );
}

/** Ansicht eines Eintrags: Steckbrief mit Rollout, darunter drei Reiter. */
export function EntryDetail({
  entryId,
  onChanged,
  onClose,
}: {
  entryId: number;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [entry, setEntry] = useState<Entry | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("bewertung");
  const prefix = `ev-${entryId}`;

  useEffect(() => {
    let active = true;
    fetchEntry(entryId).then(
      (loaded) => active && setEntry(loaded),
      (problem: unknown) =>
        active && setFailed(errorText(problem, "Der Eintrag konnte nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, [entryId]);

  if (failed) {
    return (
      <p role="alert" className="hint-box hint-bad">
        {failed}
      </p>
    );
  }
  if (!entry) {
    return <p role="status">Wird geladen …</p>;
  }
  const update = (updated: Entry) => {
    setEntry(updated);
    onChanged();
  };
  const tabs: { id: TabId; label: string }[] = [
    { id: "bewertung", label: "Unsere Bewertung" },
    {
      id: "microsoft",
      label: entry.source === "nachrichtencenter" ? "Text von Microsoft" : "Beschreibung",
    },
    { id: "verlauf", label: "Notizen und Verlauf" },
  ];
  const panel = (id: TabId, content: ReactNode) => {
    const ids = tabIds(prefix, id);
    return (
      <div
        id={ids.panel}
        role="tabpanel"
        aria-labelledby={ids.tab}
        className="tab-panel"
        hidden={tab !== id}
        tabIndex={0}
      >
        {tab === id && content}
      </div>
    );
  };

  return (
    <>
      <Profile entry={entry} onClose={onClose} />
      <section className="panel ev-tabs" aria-label="Bewertung, Text und Verlauf">
        <Tabs
          label="Ansicht des Eintrags"
          prefix={prefix}
          tabs={tabs}
          value={tab}
          onChange={setTab}
        />
        {panel(
          "bewertung",
          <>
            {entry.can_edit ? (
              <AssessmentForm key={entry.id} entry={entry} onSaved={update} />
            ) : (
              <AssessmentView entry={entry} />
            )}
            <LinkedSettingBox entry={entry} />
          </>,
        )}
        {panel("microsoft", <MessageText entry={entry} />)}
        {panel("verlauf", <History entry={entry} onChanged={update} />)}
      </section>
    </>
  );
}
