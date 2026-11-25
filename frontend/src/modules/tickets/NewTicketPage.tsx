import { useEffect, useState, type FormEvent } from "react";
import { errorText } from "../../api";
import { Feedback, type FeedbackMessage } from "../../components/Feedback";
import {
  ErrorSummary,
  Field,
  problemFor,
  RequiredNote,
  Segmented,
  type Problem,
} from "../../components/Field";
import { FormStep } from "../../components/FormStep";
import { ListChoice } from "../../components/ListChoice";
import { navigate } from "../../router";
import { useDebounced } from "../inventory/paged";
import {
  createTicket,
  fetchAreaCategories,
  PRIORITY_LABELS,
  searchReporters,
  type Category,
  type ReporterHit,
  ticketPath,
  TICKETS_PATH,
  type Priority,
  type TicketAccess,
} from "./api";

/** Mailadressen aus einem Freitext (Komma, Semikolon, Zeilenumbruch). */
export function parseMails(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\s,;]+/)
        .map((part) => part.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

export function NewTicketPage({ access }: { access: TicketAccess }) {
  const areas = access.areas.filter((a) => a.role === "edit" || a.role === "admin");
  const [areaId, setAreaId] = useState<number | "">(areas.length === 1 ? (areas[0]?.id ?? "") : "");
  const [subject, setSubject] = useState("");
  const [reporterName, setReporterName] = useState("");
  const [reporterMail, setReporterMail] = useState("");
  // Vorschläge aus Entra zum Namen; nach einer Auswahl erst wieder beim Weitertippen
  const [picked, setPicked] = useState<string | null>(null);
  const [hits, setHits] = useState<{ query: string; items: ReporterHit[] } | null>(null);
  const [searchFailed, setSearchFailed] = useState(false);
  const nameQuery = useDebounced(reporterName.trim());
  const [participants, setParticipants] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [channel, setChannel] = useState<"manual" | "phone">("phone");
  const [body, setBody] = useState("");
  const [assignToMe, setAssignToMe] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [message, setMessage] = useState<FeedbackMessage | null>(null);
  // Kategorien des gewählten Bereichs (mit dem Bereich, für den sie gelten)
  const [loaded, setLoaded] = useState<{ area: number; items: Category[] } | null>(null);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const categories = loaded && loaded.area === areaId ? loaded.items : [];

  useEffect(() => {
    if (areaId === "") {
      return;
    }
    let active = true;
    fetchAreaCategories(areaId).then(
      (items) => active && setLoaded({ area: areaId, items }),
      () => active && setLoaded({ area: areaId, items: [] }),
    );
    return () => {
      active = false;
    };
  }, [areaId]);

  useEffect(() => {
    if (nameQuery.length < 2 || nameQuery === picked) {
      return;
    }
    let active = true;
    searchReporters(nameQuery).then(
      (items) => {
        if (active) {
          setHits({ query: nameQuery, items });
          setSearchFailed(false);
        }
      },
      () => active && setSearchFailed(true),
    );
    return () => {
      active = false;
    };
  }, [nameQuery, picked]);

  const suggestions =
    hits && hits.query === reporterName.trim() && reporterName.trim() !== picked ? hits.items : [];

  const pick = (hit: ReporterHit) => {
    setReporterName(hit.name);
    setReporterMail(hit.mail);
    setPicked(hit.name);
  };

  if (areas.length === 0) {
    return (
      <div className="page">
        <p className="module-label">Tickets</p>
        <h1>Neues Ticket</h1>
        <p className="hint-box">
          Du bist in keinem Bereich Mitglied und kannst deshalb keine Tickets anlegen.
        </p>
      </div>
    );
  }

  // Geprüft wird beim Absenden, danach bei jeder Änderung.
  const problems: Problem[] = [];
  if (areaId === "") {
    problems.push({ id: "ticket-bereich", label: "Bereich", text: "Wähle den Bereich." });
  }
  if (!subject.trim()) {
    problems.push({ id: "ticket-betreff", label: "Betreff", text: "Trag einen Betreff ein." });
  }
  if (!reporterName.trim()) {
    problems.push({
      id: "ticket-melder",
      label: "Name des Melders",
      text: "Trag ein, wer sich gemeldet hat.",
    });
  }
  if (!body.trim()) {
    problems.push({ id: "ticket-anliegen", label: "Anliegen", text: "Beschreib das Anliegen." });
  }
  const shown = tried ? problems : [];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (problems.length > 0 || areaId === "") {
      return;
    }
    setBusy(true);
    createTicket({
      area_id: areaId,
      subject,
      reporter_name: reporterName,
      reporter_mail: reporterMail.trim() || null,
      priority,
      channel,
      body,
      participants: parseMails(participants).map((mail) => ({ name: "", mail })),
      assign_to_me: assignToMe,
      category_id: categories.some((c) => c.id === categoryId) ? categoryId : null,
    })
      .then((ticket) => {
        // Die Ticketseite selbst ist die Rückmeldung
        navigate(ticketPath(ticket.number));
      })
      .catch((problem: unknown) =>
        setMessage({
          kind: "alert",
          text: errorText(problem, "Das Ticket konnte nicht angelegt werden."),
        }),
      )
      .finally(() => setBusy(false));
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="module-label">Tickets</p>
          <h1>Neues Ticket</h1>
          <p className="page-sub">Für Anliegen, die per Telefon oder persönlich ankommen.</p>
        </div>
      </header>
      <form className="panel settings-form detail-body" onSubmit={submit} noValidate>
        <RequiredNote />
        <ErrorSummary problems={shown} />
        <FormStep number={1} title="Einordnen">
          <ListChoice
            label="Bereich"
            id="ticket-bereich"
            required
            unit="Bereiche"
            placeholder="Name des Bereichs …"
            options={areas.map((a) => ({ id: a.id, label: a.name }))}
            value={areaId === "" ? "" : String(areaId)}
            onChange={(next) => {
              setAreaId(next ? Number(next) : "");
              setCategoryId(null);
            }}
            error={problemFor(shown, "ticket-bereich")}
          />
          {categories.length > 0 && (
            <ListChoice
              label="Kategorie"
              none="Keine Kategorie"
              unit="Kategorien"
              placeholder="Name der Kategorie …"
              hint="Setzt die Priorität der Kategorie."
              options={categories.map((c) => ({
                id: c.id,
                label: c.name,
                detail: `Priorität ${PRIORITY_LABELS[c.default_priority]}`,
              }))}
              value={categoryId === null ? "" : String(categoryId)}
              onChange={(next) => {
                const id = next ? Number(next) : null;
                setCategoryId(id);
                const chosen = categories.find((c) => c.id === id);
                if (chosen) {
                  setPriority(chosen.default_priority);
                }
              }}
            />
          )}
          <Segmented
            label="Eingangsweg"
            value={channel}
            options={[
              { value: "phone", label: "Anruf" },
              { value: "manual", label: "Von Hand erfasst" },
            ]}
            onChange={setChannel}
          />
          <Segmented
            label="Priorität"
            value={priority}
            options={(Object.keys(PRIORITY_LABELS) as Priority[]).map((p) => ({
              value: p,
              label: PRIORITY_LABELS[p],
            }))}
            onChange={setPriority}
          />
        </FormStep>
        <FormStep number={2} title="Wer meldet sich">
          <div className="ticket-reporter">
            <Field
              label="Name des Melders"
              id="ticket-melder"
              required
              error={problemFor(shown, "ticket-melder")}
              hint={
                searchFailed
                  ? "Die Suche in Entra ist gerade nicht verfügbar. Trag Name und Mailadresse selbst ein."
                  : "Ab zwei Buchstaben erscheinen Vorschläge aus Entra; du kannst den Namen auch frei eintragen."
              }
            >
              {(control) => (
                <input
                  {...control}
                  maxLength={200}
                  autoComplete="off"
                  value={reporterName}
                  onChange={(event) => setReporterName(event.target.value)}
                />
              )}
            </Field>
            {suggestions.length > 0 && (
              <ul className="ticket-pick-list" aria-label="Vorschläge aus Entra">
                {suggestions.map((hit) => (
                  <li key={`${hit.mail}-${hit.name}`}>
                    <button type="button" className="button button-link" onClick={() => pick(hit)}>
                      {hit.name}
                    </button>
                    <span className="small">
                      {" "}
                      · {hit.mail}
                      {hit.detail && ` · ${hit.detail}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="visually-hidden" aria-live="polite">
              {suggestions.length > 0 ? `${suggestions.length} Vorschläge aus Entra.` : ""}
            </p>
          </div>
          <Field label="Mailadresse des Melders" hint="freiwillig">
            {(control) => (
              <input
                {...control}
                type="email"
                maxLength={320}
                autoComplete="off"
                value={reporterMail}
                onChange={(event) => setReporterMail(event.target.value)}
              />
            )}
          </Field>
          <Field
            label="Beteiligte in Kopie"
            hint="freiwillig, Mailadressen mit Komma getrennt"
            wide
          >
            {(control) => (
              <input
                {...control}
                maxLength={2000}
                autoComplete="off"
                value={participants}
                onChange={(event) => setParticipants(event.target.value)}
              />
            )}
          </Field>
        </FormStep>
        <FormStep number={3} title="Worum es geht">
          <Field
            label="Betreff"
            id="ticket-betreff"
            required
            wide
            error={problemFor(shown, "ticket-betreff")}
          >
            {(control) => (
              <input
                {...control}
                maxLength={250}
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
              />
            )}
          </Field>
          <Field
            label="Anliegen"
            id="ticket-anliegen"
            required
            wide
            error={problemFor(shown, "ticket-anliegen")}
          >
            {(control) => (
              <textarea
                {...control}
                rows={6}
                maxLength={20000}
                value={body}
                onChange={(event) => setBody(event.target.value)}
              />
            )}
          </Field>
          <label className="check-label form-wide">
            <input
              type="checkbox"
              checked={assignToMe}
              onChange={(event) => setAssignToMe(event.target.checked)}
            />
            Mir zuweisen
          </label>
        </FormStep>
        <div className="form-actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            {busy ? "Wird angelegt …" : "Ticket anlegen"}
          </button>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => navigate(TICKETS_PATH)}
          >
            Abbrechen
          </button>
        </div>
      </form>
      <Feedback message={message} onClose={() => setMessage(null)} />
    </div>
  );
}
