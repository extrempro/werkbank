import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { errorText } from "../../api";
import { useConfirm } from "../../components/ConfirmDialog";
import { ColorChoice } from "../../components/ColorChoice";
import { Feedback, type FeedbackMessage } from "../../components/Feedback";
import { InfoTip } from "../../components/InfoTip";
import { Link } from "../../components/Link";
import { ListChoice } from "../../components/ListChoice";
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
import { AREA_COLOR_LABELS, AREA_COLORS, areaColorClass, type AreaColor } from "./areaColors";
import { AreaTag } from "./AreaTag";
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
  const [color, setColor] = useState<AreaColor>(
    AREA_COLORS.find((c) => c === area.color) ?? "grau",
  );
  const headingId = useId();
  const assignmentId = useId();
  const changed =
    name !== area.name ||
    mailbox !== area.mailbox ||
    active !== area.active ||
    color !== area.color;

  const saveArea = (event: FormEvent) => {
    event.preventDefault();
    updateArea(area.id, { name, mailbox, active, color })
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
          <AreaTag name={area.name} color={area.color} />
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
            <ColorChoice
              legend="Farbe in Listen"
              value={color}
              options={AREA_COLORS.map((c) => ({
                value: c,
                label: AREA_COLOR_LABELS[c],
                className: areaColorClass(c),
              }))}
              onChange={setColor}
              hint={
                <>
                  Markiert Tickets dieses Bereichs in der Liste; der Name steht immer daneben.
                  <InfoTip term="tickets.bereichsfarbe" />
                </>
              }
            />
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
                Bereich speichern
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

/** Vier Reiter je Bereich, dazu „Bereiche verwalten“ (alle Bereiche, Vorgaben, Rechte). */
export const SETTINGS_TABS = [
  { id: "allgemein", label: "Allgemein" },
  { id: "email", label: "E-Mail" },
  { id: "arbeit", label: "Arbeit" },
  { id: "pflege", label: "Pflege" },
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number]["id"] | "bereiche";

// Reiter bis 0.148, damit alte Links und Lesezeichen weiter passen
const OLD_TABS: Record<string, SettingsTab> = {
  kategorien: "arbeit",
  textbausteine: "arbeit",
  aufbewahrung: "pflege",
  rollen: "allgemein",
};

/** Reiter aus dem Pfad: `/tickets/einstellungen` → Allgemein, `/tickets/einstellungen/email` → … */
export function parseSettingsPath(path: string): SettingsTab | null {
  if (path === TICKETS_SETTINGS_PATH) {
    return "allgemein";
  }
  const rest = path.startsWith(`${TICKETS_SETTINGS_PATH}/`)
    ? path.slice(TICKETS_SETTINGS_PATH.length + 1)
    : null;
  if (rest === "bereiche") {
    return "bereiche";
  }
  return SETTINGS_TABS.find((t) => t.id === rest)?.id ?? (rest ? (OLD_TABS[rest] ?? null) : null);
}

export function settingsPath(tab: SettingsTab, area: number | null = null): string {
  const base = tab === "allgemein" ? TICKETS_SETTINGS_PATH : `${TICKETS_SETTINGS_PATH}/${tab}`;
  return area === null ? base : `${base}?bereich=${area}`;
}

function areaFromUrl(): number | null {
  const value = Number(new URLSearchParams(window.location.search).get("bereich"));
  return Number.isInteger(value) && value > 0 ? value : null;
}

/** Abschnitt eines Reiters: Nummer, Überschrift und ein Satz Erklärung. */
function SettingsStep({
  number,
  title,
  hint,
  term,
  id,
  children,
}: {
  number: number;
  title: string;
  hint?: string;
  term?: HelpKey;
  id?: string;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section className="panel settings-step" aria-labelledby={headingId} id={id}>
      <div className="panel-head">
        <h2 id={headingId}>
          <span className="form-step-number" aria-hidden="true">
            {number}
          </span>
          {title}
        </h2>
        {term && <InfoTip term={term} />}
      </div>
      <div className="detail-body">
        {hint && <p className="settings-step-hint">{hint}</p>}
        {children}
      </div>
    </section>
  );
}

export function TicketSettingsPage({ tab }: { tab: SettingsTab }) {
  const [data, setData] = useState<TicketSettings | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [message, setMessage] = useState<FeedbackMessage | null>(null);
  const [wanted, setWanted] = useState<number | null>(() => areaFromUrl());

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

  const current = tab;
  const area = data?.areas.find((a) => a.id === wanted) ?? data?.areas[0] ?? null;
  const perArea = current !== "bereiche";

  // Alte Reiter (bis 0.148) auf die neue Adresse umschreiben, ohne Eintrag im Verlauf
  useEffect(() => {
    const wantedPath = settingsPath(current, areaFromUrl());
    if (`${window.location.pathname}${window.location.search}` !== wantedPath) {
      window.history.replaceState(null, "", wantedPath);
    }
  }, [current]);

  const chooseArea = (id: number) => {
    setWanted(id);
    // Bereich in der Adresse merken (ohne neuen Eintrag im Verlauf)
    window.history.replaceState(null, "", settingsPath(current, id));
  };

  return (
    <div className="page page-wide ticket-settings">
      <header className="page-head">
        <div>
          <p className="module-label">Tickets</p>
          <h1>{current === "bereiche" ? "Bereiche verwalten" : "Einstellungen"}</h1>
          <p className="page-sub">
            {current === "bereiche"
              ? "Alle Bereiche, Vorgaben für neue Bereiche und wer welche Rechte hat."
              : "Wähle den Bereich, dann den Reiter. Was du änderst, speicherst du im jeweiligen Abschnitt."}
          </p>
        </div>
      </header>
      {failed && (
        <p role="alert" className="hint-box hint-bad">
          {failed}
        </p>
      )}
      {!failed && !data && <p role="status">Wird geladen …</p>}

      {data && perArea && data.areas.length === 0 && (
        <p className="panel panel-empty">
          Es gibt noch keinen Bereich.
          {data.manager ? " Leg ihn unter „Bereiche verwalten“ an." : ""}
        </p>
      )}
      {data && perArea && area && (
        <div className="ticket-settings-area">
          {data.areas.length > 1 && (
            <ListChoice
              label="Bereich"
              unit="Bereiche"
              value={String(area.id)}
              onChange={(value) => chooseArea(Number(value))}
              options={data.areas.map((a) => ({
                id: a.id,
                label: a.active ? a.name : `${a.name} (inaktiv)`,
                detail: a.mailbox || "ohne Postfach",
              }))}
            />
          )}
          <p className="small">
            <Link to={settingsPath("bereiche")}>
              {data.manager ? "Bereiche verwalten" : "Alle Bereiche und Rechte"}
            </Link>
          </p>
        </div>
      )}
      {data && current === "bereiche" && (
        <p className="small">
          <Link to={settingsPath("allgemein", area?.id ?? null)}>
            ‹ Zurück zu den Einstellungen
          </Link>
        </p>
      )}
      {data && perArea && area && (
        <nav className="project-tabs" aria-label="Einstellungen des Bereichs">
          {SETTINGS_TABS.map((t) => (
            <Link
              key={t.id}
              to={settingsPath(t.id, area.id)}
              className={t.id === current ? "project-tab project-tab-on" : "project-tab"}
              aria-current={t.id === current ? "page" : undefined}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      )}

      {data && current === "bereiche" && (
        <>
          {data.manager && <NewAreaForm onCreated={replace} onMessage={setMessage} />}
          {data.areas.map((a) => (
            <AreaPanel
              key={a.id}
              area={a}
              manager={data.manager}
              onSaved={replace}
              onMessage={setMessage}
            />
          ))}
          {data.manager && <RetentionDefaultSection onMessage={setMessage} />}
          <RolesOverview settings={data} />
          <AuditLog areas={data.areas} />
        </>
      )}
      {data && area && current === "allgemein" && (
        <div key={area.id} className="ticket-settings-steps">
          <AreaPanel area={area} manager={data.manager} onSaved={replace} onMessage={setMessage} />
          <AreaRoles area={area} manager={data.manager} onSaved={replace} onMessage={setMessage} />
        </div>
      )}
      {data && area && current === "email" && (
        <div key={area.id} className="ticket-settings-steps">
          <MailSettingsSection areaId={area.id} part="email" onMessage={setMessage} />
        </div>
      )}
      {data && area && current === "arbeit" && (
        <div key={area.id} className="ticket-settings-steps">
          <SettingsStep
            number={1}
            title="Kategorien"
            term="tickets.kategorie"
            hint="Schlagen beim Anlegen eine Priorität vor. Abgeschaltete bleiben an alten Tickets stehen."
          >
            <CategoriesSection areaId={area.id} onMessage={setMessage} />
          </SettingsStep>
          <SettingsStep
            number={2}
            title="Lösungsarten"
            term="tickets.loesung"
            hint="Wählt man beim Wechsel auf „Gelöst“."
          >
            <SolutionTypesSection areaId={area.id} onMessage={setMessage} />
          </SettingsStep>
          <SettingsStep
            number={3}
            title="Fristen"
            term="tickets.frist"
            hint="Ohne Fristen erscheint im Bereich nirgends eine Frist."
          >
            <WorkSection areaId={area.id} onMessage={setMessage} />
          </SettingsStep>
          <SettingsStep
            number={4}
            title="Textbausteine"
            term="tickets.textbausteine"
            hint="Mit /kürzel in Antworten und Notizen."
          >
            <TemplatesSection areaId={area.id} onMessage={setMessage} />
          </SettingsStep>
        </div>
      )}
      {data && area && current === "pflege" && (
        <div key={area.id} className="ticket-settings-steps">
          <SettingsStep
            number={1}
            title="Zu prüfen"
            id="pruefen"
            hint="Mails von unbekannten Absendern: annehmen oder verwerfen."
          >
            <ReviewSection areaId={area.id} onMessage={setMessage} />
          </SettingsStep>
          <SettingsStep
            number={2}
            title="Sperrliste"
            hint="Absender und Domänen, deren Mails nie ein Ticket werden."
          >
            <BlocksSection areaId={area.id} onMessage={setMessage} />
          </SettingsStep>
          <SettingsStep
            number={3}
            title="Letzte Eingänge"
            hint="Was mit den letzten Mails passiert ist."
          >
            <IntakeSection areaId={area.id} />
          </SettingsStep>
          <SettingsStep
            number={4}
            title="Aufbewahrung"
            term="tickets.aufbewahrung"
            hint="Alle Löschfristen des Bereichs an einer Stelle."
          >
            <RetentionSection areaId={area.id} onMessage={setMessage} />
            <MailSettingsSection areaId={area.id} part="pflege" onMessage={setMessage} />
          </SettingsStep>
        </div>
      )}
      <Feedback message={message} onClose={() => setMessage(null)} />
    </div>
  );
}
