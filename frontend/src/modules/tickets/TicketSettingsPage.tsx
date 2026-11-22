import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { errorText } from "../../api";
import { useConfirm } from "../../components/ConfirmDialog";
import { Feedback, type FeedbackMessage } from "../../components/Feedback";
import { InfoTip } from "../../components/InfoTip";
import {
  addGrant,
  createArea,
  fetchTicketSettings,
  removeGrant,
  ROLE_LABELS,
  searchEntra,
  updateArea,
  updateAssignment,
  type AreaRole,
  type AreaSettings,
  type Found,
  type GrantInput,
  type TicketSettings,
} from "./api";
import {
  BlocksSection,
  DesignSection,
  IntakeSection,
  MailSettingsSection,
  ReviewSection,
} from "./TicketMailSettings";
import { TICKET_ACCESS_CHANGED } from "./useTicketAccess";

/** Aufklappbarer Abschnitt; der Inhalt lädt erst beim ersten Öffnen. */
function LazySection({ title, children }: { title: string; children: () => ReactNode }) {
  const [opened, setOpened] = useState(false);
  return (
    <details
      className="ticket-mail-section"
      onToggle={(event) => {
        if (event.currentTarget.open) {
          setOpened(true);
        }
      }}
    >
      <summary>{title}</summary>
      {opened && children()}
    </details>
  );
}

const ROLES: AreaRole[] = ["admin", "edit", "read"];

/** Gruppe oder Person aus Entra suchen und wählen. */
function EntraPicker({
  kind,
  onPick,
}: {
  kind: "group" | "person";
  onPick: (found: Found) => void;
}) {
  const inputId = useId();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{ query: string; hits: Found[] } | null>(null);
  const [failed, setFailed] = useState<{ query: string; text: string } | null>(null);
  const term = query.trim();

  useEffect(() => {
    if (term.length < 2) {
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      searchEntra(kind, term).then(
        (hits) => active && setResult({ query: term, hits }),
        (problem: unknown) =>
          active &&
          setFailed({
            query: term,
            text: errorText(problem, "Die Suche in Entra hat nicht geklappt."),
          }),
      );
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [term, kind]);

  const hits = result && result.query === term ? result.hits : null;
  const error = failed && failed.query === term ? failed.text : null;
  return (
    <div className="picker">
      <label htmlFor={inputId} className="picker-label">
        {kind === "group" ? "Gruppe in Entra suchen" : "Person in Entra suchen"}
      </label>
      <input
        id={inputId}
        type="search"
        value={query}
        maxLength={60}
        autoComplete="off"
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="picker-hits" aria-live="polite">
        {term.length >= 2 && hits === null && error === null && (
          <p className="small">Suche in Entra …</p>
        )}
        {error && (
          <p role="alert" className="hint-box hint-bad">
            {error}
          </p>
        )}
        {hits && hits.length === 0 && <p className="small">Nichts gefunden.</p>}
        {hits && hits.length > 0 && (
          <ul aria-label={kind === "group" ? "Gruppen aus Entra" : "Personen aus Entra"}>
            {hits.map((hit) => (
              <li key={hit.oid}>
                <button
                  type="button"
                  className="picker-hit"
                  onClick={() => {
                    onPick(hit);
                    setQuery("");
                  }}
                >
                  <strong>{hit.name}</strong>
                  {(hit.mail || hit.detail) && (
                    <span className="small">
                      {[hit.mail, hit.detail].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function GrantForm({
  area,
  manager,
  onSaved,
  onMessage,
}: {
  area: AreaSettings;
  manager: boolean;
  onSaved: (area: AreaSettings) => void;
  onMessage: (message: FeedbackMessage) => void;
}) {
  const roleId = useId();
  const [role, setRole] = useState<AreaRole>("edit");
  const [kind, setKind] = useState<"group" | "person">("group");
  const kindName = useId();
  const add = (found: Found) => {
    const body: GrantInput = {
      role,
      kind,
      oid: found.oid,
      name: found.name,
      mail: kind === "person" ? found.mail : "",
    };
    addGrant(area.id, body)
      .then((result) => {
        onSaved(result);
        onMessage({ kind: "status", text: `${found.name}: ${ROLE_LABELS[role]} vergeben.` });
      })
      .catch((problem: unknown) =>
        onMessage({
          kind: "alert",
          text: errorText(problem, "Die Rolle konnte nicht vergeben werden."),
        }),
      );
  };
  return (
    <div className="ticket-grant-form">
      <h4>Rolle vergeben</h4>
      <div className="form-grid">
        <label htmlFor={roleId}>
          Rolle
          <select
            id={roleId}
            value={role}
            onChange={(event) => setRole(event.target.value as AreaRole)}
          >
            {ROLES.filter((r) => manager || r !== "admin").map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="ticket-kind">
          <legend>Für</legend>
          <label className="check-label">
            <input
              type="radio"
              name={kindName}
              checked={kind === "group"}
              onChange={() => setKind("group")}
            />
            Gruppe aus Entra
          </label>
          <label className="check-label">
            <input
              type="radio"
              name={kindName}
              checked={kind === "person"}
              onChange={() => setKind("person")}
            />
            Einzelne Person
          </label>
        </fieldset>
      </div>
      <EntraPicker key={kind} kind={kind} onPick={add} />
    </div>
  );
}

function AreaPanel({
  area,
  manager,
  onSaved,
  onMessage,
}: {
  area: AreaSettings;
  manager: boolean;
  onSaved: (area: AreaSettings) => void;
  onMessage: (message: FeedbackMessage) => void;
}) {
  const [ask, dialog] = useConfirm();
  const [name, setName] = useState(area.name);
  const [mailbox, setMailbox] = useState(area.mailbox);
  const [active, setActive] = useState(area.active);
  const headingId = useId();
  const assignmentId = useId();
  const changed = name !== area.name || mailbox !== area.mailbox || active !== area.active;

  const saveArea = (event: FormEvent) => {
    event.preventDefault();
    updateArea(area.id, { name, mailbox, active })
      .then((result) => {
        onSaved(result);
        onMessage({ kind: "status", text: "Der Bereich wurde gespeichert." });
      })
      .catch((problem: unknown) =>
        onMessage({
          kind: "alert",
          text: errorText(problem, "Der Bereich konnte nicht gespeichert werden."),
        }),
      );
  };

  const changeAssignment = (assignment: "first" | "round_robin") =>
    updateAssignment(area.id, assignment)
      .then((result) => {
        onSaved(result);
        onMessage({ kind: "status", text: "Die Zuweisung wurde gespeichert." });
      })
      .catch((problem: unknown) =>
        onMessage({
          kind: "alert",
          text: errorText(problem, "Die Zuweisung konnte nicht gespeichert werden."),
        }),
      );

  return (
    <section className="panel ticket-area" aria-labelledby={headingId}>
      <div className="panel-head">
        <h2 id={headingId}>
          {area.name}
          {!area.active && <span className="pill pill-neutral">inaktiv</span>}
        </h2>
      </div>
      <div className="detail-body settings-form">
        {manager && (
          <form onSubmit={saveArea} className="form-grid">
            <label>
              Name
              <input
                required
                maxLength={80}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              Postfach des Bereichs
              <input
                type="email"
                maxLength={320}
                placeholder="bereich@example.com"
                value={mailbox}
                onChange={(event) => setMailbox(event.target.value)}
              />
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={active}
                onChange={(event) => setActive(event.target.checked)}
              />
              Bereich aktiv
            </label>
            <div className="actions">
              <button type="submit" className="button button-primary" disabled={!changed}>
                Speichern
              </button>
            </div>
          </form>
        )}
        {!manager && area.mailbox && (
          <p>
            Postfach: <span className="mono">{area.mailbox}</span>
          </p>
        )}
        <label htmlFor={assignmentId} className="narrow-auto">
          <span>
            Zuweisung neuer Tickets
            <InfoTip term="tickets.zuweisung" />
          </span>
          <select
            id={assignmentId}
            value={area.assignment}
            onChange={(event) =>
              void changeAssignment(event.target.value as "first" | "round_robin")
            }
          >
            <option value="first">Wer zuerst übernimmt</option>
            <option value="round_robin">Reihum</option>
          </select>
        </label>
        <h3>
          Rollen
          <InfoTip term="tickets.rollen" />
        </h3>
        {ROLES.map((role) => {
          const grants = area.grants.filter((g) => g.role === role);
          return (
            <div key={role} className="ticket-role">
              <h4>{ROLE_LABELS[role]}</h4>
              {grants.length === 0 ? (
                <p className="small">Niemand</p>
              ) : (
                <ul className="plain ticket-grants">
                  {grants.map((grant) => (
                    <li key={grant.id}>
                      <span>
                        <strong>{grant.name}</strong>{" "}
                        <span className="small">
                          {grant.kind === "group"
                            ? `Gruppe${grant.members !== null ? ` · ${grant.members} Mitglieder laut letztem Abgleich` : ""}`
                            : grant.mail || "Person"}
                        </span>
                      </span>
                      {(manager || role !== "admin") && (
                        <button
                          type="button"
                          className="row-button"
                          aria-label={`${ROLE_LABELS[role]} für ${grant.name} entziehen`}
                          onClick={() =>
                            ask(
                              {
                                title: `${ROLE_LABELS[role]} entziehen?`,
                                text: `${grant.name} verliert diese Rolle im Bereich „${area.name}“. Wer nur darüber Zugriff hatte, sieht die Tickets nach wenigen Minuten nicht mehr.`,
                                action: "Entziehen",
                              },
                              () =>
                                removeGrant(area.id, grant.id)
                                  .then((result) => {
                                    onSaved(result);
                                    onMessage({
                                      kind: "status",
                                      text: "Die Rolle wurde entzogen.",
                                    });
                                  })
                                  .catch((problem: unknown) =>
                                    onMessage({
                                      kind: "alert",
                                      text: errorText(
                                        problem,
                                        "Die Rolle konnte nicht entzogen werden.",
                                      ),
                                    }),
                                  ),
                            )
                          }
                        >
                          Entziehen
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        <GrantForm area={area} manager={manager} onSaved={onSaved} onMessage={onMessage} />
        <LazySection title="E-Mail-Eingang und Mails an den Melder">
          {() => <MailSettingsSection areaId={area.id} onMessage={onMessage} />}
        </LazySection>
        <LazySection title="Zu prüfen">
          {() => <ReviewSection areaId={area.id} onMessage={onMessage} />}
        </LazySection>
        <LazySection title="Sperrliste">
          {() => <BlocksSection areaId={area.id} onMessage={onMessage} />}
        </LazySection>
        <LazySection title="Letzte Eingänge">
          {() => <IntakeSection areaId={area.id} />}
        </LazySection>
      </div>
      {dialog}
    </section>
  );
}

function NewAreaForm({
  onCreated,
  onMessage,
}: {
  onCreated: (area: AreaSettings) => void;
  onMessage: (message: FeedbackMessage) => void;
}) {
  const [name, setName] = useState("");
  const [mailbox, setMailbox] = useState("");
  const [kind, setKind] = useState<"group" | "person">("group");
  const [admin, setAdmin] = useState<Found | null>(null);
  const kindName = useId();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!admin) {
      onMessage({ kind: "alert", text: "Bitte wähle, wer den Bereich verwaltet." });
      return;
    }
    createArea({
      name,
      mailbox,
      admin: {
        role: "admin",
        kind,
        oid: admin.oid,
        name: admin.name,
        mail: kind === "person" ? admin.mail : "",
      },
    })
      .then((area) => {
        onCreated(area);
        setName("");
        setMailbox("");
        setAdmin(null);
        onMessage({ kind: "status", text: `Der Bereich „${area.name}“ wurde angelegt.` });
      })
      .catch((problem: unknown) =>
        onMessage({
          kind: "alert",
          text: errorText(problem, "Der Bereich konnte nicht angelegt werden."),
        }),
      );
  };
  return (
    <details className="panel ticket-new-area">
      <summary>Neuen Bereich anlegen</summary>
      <form className="detail-body settings-form" onSubmit={submit}>
        <div className="form-grid">
          <label>
            Name
            <input
              required
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            Postfach (freiwillig)
            <input
              type="email"
              maxLength={320}
              placeholder="bereich@example.com"
              value={mailbox}
              onChange={(event) => setMailbox(event.target.value)}
            />
          </label>
        </div>
        <fieldset className="ticket-kind">
          <legend>Bereichsverwaltung</legend>
          <label className="check-label">
            <input
              type="radio"
              name={kindName}
              checked={kind === "group"}
              onChange={() => {
                setKind("group");
                setAdmin(null);
              }}
            />
            Gruppe aus Entra
          </label>
          <label className="check-label">
            <input
              type="radio"
              name={kindName}
              checked={kind === "person"}
              onChange={() => {
                setKind("person");
                setAdmin(null);
              }}
            />
            Einzelne Person
          </label>
        </fieldset>
        {admin ? (
          <p>
            Gewählt: <strong>{admin.name}</strong>{" "}
            <button type="button" className="row-button" onClick={() => setAdmin(null)}>
              Ändern
            </button>
          </p>
        ) : (
          <EntraPicker key={kind} kind={kind} onPick={setAdmin} />
        )}
        <div className="actions">
          <button type="submit" className="button button-primary">
            Bereich anlegen
          </button>
        </div>
      </form>
    </details>
  );
}

export function TicketSettingsPage() {
  const [data, setData] = useState<TicketSettings | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [message, setMessage] = useState<FeedbackMessage | null>(null);

  useEffect(() => {
    let active = true;
    fetchTicketSettings().then(
      (result) => active && setData(result),
      (problem: unknown) =>
        active && setFailed(errorText(problem, "Die Einstellungen konnten nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, []);

  const replace = (area: AreaSettings) => {
    setData((current) =>
      current
        ? {
            ...current,
            areas: current.areas.some((a) => a.id === area.id)
              ? current.areas.map((a) => (a.id === area.id ? area : a))
              : [...current.areas, area].sort((a, b) => a.name.localeCompare(b.name, "de")),
          }
        : current,
    );
    window.dispatchEvent(new Event(TICKET_ACCESS_CHANGED));
  };

  return (
    <div className="page page-wide">
      <header className="page-head">
        <div>
          <p className="module-label">Tickets</p>
          <h1>Einstellungen</h1>
          <p className="page-sub">
            Bereiche und wer darin welche Rolle hat. Jeder Bereich braucht mindestens eine
            Bereichsverwaltung.
          </p>
        </div>
      </header>
      {failed && (
        <p role="alert" className="hint-box hint-bad">
          {failed}
        </p>
      )}
      {!failed && !data && <p role="status">Wird geladen …</p>}
      {data?.manager && <NewAreaForm onCreated={replace} onMessage={setMessage} />}
      {data?.manager && <DesignSection onMessage={setMessage} />}
      {data && data.areas.length === 0 && (
        <p className="panel panel-empty">
          Es gibt noch keinen Bereich.{data.manager ? " Lege oben den ersten an." : ""}
        </p>
      )}
      {data?.areas.map((area) => (
        <AreaPanel
          key={area.id}
          area={area}
          manager={data.manager}
          onSaved={replace}
          onMessage={setMessage}
        />
      ))}
      <Feedback message={message} onClose={() => setMessage(null)} />
    </div>
  );
}
