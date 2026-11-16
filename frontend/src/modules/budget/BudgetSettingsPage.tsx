import { useEffect, useState, type FormEvent } from "react";
import { errorText } from "../../api";
import {
  createTag,
  deleteTag,
  fetchBudgetSettings,
  fetchTags,
  MONTHS,
  renameTag,
  saveBudgetSettings,
  TAG_MAX_LENGTH,
  type BudgetSettings,
  type TagCount,
} from "./api";
import { BudgetHead, DeleteButton } from "./shared";

function SettingsForm({ initial }: { initial: BudgetSettings }) {
  const [settings, setSettings] = useState(initial);
  const [startMonth, setStartMonth] = useState(initial.start_month);
  const [yearLabel, setYearLabel] = useState(initial.year_label);
  const [costCenter, setCostCenter] = useState(initial.cost_center);
  const [message, setMessage] = useState<{ kind: "status" | "alert"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!yearLabel.trim()) {
      setMessage({
        kind: "alert",
        text: "Bitte eine Bezeichnung für das Geschäftsjahr eintragen.",
      });
      return;
    }
    setBusy(true);
    setMessage(null);
    saveBudgetSettings({
      start_month: startMonth,
      year_label: yearLabel.trim(),
      cost_center: costCenter.trim(),
    })
      .then((result) => {
        setSettings(result);
        setMessage({ kind: "status", text: "Die Einstellungen sind gespeichert." });
      })
      .catch((error: unknown) => {
        setMessage({
          kind: "alert",
          text: errorText(error, "Die Einstellungen konnten nicht gespeichert werden."),
        });
      })
      .finally(() => setBusy(false));
  };

  const endMonth = MONTHS[(startMonth + 10) % 12] ?? "";
  return (
    <section className="panel" aria-labelledby="budget-jahr-titel">
      <div className="panel-head">
        <h2 id="budget-jahr-titel">Geschäftsjahr und Kostenstelle</h2>
        <span className="small">
          Laufend: {settings.year_label} {settings.current_year_name}
        </span>
      </div>
      <form className="detail-body settings-form" onSubmit={onSubmit} noValidate>
        <div className="tool-row">
          <label className="narrow">
            Beginn des Geschäftsjahrs
            <select
              value={startMonth}
              onChange={(event) => setStartMonth(Number(event.target.value))}
            >
              {MONTHS.map((month, index) => (
                <option key={month} value={index + 1}>
                  1. {month}
                </option>
              ))}
            </select>
          </label>
          <label className="narrow">
            Bezeichnung
            <input
              type="text"
              value={yearLabel}
              maxLength={30}
              onChange={(event) => setYearLabel(event.target.value)}
            />
          </label>
          <label className="narrow">
            Kostenstelle (freiwillig)
            <input
              type="text"
              value={costCenter}
              maxLength={40}
              onChange={(event) => setCostCenter(event.target.value)}
            />
          </label>
        </div>
        <p className="small">
          Das Geschäftsjahr dauert zwölf Monate und endet am letzten Tag im {endMonth}. Die
          Bezeichnung erscheint überall, wo die Werkbank das Jahr nennt, z. B. „Geschäftsjahr“ oder
          „Wirtschaftsjahr“. Wer den Beginn ändert, ordnet auch Laufzeiten und Rechnungen den neuen
          Zeiträumen zu.
        </p>
        <div className="actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            Einstellungen speichern
          </button>
        </div>
        {message && (
          <p
            role={message.kind}
            className={message.kind === "alert" ? "hint-box hint-bad" : "hint-box"}
          >
            {message.text}
          </p>
        )}
      </form>
    </section>
  );
}

/** Ein Tag der Liste: Name, Zahl der Posten, umbenennen und löschen. */
function TagRow({ tag, onChanged }: { tag: TagCount; onChanged: (text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(tag.tag);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onRename = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError("Bitte einen Namen eintragen.");
      return;
    }
    setBusy(true);
    setError(null);
    renameTag(tag.id, name.trim())
      .then((saved) => {
        setEditing(false);
        onChanged(`Der Tag heißt jetzt „${saved.tag}“.`);
      })
      .catch((problem: unknown) => {
        setError(errorText(problem, "Der Tag konnte nicht umbenannt werden."));
      })
      .finally(() => setBusy(false));
  };

  return (
    <li>
      {editing ? (
        <form className="budget-merge settings-form" onSubmit={onRename} noValidate>
          <label className="narrow">
            Neuer Name für {tag.tag}
            <input
              type="text"
              value={name}
              maxLength={TAG_MAX_LENGTH}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <button key="speichern" type="submit" className="button button-primary" disabled={busy}>
            Umbenennen
          </button>
          <button
            key="abbrechen"
            type="button"
            className="button button-secondary"
            onClick={() => {
              setEditing(false);
              setName(tag.tag);
              setError(null);
            }}
          >
            Abbrechen
          </button>
        </form>
      ) : (
        <>
          <span>
            {tag.tag}
            <span className="budget-muted budget-line">
              {tag.items === 1 ? "1 Budgetposten" : `${tag.items} Budgetposten`}
            </span>
          </span>
          <span className="budget-row-actions">
            <button
              key="umbenennen"
              type="button"
              className="button button-secondary"
              aria-label={`Tag ${tag.tag} umbenennen`}
              onClick={() => setEditing(true)}
            >
              Umbenennen
            </button>
            <DeleteButton
              what={`Tag ${tag.tag}`}
              run={() => deleteTag(tag.id)}
              onDeleted={() => onChanged(`Der Tag „${tag.tag}“ ist gelöscht.`)}
            />
          </span>
        </>
      )}
      {error && (
        <p role="alert" className="hint-box hint-bad budget-delete-error">
          {error}
        </p>
      )}
    </li>
  );
}

/** Die Liste der Tags, aus der Budgetposten wählen. */
function TagsSection() {
  const [tags, setTags] = useState<TagCount[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [round, setRound] = useState(0);
  const [name, setName] = useState("");
  const [message, setMessage] = useState<{ kind: "status" | "alert"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetchTags()
      .then((result) => {
        if (active) {
          setTags(result);
        }
      })
      .catch(() => {
        if (active) {
          setFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, [round]);

  const changed = (text: string) => {
    setMessage({ kind: "status", text });
    setRound(round + 1);
  };

  const onAdd = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setMessage({ kind: "alert", text: "Bitte einen Namen für den Tag eintragen." });
      return;
    }
    setBusy(true);
    setMessage(null);
    createTag(name.trim())
      .then((saved) => {
        setName("");
        changed(`Der Tag „${saved.tag}“ ist angelegt.`);
      })
      .catch((problem: unknown) => {
        setMessage({
          kind: "alert",
          text: errorText(problem, "Der Tag konnte nicht angelegt werden."),
        });
      })
      .finally(() => setBusy(false));
  };

  return (
    <section className="panel" aria-labelledby="budget-tags-titel">
      <div className="panel-head">
        <h2 id="budget-tags-titel">Tags</h2>
      </div>
      <div className="detail-body">
        <p className="small">
          Budgetposten wählen ihre Tags aus dieser Liste. Umbenennen ändert den Tag auch an allen
          Posten und gespeicherten Statistiken; Löschen entfernt ihn überall. Eine Statistik, der
          dabei kein Tag mehr bleibt, wird gelöscht.
        </p>
        <form className="budget-merge settings-form" onSubmit={onAdd} noValidate>
          <label className="narrow">
            Neuer Tag
            <input
              type="text"
              value={name}
              maxLength={TAG_MAX_LENGTH}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <button type="submit" className="button button-secondary" disabled={busy}>
            Tag anlegen
          </button>
        </form>
        {failed && (
          <p role="alert" className="hint-box hint-bad">
            Die Tags konnten nicht geladen werden.
          </p>
        )}
        {tags !== null && tags.length === 0 && (
          <p className="budget-muted">Es ist noch kein Tag angelegt.</p>
        )}
        {tags !== null && tags.length > 0 && (
          <ul className="budget-list" aria-label="Tags">
            {tags.map((tag) => (
              <TagRow key={`${tag.id}-${tag.tag}`} tag={tag} onChanged={changed} />
            ))}
          </ul>
        )}
        {message && (
          <p
            role={message.kind}
            className={message.kind === "alert" ? "hint-box hint-bad" : "hint-box"}
          >
            {message.text}
          </p>
        )}
      </div>
    </section>
  );
}

/** IT-Budget › Einstellungen: Geschäftsjahr, Kostenstelle und die Liste der Tags. */
export function BudgetSettingsPage() {
  const [settings, setSettings] = useState<BudgetSettings | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    fetchBudgetSettings()
      .then((result) => {
        if (active) {
          setSettings(result);
        }
      })
      .catch(() => {
        if (active) {
          setFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="page budget-page">
      <BudgetHead
        title="Einstellungen"
        sub="Grundlagen des Budgets und die Liste der Tags. Ändern darf sie der Budgetverwalter."
      />
      {failed && (
        <p role="alert" className="panel panel-empty">
          Die Einstellungen konnten nicht geladen werden.
        </p>
      )}
      {!failed && !settings && <p role="status">Wird geladen …</p>}
      {settings && <SettingsForm initial={settings} />}
      {settings && <TagsSection />}
    </div>
  );
}
