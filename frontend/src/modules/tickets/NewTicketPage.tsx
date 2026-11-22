import { useEffect, useState, type FormEvent } from "react";
import { errorText } from "../../api";
import { Feedback, type FeedbackMessage } from "../../components/Feedback";
import { navigate } from "../../router";
import {
  createTicket,
  fetchAreaCategories,
  PRIORITY_LABELS,
  type Category,
  ticketPath,
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
  const [participants, setParticipants] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [channel, setChannel] = useState<"manual" | "phone">("phone");
  const [body, setBody] = useState("");
  const [assignToMe, setAssignToMe] = useState(false);
  const [busy, setBusy] = useState(false);
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

  if (areas.length === 0) {
    return (
      <div className="page">
        <p className="module-label">Tickets</p>
        <h1>Neues Ticket</h1>
        <p className="hint-box">
          Du kannst in keinem Bereich Tickets bearbeiten. Mit „Nur lesen“ legst du keine Tickets an.
        </p>
      </div>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (areaId === "") {
      setMessage({ kind: "alert", text: "Bitte wähle zuerst einen Bereich." });
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
      <form className="panel settings-form detail-body" onSubmit={submit}>
        <div className="form-grid">
          <label>
            Bereich
            <select
              required
              value={areaId}
              onChange={(event) => {
                setAreaId(event.target.value ? Number(event.target.value) : "");
                setCategoryId(null);
              }}
            >
              {areas.length > 1 && <option value="">Bitte wählen …</option>}
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          {categories.length > 0 && (
            <label>
              Kategorie
              <select
                value={categoryId ?? ""}
                onChange={(event) => {
                  const id = event.target.value ? Number(event.target.value) : null;
                  setCategoryId(id);
                  const chosen = categories.find((c) => c.id === id);
                  if (chosen) {
                    setPriority(chosen.default_priority);
                  }
                }}
              >
                <option value="">Keine</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Eingangsweg
            <select
              value={channel}
              onChange={(event) => setChannel(event.target.value as "manual" | "phone")}
            >
              <option value="phone">Anruf</option>
              <option value="manual">Von Hand erfasst</option>
            </select>
          </label>
          <label>
            Priorität
            <select
              value={priority}
              onChange={(event) => setPriority(event.target.value as Priority)}
            >
              {(Object.keys(PRIORITY_LABELS) as Priority[]).map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Betreff
          <input
            required
            maxLength={250}
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
          />
        </label>
        <div className="form-grid">
          <label>
            Name des Melders
            <input
              required
              maxLength={200}
              autoComplete="off"
              value={reporterName}
              onChange={(event) => setReporterName(event.target.value)}
            />
          </label>
          <label>
            Mailadresse des Melders (freiwillig)
            <input
              type="email"
              maxLength={320}
              autoComplete="off"
              value={reporterMail}
              onChange={(event) => setReporterMail(event.target.value)}
            />
          </label>
        </div>
        <label>
          Beteiligte in Kopie (freiwillig, Mailadressen mit Komma getrennt)
          <input
            maxLength={2000}
            autoComplete="off"
            value={participants}
            onChange={(event) => setParticipants(event.target.value)}
          />
        </label>
        <label>
          Anliegen
          <textarea
            required
            rows={6}
            maxLength={20000}
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={assignToMe}
            onChange={(event) => setAssignToMe(event.target.checked)}
          />
          Mir zuweisen
        </label>
        <div className="actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            {busy ? "Wird angelegt …" : "Ticket anlegen"}
          </button>
        </div>
      </form>
      <Feedback message={message} onClose={() => setMessage(null)} />
    </div>
  );
}
