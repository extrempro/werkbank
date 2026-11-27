import { useEffect, useState, type FormEvent } from "react";
import { errorText } from "../../api";
import { ConfirmButton } from "../../components/ConfirmDialog";
import { Feedback } from "../../components/Feedback";
import {
  ChoiceCards,
  ErrorSummary,
  Field,
  RequiredNote,
  problemFor,
  type Problem,
} from "../../components/Field";
import { FilterBar } from "../../components/FilterBar";
import { FormStep } from "../../components/FormStep";
import { InfoTip } from "../../components/InfoTip";
import { Link } from "../../components/Link";
import { ListChoice } from "../../components/ListChoice";
import { SignaturePad } from "../../components/SignaturePad";
import { INVENTORY_ISSUES_PATH, INVENTORY_LOANS_PATH } from "../../navigation";
import { navigate } from "../../router";
import { hardwarePath, INVENTORY_EDITOR_ROLE, positionPath, type Person } from "./api";
import {
  addIssueTask,
  cancelIssue,
  CONDITION_LABELS,
  createIssue,
  fetchFreeDevices,
  fetchIssue,
  fetchIssues,
  fetchPersonPositions,
  filterFree,
  formatDateTime,
  fromLocalInput,
  handOverIssue,
  ISSUE_FILTERS,
  ISSUE_STATES,
  issuePath,
  markIssueReady,
  REASON_LABELS,
  renewIssueLink,
  setIssuePickup,
  setIssueTask,
  signatureUrl,
  toLocalInput,
  type ConfirmMethod,
  type FreeDevice,
  type Issue,
  type IssueCondition,
  type IssueFilter,
  type IssueReason,
  type IssueSummary,
  type PersonPosition,
} from "./issuesApi";
import { MoreButton, useDebounced, usePagedList } from "./paged";
import { PersonPicker } from "./PersonPicker";

const MESSAGE_LABELS: Record<string, string> = {
  offen: "wird verschickt",
  gesendet: "verschickt",
  fehler: "fehlgeschlagen",
  aus: "nicht verschickt",
};

function ErrorText({ text }: { text: string | null }) {
  return text ? (
    <p role="alert" className="hint-box hint-bad">
      {text}
    </p>
  ) : null;
}

/** Neue Ausgabe: Person und Stelle, Geräte mit Zubehör, Zustand, Art der Bestätigung. */
function NewIssueForm({ onCreated }: { onCreated: (issue: Issue) => void }) {
  const [person, setPerson] = useState<Person | null>(null);
  const [positions, setPositions] = useState<PersonPosition[] | null>(null);
  const [positionId, setPositionId] = useState("");
  const [reason, setReason] = useState<IssueReason>("neu");
  const [devices, setDevices] = useState<FreeDevice[] | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Record<number, string[]>>({});
  const [condition, setCondition] = useState<IssueCondition>("neuwertig");
  const [note, setNote] = useState("");
  const [attachRules, setAttachRules] = useState(true);
  const [notifyTeams, setNotifyTeams] = useState(false);
  const [method, setMethod] = useState<ConfirmMethod>("unterschrift");
  const [problems, setProblems] = useState<Problem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetchFreeDevices().then(
      (result) => active && setDevices(result),
      (problem: unknown) =>
        active && setError(errorText(problem, "Die Geräte konnten nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, []);

  const pickPerson = (next: Person | null) => {
    setPerson(next);
    setPositions(null);
    setPositionId("");
    if (!next) {
      return;
    }
    fetchPersonPositions(next.oid).then(
      (result) => {
        setPositions(result);
        setPositionId(result.length === 1 && result[0] ? String(result[0].id) : "");
      },
      (problem: unknown) =>
        setError(errorText(problem, "Die Stellen der Person konnten nicht geladen werden.")),
    );
  };

  const toggleDevice = (device: FreeDevice) => {
    const next = { ...picked };
    if (device.id in next) {
      delete next[device.id];
    } else {
      next[device.id] = [];
    }
    setPicked(next);
  };

  const toggleAccessory = (id: number, name: string) => {
    const current = picked[id] ?? [];
    setPicked({
      ...picked,
      [id]: current.includes(name) ? current.filter((item) => item !== name) : [...current, name],
    });
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const found: Problem[] = [];
    if (!person) {
      found.push({ id: "ausgabe-person", label: "Person", text: "Bitte wähle die Person." });
    }
    if (person && !positionId) {
      found.push({ id: "ausgabe-stelle", label: "Stelle", text: "Bitte wähle die Stelle." });
    }
    if (Object.keys(picked).length === 0) {
      found.push({
        id: "ausgabe-geraete",
        label: "Geräte",
        text: "Bitte wähle mindestens ein Gerät.",
      });
    }
    setProblems(found);
    if (found.length > 0 || !person) {
      return;
    }
    setBusy(true);
    setError(null);
    createIssue({
      person_oid: person.oid,
      position_id: Number(positionId),
      reason,
      items: Object.entries(picked).map(([id, accessories]) => ({
        hardware_id: Number(id),
        accessories,
      })),
      condition,
      condition_note: note.trim(),
      attach_rules: attachRules,
      notify_teams: notifyTeams,
      confirm_method: method,
    }).then(onCreated, (problem: unknown) => {
      setError(errorText(problem, "Die Ausgabe konnte nicht angelegt werden."));
      setBusy(false);
    });
  };

  const shown = devices ? filterFree(devices, query) : [];
  const chosen = (devices ?? []).filter((device) => device.id in picked);
  return (
    <section className="panel" aria-labelledby="ausgabe-neu">
      <div className="panel-head">
        <h2 id="ausgabe-neu">Neue Ausgabe</h2>
      </div>
      <form className="detail-body form-stack" onSubmit={onSubmit} noValidate>
        <p className="small">
          Geräte dauerhaft für die Arbeit übergeben. Auf Zeit? Dann den{" "}
          <Link to={INVENTORY_LOANS_PATH}>Verleih</Link>.
        </p>
        <RequiredNote />
        <ErrorSummary problems={problems} />
        <FormStep number={1} title="Person">
          <PersonPicker
            id="ausgabe-person"
            value={person}
            onChange={pickPerson}
            label="Person aus Entra"
            hint="Die Person muss im IT-Bestand an einer Stelle eingetragen sein."
            required
            error={problemFor(problems, "ausgabe-person")}
          />
          {person && positions && positions.length === 0 && (
            <p className="hint-box hint-warn">
              {person.name} ist an keiner Stelle eingetragen. Trag die Person zuerst bei der Stelle
              ein.
            </p>
          )}
          {positions && positions.length > 0 && (
            <ListChoice
              id="ausgabe-stelle"
              label="Stelle"
              required
              options={positions.map((entry) => ({
                id: entry.id,
                label: `${entry.number} ${entry.name}`,
              }))}
              value={positionId}
              onChange={setPositionId}
              hint="Nach der Übergabe hängen die Geräte an dieser Stelle."
              error={problemFor(problems, "ausgabe-stelle")}
            />
          )}
          <ChoiceCards
            legend="Anlass"
            value={reason}
            onChange={setReason}
            options={(Object.keys(REASON_LABELS) as IssueReason[]).map((value) => ({
              value,
              label: REASON_LABELS[value],
            }))}
            hint="Bestimmt die Punkte der Checkliste für die Vorbereitung."
          />
        </FormStep>
        <FormStep number={2} title="Geräte und Zubehör">
          <Field
            id="ausgabe-geraete"
            label={`Freie Geräte durchsuchen (${chosen.length} gewählt)`}
            hint="Nur Geräte ohne Stelle und Arbeitsplatz, die nicht verliehen oder reserviert sind."
            error={problemFor(problems, "ausgabe-geraete")}
            wide
          >
            {(control) => (
              <input
                {...control}
                type="search"
                value={query}
                placeholder="Name, Art, Seriennummer oder Inventurnummer"
                onChange={(event) => setQuery(event.target.value)}
              />
            )}
          </Field>
          {!devices && !error && <p role="status">Geräte werden geladen …</p>}
          {devices && devices.length === 0 && <p className="empty">Kein Gerät frei.</p>}
          {devices && devices.length > 0 && (
            <ul className="link-list issue-devices">
              {shown.slice(0, 50).map((device) => (
                <li key={device.id}>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      className="check"
                      checked={device.id in picked}
                      onChange={() => toggleDevice(device)}
                    />
                    <span>
                      {device.name} <span className="small">({device.kind})</span>
                      {device.serial && <span className="small mono"> · SN {device.serial}</span>}
                      {device.inventory_no && (
                        <span className="small mono"> · {device.inventory_no}</span>
                      )}
                    </span>
                  </label>
                  {device.id in picked && device.accessories.length > 0 && (
                    <fieldset className="issue-accessories">
                      <legend className="small">Zubehör für {device.name}</legend>
                      {device.accessories.map((name) => (
                        <label key={name} className="check-label">
                          <input
                            type="checkbox"
                            className="check"
                            checked={(picked[device.id] ?? []).includes(name)}
                            onChange={() => toggleAccessory(device.id, name)}
                          />
                          <span>{name}</span>
                        </label>
                      ))}
                    </fieldset>
                  )}
                </li>
              ))}
              {shown.length === 0 && <li className="small">Kein Gerät passt zur Suche.</li>}
              {shown.length > 50 && (
                <li className="small">Weitere {shown.length - 50} Geräte: Suche genauer.</li>
              )}
            </ul>
          )}
        </FormStep>
        <FormStep number={3} title="Zustand bei Übergabe">
          <ChoiceCards
            legend="Zustand"
            value={condition}
            onChange={setCondition}
            options={(Object.keys(CONDITION_LABELS) as IssueCondition[]).map((value) => ({
              value,
              label: CONDITION_LABELS[value],
            }))}
          />
          <Field label="Hinweis im Protokoll" hint="Freiwillig, z. B. „kleiner Kratzer am Deckel“.">
            {(control) => (
              <input
                {...control}
                type="text"
                maxLength={300}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            )}
          </Field>
          <label className="check-label">
            <input
              type="checkbox"
              className="check"
              checked={attachRules}
              onChange={(event) => setAttachRules(event.target.checked)}
            />
            <span>
              Nutzungsregeln anhängen <InfoTip term="bestand.nutzungsregeln" />
              <br />
              <span className="small">Die Person bestätigt sie mit der Übernahme.</span>
            </span>
          </label>
        </FormStep>
        <FormStep number={4} title="Bestätigung und Nachricht">
          <ChoiceCards
            legend="Wie bestätigt die Person?"
            value={method}
            onChange={setMethod}
            options={[
              {
                value: "unterschrift",
                label: "Unterschrift bei der IT",
                hint: "Die Person ist bei der Übergabe dabei.",
              },
              {
                value: "link",
                label: "Per Link in der Mail",
                hint: "Einmal-Link, 14 Tage gültig, ohne Anmeldung.",
              },
            ]}
          />
          <fieldset className="seg-field">
            <legend>Nachricht, wenn alles bereit ist</legend>
            <label className="check-label">
              <input type="checkbox" className="check" checked disabled />
              <span>Mail (immer)</span>
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                className="check"
                checked={notifyTeams}
                onChange={(event) => setNotifyTeams(event.target.checked)}
              />
              <span>Zusätzlich per Teams</span>
            </label>
          </fieldset>
        </FormStep>
        <ErrorText text={error} />
        <div className="project-actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            Anlegen und Vorbereitung starten
          </button>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => navigate(INVENTORY_ISSUES_PATH)}
          >
            Abbrechen
          </button>
        </div>
      </form>
    </section>
  );
}

/** Ablauf der Ausgabe als drei Stufen. */
function IssueSteps({ issue }: { issue: Issue }) {
  const steps = ["Vorbereitung", "Bereit zur Abholung", "Übergeben"];
  const current =
    issue.state === "vorbereitung"
      ? 0
      : issue.state === "bereit"
        ? 1
        : issue.state === "uebergeben"
          ? 3
          : -1;
  if (current < 0) {
    return null;
  }
  return (
    <ol className="issue-steps" aria-label="Ablauf der Ausgabe">
      {steps.map((label, index) => (
        <li
          key={label}
          className={index < current ? "is-done" : index === current ? "is-current" : undefined}
          aria-current={index === current ? "step" : undefined}
        >
          <span className="issue-step-number" aria-hidden="true">
            {index < current ? "✓" : index + 1}
          </span>
          {label}
        </li>
      ))}
    </ol>
  );
}

/** Eine Ausgabe: Vorbereitung, Abholung, Übergabe und Protokoll. */
function IssueDetail({
  issueId,
  canEdit,
  onChanged,
}: {
  issueId: number;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [issue, setIssue] = useState<Issue | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "status" | "alert"; text: string } | null>(null);
  const [task, setTask] = useState("");
  const [place, setPlace] = useState("");
  const [at, setAt] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [typed, setTyped] = useState(false);
  const [signedName, setSignedName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetchIssue(issueId).then(
      (result) => {
        if (active) {
          setIssue(result);
          setPlace(result.pickup_place);
          setAt(toLocalInput(result.pickup_at));
        }
      },
      (problem: unknown) =>
        active && setFailed(errorText(problem, "Die Ausgabe konnte nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, [issueId]);

  if (failed) {
    return <ErrorText text={failed} />;
  }
  if (!issue || issue.id !== issueId) {
    return <p role="status">Wird geladen …</p>;
  }

  const update = (next: Issue, text?: string) => {
    setIssue(next);
    setBusy(false);
    if (text) {
      setNotice({ kind: "status", text });
    }
    onChanged();
  };
  const fail = (problem: unknown) => {
    setNotice({ kind: "alert", text: errorText(problem, "Das hat nicht geklappt.") });
    setBusy(false);
  };
  const open = issue.task_list.filter((entry) => !entry.done).length;
  const editable = canEdit && issue.state === "vorbereitung";

  const onTask = (event: FormEvent) => {
    event.preventDefault();
    if (!task.trim()) {
      return;
    }
    setBusy(true);
    addIssueTask(issue.id, task.trim()).then((next) => {
      setTask("");
      update(next, "Der Punkt ist hinzugefügt.");
    }, fail);
  };

  const onPickup = (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setIssuePickup(issue.id, place.trim(), fromLocalInput(at)).then(
      (next) => update(next, "Die Abholung ist gespeichert."),
      fail,
    );
  };

  const onHandover = (event: FormEvent) => {
    event.preventDefault();
    if (typed ? !signedName.trim() : !signature) {
      setNotice({
        kind: "alert",
        text: typed
          ? "Bitte trag den Namen der Person ein."
          : "Bitte lass die Person unterschreiben.",
      });
      return;
    }
    setBusy(true);
    handOverIssue(
      issue.id,
      typed ? { signed_name: signedName.trim() } : { signature_png: signature ?? undefined },
    ).then((next) => update(next, "Übergeben. Die Geräte hängen jetzt an der Stelle."), fail);
  };

  return (
    <>
      <section className="panel" aria-labelledby="ausgabe-titel">
        <div className="panel-head case-head">
          <div>
            <p className="small">
              <span className="mono">{issue.number}</span> · {REASON_LABELS[issue.reason]} ·
              angelegt am {formatDateTime(issue.created_at)}
            </p>
            <h2 id="ausgabe-titel">{issue.person_name}</h2>
            <p className="small">
              <span className={`pill ${ISSUE_STATES[issue.state].pill}`}>
                {ISSUE_STATES[issue.state].label}
              </span>{" "}
              Stelle <Link to={positionPath(issue.position_id)}>{issue.position}</Link>
            </p>
          </div>
          {issue.state === "uebergeben" && (
            <button
              type="button"
              className="button button-secondary no-print"
              onClick={() => window.print()}
            >
              Protokoll drucken
            </button>
          )}
        </div>
        <div className="detail-body">
          <Feedback message={notice} onClose={() => setNotice(null)} />
          <IssueSteps issue={issue} />
          {!issue.has_address && issue.state !== "uebergeben" && (
            <p className="hint-box hint-warn">
              In Entra ist für diese Person keine Mailadresse eingetragen. Die Nachricht geht
              deshalb nicht raus.
            </p>
          )}
          <h3 className="sub-head">Geräte</h3>
          <ul className="link-list">
            {issue.entries.map((item) => (
              <li key={item.hardware_id}>
                <Link to={hardwarePath(item.hardware_id)}>{item.name}</Link>{" "}
                <span className="small">({item.kind})</span>
                {item.serial && <span className="small mono"> · SN {item.serial}</span>}
                {item.inventory_no && <span className="small mono"> · {item.inventory_no}</span>}
                {item.accessories.length > 0 && (
                  <span className="small"> · mit {item.accessories.join(", ")}</span>
                )}
              </li>
            ))}
          </ul>
          <dl className="facts">
            <div>
              <dt>Zustand</dt>
              <dd>
                {CONDITION_LABELS[issue.condition]}
                {issue.condition_note ? ` · ${issue.condition_note}` : ""}
              </dd>
            </div>
            <div>
              <dt>Bestätigung</dt>
              <dd>
                {issue.confirm_method === "link"
                  ? "per Link in der Mail"
                  : "Unterschrift bei der IT"}
              </dd>
            </div>
            <div>
              <dt>Nachricht</dt>
              <dd>{issue.notify_teams ? "Mail und Teams" : "Mail"}</dd>
            </div>
          </dl>
        </div>
      </section>

      {issue.state === "vorbereitung" && (
        <section className="panel" aria-labelledby="ausgabe-vorbereitung">
          <div className="panel-head">
            <h2 id="ausgabe-vorbereitung">
              Vorbereitung <InfoTip term="bestand.ausgabe-vorbereitung" />
            </h2>
            <span className="small">
              {issue.task_list.length - open} von {issue.task_list.length} erledigt
            </span>
          </div>
          <div className="detail-body form-stack">
            {issue.task_list.length === 0 ? (
              <p className="empty">
                Keine Punkte. Vorlagen pflegst du in den Stammdaten; hier kannst du Punkte ergänzen.
              </p>
            ) : (
              <ul className="issue-tasks">
                {issue.task_list.map((entry) => (
                  <li key={entry.id}>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        className="check"
                        checked={entry.done}
                        disabled={!editable || busy}
                        onChange={(event) => {
                          setBusy(true);
                          setIssueTask(issue.id, entry.id, event.target.checked).then(
                            (next) => update(next),
                            fail,
                          );
                        }}
                      />
                      <span className={entry.done ? "issue-task-done" : undefined}>
                        {entry.label}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {editable && (
              <form className="tool-row" onSubmit={onTask} noValidate>
                <Field label="Punkt hinzufügen">
                  {(control) => (
                    <input
                      {...control}
                      type="text"
                      maxLength={160}
                      value={task}
                      onChange={(event) => setTask(event.target.value)}
                    />
                  )}
                </Field>
                <button
                  type="submit"
                  className="button button-secondary"
                  disabled={busy || !task.trim()}
                >
                  Hinzufügen
                </button>
              </form>
            )}
            <h3 className="sub-head">Abholung</h3>
            <form className="form-grid" onSubmit={onPickup} noValidate>
              <Field
                label="Wo"
                hint="z. B. „IT, Raum 112“ oder „wir bringen es an den Arbeitsplatz“."
              >
                {(control) => (
                  <input
                    {...control}
                    type="text"
                    maxLength={120}
                    value={place}
                    disabled={!editable}
                    onChange={(event) => setPlace(event.target.value)}
                  />
                )}
              </Field>
              <Field label="Ab wann">
                {(control) => (
                  <input
                    {...control}
                    type="datetime-local"
                    value={at}
                    disabled={!editable}
                    onChange={(event) => setAt(event.target.value)}
                  />
                )}
              </Field>
              {editable && (
                <div className="project-actions field-wide">
                  <button type="submit" className="button button-secondary" disabled={busy}>
                    Abholung speichern
                  </button>
                </div>
              )}
            </form>
            {canEdit && (
              <div className="project-actions">
                <ConfirmButton
                  className="button button-primary"
                  disabled={busy || open > 0}
                  confirm={{
                    title: "Vorbereitung abschließen?",
                    text: `${issue.person_name} bekommt jetzt ${issue.notify_teams ? "eine Mail und eine Nachricht in Teams" : "eine Mail"}, dass die Geräte bereit sind${issue.confirm_method === "link" ? ", mit dem Link zum Bestätigen" : ""}. Die Checkliste lässt sich danach nicht mehr ändern.`,
                    action: "Abschließen und benachrichtigen",
                  }}
                  onConfirm={() =>
                    markIssueReady(issue.id).then(
                      (next) => update(next, "Die Vorbereitung ist abgeschlossen."),
                      fail,
                    )
                  }
                >
                  Vorbereitung abschließen und benachrichtigen
                </ConfirmButton>
                {open > 0 && (
                  <span className="small">
                    Noch {open} offen. Die Nachricht geht erst, wenn alles erledigt ist.
                  </span>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {issue.state === "bereit" && (
        <section className="panel" aria-labelledby="ausgabe-uebergabe">
          <div className="panel-head">
            <h2 id="ausgabe-uebergabe">Übergabe</h2>
          </div>
          <div className="detail-body form-stack">
            {(issue.pickup_place || issue.pickup_at) && (
              <p>
                Abholung: {issue.pickup_place || "–"}
                {issue.pickup_at ? `, ab ${formatDateTime(issue.pickup_at)}` : ""}
              </p>
            )}
            {issue.confirm_method === "link" && (
              <div className="hint-box">
                <p>
                  {issue.person_name} bestätigt den Empfang über den Link in der Mail
                  {issue.link_expires_at
                    ? ` (gültig bis ${formatDateTime(issue.link_expires_at)})`
                    : ""}
                  . Bis dahin steht die Ausgabe auf „Bereit zur Abholung“.
                </p>
                {canEdit && (
                  <ConfirmButton
                    className="button button-secondary"
                    disabled={busy}
                    confirm={{
                      title: "Neuen Link senden?",
                      text: "Der bisherige Link gilt dann nicht mehr. Die Person bekommt die Nachricht noch einmal.",
                      action: "Neuen Link senden",
                    }}
                    onConfirm={() =>
                      renewIssueLink(issue.id).then(
                        (next) => update(next, "Ein neuer Link ist unterwegs."),
                        fail,
                      )
                    }
                  >
                    Neuen Link senden
                  </ConfirmButton>
                )}
              </div>
            )}
            {canEdit && (
              <form className="form-stack" onSubmit={onHandover} noValidate>
                <p className="small">
                  {issue.confirm_method === "link"
                    ? "Ist die Person doch selbst da, kann sie auch hier unterschreiben."
                    : "Die Person unterschreibt hier auf dem Tablet oder Handy."}
                </p>
                {issue.rules_text && (
                  <details className="issue-rules">
                    <summary>Nutzungsregeln, die die Person bestätigt</summary>
                    <p className="pre-line">{issue.rules_text}</p>
                  </details>
                )}
                {typed ? (
                  <Field
                    label={`Name von ${issue.person_name}`}
                    hint="Statt Unterschrift: Die Person tippt ihren Namen ein."
                    required
                  >
                    {(control) => (
                      <input
                        {...control}
                        type="text"
                        maxLength={200}
                        value={signedName}
                        autoComplete="off"
                        onChange={(event) => setSignedName(event.target.value)}
                      />
                    )}
                  </Field>
                ) : (
                  <SignaturePad
                    label={`Unterschrift von ${issue.person_name}`}
                    onChange={setSignature}
                  />
                )}
                <button type="button" className="button-link" onClick={() => setTyped(!typed)}>
                  {typed ? "Doch unterschreiben" : "Name eintippen statt unterschreiben"}
                </button>
                <div className="project-actions">
                  <button type="submit" className="button button-primary" disabled={busy}>
                    Übergeben
                  </button>
                </div>
              </form>
            )}
          </div>
        </section>
      )}

      {issue.state === "uebergeben" && (
        <section className="panel issue-protocol" aria-labelledby="ausgabe-protokoll">
          <div className="panel-head">
            <h2 id="ausgabe-protokoll">Übergabeprotokoll</h2>
          </div>
          <div className="detail-body">
            <dl className="facts">
              <div>
                <dt>Nummer</dt>
                <dd className="mono">{issue.number}</dd>
              </div>
              <div>
                <dt>Person</dt>
                <dd>
                  {issue.person_name}{" "}
                  {issue.person_upn && <span className="small">({issue.person_upn})</span>}
                </dd>
              </div>
              <div>
                <dt>Stelle</dt>
                <dd>{issue.position}</dd>
              </div>
              <div>
                <dt>Übergeben am</dt>
                <dd>{formatDateTime(issue.handed_at)}</dd>
              </div>
              <div>
                <dt>Bestätigt</dt>
                <dd>
                  {issue.confirmed_via === "link"
                    ? "von der Person über den Einmal-Link"
                    : issue.has_signature
                      ? "mit Unterschrift"
                      : `mit getipptem Namen „${issue.signed_name}“`}
                </dd>
              </div>
            </dl>
            {issue.has_signature && (
              <img
                className="issue-signature"
                src={signatureUrl(issue.id)}
                alt={`Unterschrift von ${issue.person_name}`}
              />
            )}
            {issue.rules_text && (
              <>
                <h3 className="sub-head">Bestätigte Nutzungsregeln</h3>
                <p className="pre-line">{issue.rules_text}</p>
              </>
            )}
          </div>
        </section>
      )}

      {canEdit && (issue.state === "vorbereitung" || issue.state === "bereit") && (
        <div className="project-actions">
          <ConfirmButton
            className="button button-danger"
            disabled={busy}
            confirm={{
              title: "Ausgabe abbrechen?",
              text: "Die Geräte sind danach wieder frei. Ein Link in einer Mail gilt dann nicht mehr.",
              action: "Ausgabe abbrechen",
              danger: true,
            }}
            onConfirm={() =>
              cancelIssue(issue.id).then(
                (next) => update(next, "Die Ausgabe ist abgebrochen."),
                fail,
              )
            }
          >
            Ausgabe abbrechen
          </ConfirmButton>
        </div>
      )}

      {issue.messages.length > 0 && (
        <section className="panel no-print" aria-labelledby="ausgabe-nachrichten">
          <div className="panel-head">
            <h2 id="ausgabe-nachrichten">Nachrichten an die Person</h2>
          </div>
          <div className="detail-body">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Weg</th>
                    <th scope="col">Stand</th>
                    <th scope="col">Zeit</th>
                  </tr>
                </thead>
                <tbody>
                  {issue.messages.map((message, index) => (
                    <tr key={`${message.channel}-${index}`}>
                      <td>{message.channel === "mail" ? "Mail" : "Teams"}</td>
                      <td>{MESSAGE_LABELS[message.status]}</td>
                      <td>{formatDateTime(message.sent_at ?? message.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </>
  );
}

/** IT-Bestand › Ausgabe: laufende und erledigte Ausgaben, neue Ausgabe. */
export function IssuesPage({
  issueId,
  roles,
}: {
  issueId: number | "neu" | null;
  roles: readonly string[];
}) {
  const canEdit = roles.includes(INVENTORY_EDITOR_ROLE);
  const [filter, setFilter] = useState<IssueFilter>("laufend");
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState("");
  const query = useDebounced(search);
  const paged = usePagedList<IssueSummary, { preparing: number; ready: number }>(
    `${filter}|${query}`,
    reload,
    (offset, limit) =>
      fetchIssues(filter, query, offset, limit).then((result) => ({
        items: result.issues,
        total: result.total,
        extra: { preparing: result.preparing, ready: result.ready },
      })),
    "Die Ausgaben konnten nicht geladen werden.",
  );
  const issues = paged.items;
  const counts = paged.extra;

  return (
    <div className="page page-wide">
      <header className="page-head project-head">
        <div>
          <p className="module-label">IT-Bestand</p>
          <h1>Ausgabe</h1>
          <p className="page-sub">
            Geräte dauerhaft an eine Person übergeben: vorbereiten, benachrichtigen, bestätigen.
          </p>
        </div>
        {canEdit && (
          <button
            type="button"
            className="button button-primary"
            onClick={() => navigate(issuePath("neu"))}
          >
            Neue Ausgabe
          </button>
        )}
      </header>
      <ErrorText text={paged.error} />
      <div className={issueId === null ? "case-layout" : "case-layout case-layout-detail"}>
        <nav className="panel case-list no-print" aria-label="Ausgaben">
          <div className="case-filters">
            <FilterBar
              plain
              search={{
                label: "Suchen",
                value: search,
                placeholder: "Nummer, Person, Gerät, Seriennummer …",
                onChange: setSearch,
                hits: (issues ?? []).map((entry) => ({
                  key: entry.id,
                  title: entry.person_name,
                  extra: ISSUE_STATES[entry.state].label,
                  meta: entry.number,
                  href: issuePath(entry.id),
                })),
                total: paged.total,
              }}
              status={{
                label: "Status",
                value: filter,
                onChange: setFilter,
                options: ISSUE_FILTERS.map((entry) => ({
                  value: entry.id,
                  label: entry.label,
                  count:
                    entry.id === "vorbereitung" && counts
                      ? counts.preparing
                      : entry.id === "bereit" && counts
                        ? counts.ready
                        : entry.id === "laufend" && counts
                          ? counts.preparing + counts.ready
                          : null,
                })),
              }}
            />
          </div>
          <div className="case-scroll">
            {!issues && !paged.error && <p role="status">Wird geladen …</p>}
            {issues && issues.length === 0 && (
              <p className="empty">
                {query.trim()
                  ? "Keine Ausgabe passt zur Suche."
                  : "Keine Ausgaben in dieser Liste."}
              </p>
            )}
            {issues && issues.length > 0 && (
              <ul>
                {issues.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      className="case-item"
                      aria-current={entry.id === issueId ? "true" : undefined}
                      onClick={() => navigate(issuePath(entry.id))}
                    >
                      <span className="case-item-head">
                        <span className="mono">{entry.number}</span>
                        <span className={`pill ${ISSUE_STATES[entry.state].pill}`}>
                          {ISSUE_STATES[entry.state].label}
                        </span>
                      </span>
                      <strong>{entry.person_name}</strong>
                      <span className="small">
                        {entry.items === 1 ? "1 Gerät" : `${entry.items} Geräte`}
                        {entry.state === "vorbereitung" && entry.tasks > 0
                          ? ` · ${entry.tasks_done} von ${entry.tasks} erledigt`
                          : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {issues && (
              <MoreButton
                shown={issues.length}
                total={paged.total}
                loading={paged.loadingMore}
                onMore={paged.more}
              />
            )}
          </div>
        </nav>
        <div className="case-main">
          {issueId !== null && (
            <a
              className="case-back no-print"
              href={INVENTORY_ISSUES_PATH}
              onClick={(event) => {
                event.preventDefault();
                navigate(INVENTORY_ISSUES_PATH);
              }}
            >
              ‹ Zur Liste
            </a>
          )}
          {issueId === "neu" && canEdit ? (
            <NewIssueForm
              onCreated={(issue) => {
                setReload(reload + 1);
                navigate(issuePath(issue.id));
              }}
            />
          ) : issueId === null || issueId === "neu" ? (
            <p className="panel panel-empty">Wähle links eine Ausgabe.</p>
          ) : (
            <IssueDetail
              key={issueId}
              issueId={issueId}
              canEdit={canEdit}
              onChanged={() => setReload(reload + 1)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
