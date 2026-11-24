import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { errorText } from "../../api";
import { useConfirm } from "../../components/ConfirmDialog";
import { Feedback, type FeedbackMessage } from "../../components/Feedback";
import { InfoTip } from "../../components/InfoTip";
import { Link } from "../../components/Link";
import type { HelpKey } from "../../help/terms";
import { TICKETS_SETTINGS_PATH } from "../../navigation";
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
  IntakeSection,
  MailSettingsSection,
  ReviewSection,
} from "./TicketMailSettings";
import {
  CategoriesSection,
  SolutionTypesSection,
  RetentionDefaultSection,
  RetentionSection,
  TemplatesSection,
  WorkSection,
} from "./TicketWorkSettings";
import { AuditLog, RolesOverview } from "./TicketsRoles";
import { TICKET_ACCESS_CHANGED } from "./useTicketAccess";

const ROLES: AreaRole[] = ["admin", "edit"];

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
      </div>
    </section>
  );
}

/** Rollen eines Bereichs: je Rolle die Einträge mit „Entziehen“, darunter „Rolle vergeben“. */
function AreaRoles({
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
  const headingId = useId();
  return (
    <section className="panel ticket-area" aria-labelledby={headingId}>
      <div className="panel-head">
        <h2 id={headingId}>Rollen im Bereich „{area.name}“</h2>
        <InfoTip term="tickets.rollen" />
      </div>
      <div className="detail-body settings-form">
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

export const SETTINGS_TABS = [
  { id: "bereiche", label: "Bereiche" },
  { id: "kategorien", label: "Kategorien, Lösungen und Fristen" },
  { id: "email", label: "E-Mail-Eingang" },
  { id: "textbausteine", label: "Textbausteine" },
  { id: "aufbewahrung", label: "Aufbewahrung" },
  { id: "rollen", label: "Rollen" },
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number]["id"];

/** Reiter aus dem Pfad: `/tickets/einstellungen` → Bereiche, `/tickets/einstellungen/email` → … */
export function parseSettingsPath(path: string): SettingsTab | null {
  if (path === TICKETS_SETTINGS_PATH) {
    return "bereiche";
  }
  const rest = path.startsWith(`${TICKETS_SETTINGS_PATH}/`)
    ? path.slice(TICKETS_SETTINGS_PATH.length + 1)
    : null;
  return SETTINGS_TABS.find((t) => t.id === rest)?.id ?? null;
}

export function settingsPath(tab: SettingsTab, area: number | null = null): string {
  const base = tab === "bereiche" ? TICKETS_SETTINGS_PATH : `${TICKETS_SETTINGS_PATH}/${tab}`;
  return area === null ? base : `${base}?bereich=${area}`;
}

/** Reiter, die je Bereich gelten (mit Auswahl des Bereichs). */
const AREA_TABS: readonly SettingsTab[] = [
  "kategorien",
  "email",
  "textbausteine",
  "aufbewahrung",
  "rollen",
];

function areaFromUrl(): number | null {
  const value = Number(new URLSearchParams(window.location.search).get("bereich"));
  return Number.isInteger(value) && value > 0 ? value : null;
}

export function TicketSettingsPage({ tab }: { tab: SettingsTab }) {
  const [data, setData] = useState<TicketSettings | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [message, setMessage] = useState<FeedbackMessage | null>(null);
  const [wanted, setWanted] = useState<number | null>(() => areaFromUrl());
  const areaSelectId = useId();

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

  const tabs = SETTINGS_TABS;
  const current = tabs.some((t) => t.id === tab) ? tab : "bereiche";
  const area = data?.areas.find((a) => a.id === wanted) ?? data?.areas[0] ?? null;
  const perArea = AREA_TABS.includes(current);

  const chooseArea = (id: number) => {
    setWanted(id);
    // Bereich in der Adresse merken (ohne neuen Eintrag im Verlauf)
    window.history.replaceState(null, "", settingsPath(current, id));
  };

  return (
    <div className="page page-wide">
      <header className="page-head">
        <div>
          <p className="module-label">Tickets</p>
          <h1>Einstellungen</h1>
          <p className="page-sub">
            Bereiche, Kategorien, Lösungen und Fristen, E-Mail, Textbausteine, Aufbewahrung und
            Rollen.
          </p>
        </div>
      </header>
      <nav className="project-tabs" aria-label="Einstellungen der Tickets">
        {tabs.map((t) => (
          <Link
            key={t.id}
            to={settingsPath(t.id, AREA_TABS.includes(t.id) && area ? area.id : null)}
            className={t.id === current ? "project-tab project-tab-on" : "project-tab"}
            aria-current={t.id === current ? "page" : undefined}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {failed && (
        <p role="alert" className="hint-box hint-bad">
          {failed}
        </p>
      )}
      {!failed && !data && <p role="status">Wird geladen …</p>}

      {data && perArea && data.areas.length === 0 && (
        <p className="panel panel-empty">
          Es gibt noch keinen Bereich.
          {data.manager ? " Leg ihn unter „Bereiche“ an." : ""}
        </p>
      )}
      {data && perArea && area && data.areas.length > 1 && (
        <section className="panel stat-filters" aria-label="Bereich wählen">
          <label htmlFor={areaSelectId} className="filter-field">
            Bereich
            <select
              id={areaSelectId}
              value={area.id}
              onChange={(event) => chooseArea(Number(event.target.value))}
            >
              {data.areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.active ? "" : " (inaktiv)"}
                </option>
              ))}
            </select>
          </label>
        </section>
      )}

      {data && current === "bereiche" && (
        <>
          {data.manager && <NewAreaForm onCreated={replace} onMessage={setMessage} />}
          {data.areas.length === 0 && (
            <p className="panel panel-empty">
              Es gibt noch keinen Bereich.{data.manager ? " Lege oben den ersten an." : ""}
            </p>
          )}
          {data.areas.map((a) => (
            <AreaPanel
              key={a.id}
              area={a}
              manager={data.manager}
              onSaved={replace}
              onMessage={setMessage}
            />
          ))}
        </>
      )}
      {data && area && current === "kategorien" && (
        <div key={area.id}>
          <SettingsPanel title="Kategorien" term="tickets.kategorie">
            <CategoriesSection areaId={area.id} onMessage={setMessage} />
          </SettingsPanel>
          <SettingsPanel title="Lösungsarten" term="tickets.loesung">
            <SolutionTypesSection areaId={area.id} onMessage={setMessage} />
          </SettingsPanel>
          <SettingsPanel title="Fristen" term="tickets.frist">
            <WorkSection areaId={area.id} onMessage={setMessage} />
          </SettingsPanel>
        </div>
      )}
      {data && area && current === "email" && (
        <div key={area.id}>
          <SettingsPanel title="Postfach und Mails an den Melder">
            <MailSettingsSection areaId={area.id} onMessage={setMessage} />
          </SettingsPanel>
          <SettingsPanel title="Zu prüfen" id="pruefen">
            <ReviewSection areaId={area.id} onMessage={setMessage} />
          </SettingsPanel>
          <SettingsPanel title="Sperrliste">
            <BlocksSection areaId={area.id} onMessage={setMessage} />
          </SettingsPanel>
          <SettingsPanel title="Letzte Eingänge">
            <IntakeSection areaId={area.id} />
          </SettingsPanel>
        </div>
      )}
      {data && area && current === "textbausteine" && (
        <SettingsPanel key={area.id} title="Textbausteine" term="tickets.textbausteine">
          <TemplatesSection areaId={area.id} onMessage={setMessage} />
        </SettingsPanel>
      )}
      {data && current === "aufbewahrung" && (
        <>
          {data.manager && <RetentionDefaultSection onMessage={setMessage} />}
          {area && (
            <SettingsPanel
              key={area.id}
              title={`Aufbewahrung im Bereich „${area.name}“`}
              term="tickets.aufbewahrung"
            >
              <RetentionSection areaId={area.id} onMessage={setMessage} />
            </SettingsPanel>
          )}
        </>
      )}
      {data && current === "rollen" && (
        <>
          {area && (
            <AreaRoles
              key={area.id}
              area={area}
              manager={data.manager}
              onSaved={replace}
              onMessage={setMessage}
            />
          )}
          <RolesOverview settings={data} />
          <AuditLog areas={data.areas} />
        </>
      )}
      <Feedback message={message} onClose={() => setMessage(null)} />
    </div>
  );
}

/** Abschnitt einer Einstellungsseite mit Überschrift. */
function SettingsPanel({
  title,
  term,
  id,
  children,
}: {
  title: string;
  term?: HelpKey;
  id?: string;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section className="panel" aria-labelledby={headingId} id={id}>
      <div className="panel-head">
        <h2 id={headingId}>{title}</h2>
        {term && <InfoTip term={term} />}
      </div>
      <div className="detail-body">{children}</div>
    </section>
  );
}
