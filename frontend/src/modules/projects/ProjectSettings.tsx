import { useState, type FormEvent } from "react";
import { errorText } from "../../api";
import { navigate } from "../../router";
import { PROJECTS_PATH } from "../../navigation";
import { euroInput, parseEuro } from "../budget/api";
import {
  deleteProject,
  isHttpsUrl,
  updateProject,
  type Person,
  type PersonKind,
  type Project,
  type ProjectLink,
  type ProjectStatus,
} from "./api";

const PEOPLE_MAX = 50;
const LINKS_MAX = 30;

function emptyPerson(kind: PersonKind): Person {
  return { name: "", role: "", kind, organisation: "", contact: "" };
}

/** Verschiebt einen Eintrag um eine Stelle nach oben (-1) oder unten (+1). */
export function moved<T>(list: T[], index: number, step: -1 | 1): T[] {
  const target = index + step;
  if (target < 0 || target >= list.length) {
    return list;
  }
  const next = [...list];
  const [entry] = next.splice(index, 1);
  if (entry !== undefined) {
    next.splice(target, 0, entry);
  }
  return next;
}

interface Props {
  project: Project;
  onSaved: () => void;
}

/** Einstellungen eines Projekts: Name, Status, Laufzeit, Budget, Rollen und Links. */
export function SettingsTab({ project, onSaved }: Props) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [startsOn, setStartsOn] = useState(project.starts_on ?? "");
  const [endsOn, setEndsOn] = useState(project.ends_on ?? "");
  const [budget, setBudget] = useState(euroInput(project.budget.budget_cents));
  const [approvedOn, setApprovedOn] = useState(project.budget_approved_on ?? "");
  const [budgetNote, setBudgetNote] = useState(project.budget_note);
  const [people, setPeople] = useState<Person[]>(project.people);
  const [links, setLinks] = useState<ProjectLink[]>(project.links);
  const [message, setMessage] = useState<{ kind: "status" | "alert"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const setPerson = (index: number, change: Partial<Person>) =>
    setPeople(people.map((entry, i) => (i === index ? { ...entry, ...change } : entry)));
  const setLink = (index: number, change: Partial<ProjectLink>) =>
    setLinks(links.map((entry, i) => (i === index ? { ...entry, ...change } : entry)));

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const budgetCents = budget.trim() === "" ? null : parseEuro(budget);
    const cleanPeople = people
      .map((entry) => ({
        ...entry,
        name: entry.name.trim(),
        role: entry.role.trim(),
        organisation: entry.organisation.trim(),
        contact: entry.contact.trim(),
      }))
      .filter((entry) => entry.name || entry.role || entry.organisation || entry.contact);
    const cleanLinks = links
      .map((entry) => ({ label: entry.label.trim(), url: entry.url.trim() }))
      .filter((entry) => entry.label || entry.url);
    let problem: string | null = null;
    if (!name.trim()) {
      problem = "Bitte einen Namen eintragen.";
    } else if (startsOn && endsOn && endsOn < startsOn) {
      problem = "Das Ende liegt vor dem Beginn.";
    } else if (budget.trim() !== "" && budgetCents === null) {
      problem = "Das Budget ist nicht lesbar. Bitte so eintragen: 150000,00";
    } else if (cleanPeople.some((entry) => !entry.name)) {
      problem = "Bitte bei jeder Person einen Namen eintragen.";
    } else if (cleanLinks.some((entry) => !entry.label)) {
      problem = "Bitte jedem Link eine Bezeichnung geben.";
    } else if (cleanLinks.some((entry) => !isHttpsUrl(entry.url))) {
      problem = "Links müssen vollständige Adressen mit https:// sein.";
    }
    if (problem) {
      setMessage({ kind: "alert", text: problem });
      return;
    }
    setBusy(true);
    setMessage(null);
    updateProject(project.id, {
      name: name.trim(),
      description: description.trim(),
      status,
      starts_on: startsOn || null,
      ends_on: endsOn || null,
      budget_cents: budgetCents,
      budget_approved_on: approvedOn || null,
      budget_note: budgetNote.trim(),
      people: cleanPeople,
      links: cleanLinks,
    })
      .then(() => {
        setMessage({ kind: "status", text: "Die Einstellungen sind gespeichert." });
        onSaved();
      })
      .catch((error: unknown) =>
        setMessage({
          kind: "alert",
          text: errorText(error, "Die Einstellungen konnten nicht gespeichert werden."),
        }),
      )
      .finally(() => setBusy(false));
  };

  const onDelete = () => {
    setBusy(true);
    deleteProject(project.id)
      .then(() => navigate(PROJECTS_PATH))
      .catch((error: unknown) => {
        setBusy(false);
        setConfirmDelete(false);
        setMessage({
          kind: "alert",
          text: errorText(error, "Das Projekt konnte nicht gelöscht werden."),
        });
      });
  };

  return (
    <form className="project-settings settings-form" onSubmit={onSubmit} noValidate>
      <section className="panel" aria-labelledby="einstellungen-allgemein">
        <div className="panel-head">
          <h2 id="einstellungen-allgemein">Allgemein</h2>
        </div>
        <div className="detail-body">
          <label>
            Name
            <input
              type="text"
              value={name}
              maxLength={160}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            Kurzbeschreibung
            <input
              type="text"
              value={description}
              maxLength={500}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <div className="form-grid">
            <label>
              Status
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as ProjectStatus)}
              >
                <option value="geplant">geplant</option>
                <option value="aktiv">aktiv</option>
                <option value="pausiert">pausiert</option>
                <option value="abgeschlossen">abgeschlossen</option>
              </select>
            </label>
            <label>
              Beginn
              <input
                type="date"
                value={startsOn}
                onChange={(event) => setStartsOn(event.target.value)}
              />
            </label>
            <label>
              Ende
              <input
                type="date"
                value={endsOn}
                onChange={(event) => setEndsOn(event.target.value)}
              />
            </label>
          </div>
          <p className="small">
            Abgeschlossene Projekte bleiben lesbar. Im IT-Budget lassen sich ihnen keine neuen
            Budgetposten mehr zuordnen.
          </p>
        </div>
      </section>

      <section className="panel" aria-labelledby="einstellungen-budget">
        <div className="panel-head">
          <h2 id="einstellungen-budget">Veranschlagtes Budget</h2>
        </div>
        <div className="detail-body">
          <div className="form-grid">
            <label>
              Betrag (brutto, Euro, freiwillig)
              <input
                type="text"
                inputMode="decimal"
                value={budget}
                onChange={(event) => setBudget(event.target.value)}
              />
            </label>
            <label>
              Freigegeben am (freiwillig)
              <input
                type="date"
                value={approvedOn}
                onChange={(event) => setApprovedOn(event.target.value)}
              />
            </label>
            <label>
              Notiz (freiwillig)
              <input
                type="text"
                value={budgetNote}
                maxLength={200}
                onChange={(event) => setBudgetNote(event.target.value)}
              />
            </label>
          </div>
          <p className="small">
            Geplante und tatsächliche Kosten kommen aus dem IT-Budget: Dort wählst du beim
            Budgetposten dieses Projekt aus.
          </p>
        </div>
      </section>

      <section className="panel" aria-labelledby="einstellungen-rollen">
        <div className="panel-head">
          <h2 id="einstellungen-rollen">Rollen und Ansprechpartner</h2>
          <div className="project-actions">
            <button
              type="button"
              className="button button-secondary"
              disabled={people.length >= PEOPLE_MAX}
              onClick={() => setPeople([...people, emptyPerson("intern")])}
            >
              Interne Person hinzufügen
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={people.length >= PEOPLE_MAX}
              onClick={() => setPeople([...people, emptyPerson("extern")])}
            >
              Externe Person hinzufügen
            </button>
          </div>
        </div>
        <div className="detail-body">
          {people.length === 0 && <p className="small">Noch niemand eingetragen.</p>}
          {people.map((person, index) => (
            <fieldset key={index} className="project-row">
              <legend>
                {person.kind === "extern" ? "Externe Person" : "Interne Person"} {index + 1}
              </legend>
              <div className="form-grid">
                <label>
                  Name
                  <input
                    type="text"
                    value={person.name}
                    maxLength={160}
                    onChange={(event) => setPerson(index, { name: event.target.value })}
                  />
                </label>
                <label>
                  Rolle im Projekt
                  <input
                    type="text"
                    value={person.role}
                    maxLength={120}
                    onChange={(event) => setPerson(index, { role: event.target.value })}
                  />
                </label>
                <label>
                  Art
                  <select
                    value={person.kind}
                    onChange={(event) =>
                      setPerson(index, { kind: event.target.value as PersonKind })
                    }
                  >
                    <option value="intern">intern</option>
                    <option value="extern">extern</option>
                  </select>
                </label>
                <label>
                  Firma oder Abteilung
                  <input
                    type="text"
                    value={person.organisation}
                    maxLength={160}
                    onChange={(event) => setPerson(index, { organisation: event.target.value })}
                  />
                </label>
                <label>
                  Kontakt (Mail oder Telefon)
                  <input
                    type="text"
                    value={person.contact}
                    maxLength={200}
                    onChange={(event) => setPerson(index, { contact: event.target.value })}
                  />
                </label>
              </div>
              <div className="project-actions">
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={index === 0}
                  aria-label={`Person ${index + 1} nach oben`}
                  onClick={() => setPeople(moved(people, index, -1))}
                >
                  Nach oben
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  aria-label={`Person ${index + 1} entfernen`}
                  onClick={() => setPeople(people.filter((_, i) => i !== index))}
                >
                  Entfernen
                </button>
              </div>
            </fieldset>
          ))}
          <p className="small">
            Personen trägst du als Text ein; die Werkbank fragt dafür nichts aus Microsoft Entra ab.
          </p>
        </div>
      </section>

      <section className="panel" aria-labelledby="einstellungen-links">
        <div className="panel-head">
          <h2 id="einstellungen-links">Links</h2>
          <button
            type="button"
            className="button button-secondary"
            disabled={links.length >= LINKS_MAX}
            onClick={() => setLinks([...links, { label: "", url: "https://" }])}
          >
            Link hinzufügen
          </button>
        </div>
        <div className="detail-body">
          {links.length === 0 && <p className="small">Noch keine Links.</p>}
          {links.map((link, index) => (
            <fieldset key={index} className="project-row">
              <legend>Link {index + 1}</legend>
              <div className="form-grid">
                <label>
                  Bezeichnung
                  <input
                    type="text"
                    value={link.label}
                    maxLength={120}
                    onChange={(event) => setLink(index, { label: event.target.value })}
                  />
                </label>
                <label>
                  Adresse
                  <input
                    type="url"
                    value={link.url}
                    maxLength={500}
                    onChange={(event) => setLink(index, { url: event.target.value })}
                  />
                </label>
              </div>
              <div className="project-actions">
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={index === 0}
                  aria-label={`Link ${index + 1} nach oben`}
                  onClick={() => setLinks(moved(links, index, -1))}
                >
                  Nach oben
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  aria-label={`Link ${index + 1} entfernen`}
                  onClick={() => setLinks(links.filter((_, i) => i !== index))}
                >
                  Entfernen
                </button>
              </div>
            </fieldset>
          ))}
          <p className="small">Erlaubt sind nur Adressen mit https://.</p>
        </div>
      </section>

      {message && (
        <p
          role={message.kind}
          className={message.kind === "alert" ? "hint-box hint-bad" : "hint-box"}
        >
          {message.text}
        </p>
      )}
      <div className="project-actions">
        <button type="submit" className="button button-primary" disabled={busy}>
          Einstellungen speichern
        </button>
      </div>

      <section className="panel project-danger" aria-labelledby="einstellungen-loeschen">
        <div className="panel-head">
          <h2 id="einstellungen-loeschen">Projekt löschen</h2>
        </div>
        <div className="detail-body">
          <p className="small">
            Löscht das Projekt mit Jour Fixe, Anhängen und Aufgaben. Budgetposten im IT-Budget
            bleiben bestehen und verlieren nur die Zuordnung. Wenn du das Projekt nur beenden
            willst, setze den Status auf „abgeschlossen“.
          </p>
          <div className="project-actions">
            {confirmDelete ? (
              <>
                <button
                  type="button"
                  className="button button-danger"
                  disabled={busy}
                  onClick={onDelete}
                >
                  Wirklich löschen
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => setConfirmDelete(false)}
                >
                  Doch nicht
                </button>
              </>
            ) : (
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setConfirmDelete(true)}
              >
                Projekt löschen
              </button>
            )}
          </div>
        </div>
      </section>
    </form>
  );
}
