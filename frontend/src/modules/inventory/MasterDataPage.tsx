import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { ConfirmButton } from "../../components/ConfirmDialog";
import { errorText } from "../../api";
import {
  createEntry,
  createModel,
  deleteEntry,
  fetchMasterData,
  fetchNumberRanges,
  INVENTORY_EDITOR_ROLE,
  saveKit,
  updateEntry,
  updateModel,
  updateNumberRange,
  type Kind,
  type Kit,
  type MasterData,
  type NumberRange,
  draftRows,
  kitProblem,
  type DraftRow,
} from "./api";

type Section = "arten" | "hersteller" | "gruende" | "abteilungen" | "ausstattung" | "nummern";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "arten", label: "Hardware-Arten" },
  { id: "hersteller", label: "Hersteller und Modelle" },
  { id: "gruende", label: "Gründe fürs Ausmustern" },
  { id: "abteilungen", label: "Abteilungen" },
  { id: "ausstattung", label: "Ausstattung Arbeitsplatz" },
  { id: "nummern", label: "Nummernkreise" },
];

function usedText(count: number, one = "Gerät", many = "Geräte"): string {
  if (count === 0) {
    return "nicht verwendet";
  }
  return `${count} ${count === 1 ? one : many}`;
}

/** Eine Zeile mit Name, Verwendung, Umbenennen und Löschen. */
function EntryRow({
  name,
  used,
  canEdit,
  extra,
  units,
  onRename,
  onDelete,
}: {
  name: string;
  used: number;
  canEdit: boolean;
  extra?: string;
  units?: [string, string];
  onRename: (next: string) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();

  const rename = (event: FormEvent) => {
    event.preventDefault();
    if (!value.trim()) {
      setError("Bitte einen Namen eintragen.");
      return;
    }
    onRename(value.trim()).then(
      () => setEditing(false),
      (problem: unknown) => setError(errorText(problem, "Konnte nicht gespeichert werden.")),
    );
  };

  return (
    <li className="master-row">
      {editing ? (
        <form className="master-edit" onSubmit={rename} noValidate>
          <label className="visually-hidden" htmlFor={inputId}>
            Neuer Name für {name}
          </label>
          <input
            id={inputId}
            type="text"
            value={value}
            maxLength={120}
            onChange={(event) => setValue(event.target.value)}
          />
          <button type="submit" className="button button-primary">
            Speichern
          </button>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              setEditing(false);
              setValue(name);
              setError(null);
            }}
          >
            Abbrechen
          </button>
        </form>
      ) : (
        <span className="master-name">
          <strong>{name}</strong>
          <span className="small">
            {[extra, usedText(used, ...(units ?? ["Gerät", "Geräte"]))].filter(Boolean).join(" · ")}
          </span>
        </span>
      )}
      {canEdit && !editing && (
        <span className="master-actions">
          <button type="button" className="row-button" onClick={() => setEditing(true)}>
            Umbenennen
          </button>
          <ConfirmButton
            className="row-button"
            disabled={used > 0}
            title={used > 0 ? "Wird noch verwendet" : undefined}
            confirm={{
              title: `„${name}“ löschen?`,
              text: "Der Eintrag wird aus der Liste gelöscht.",
              action: "Löschen",
              danger: true,
            }}
            onConfirm={() =>
              onDelete().catch((problem: unknown) =>
                setError(errorText(problem, "Konnte nicht gelöscht werden.")),
              )
            }
          >
            Löschen
          </ConfirmButton>
        </span>
      )}
      {error && (
        <p role="alert" className="hint-box hint-bad master-error">
          {error}
        </p>
      )}
    </li>
  );
}

/** Kleines Formular: neuer Eintrag mit Namen. */
function AddForm({
  label,
  maxLength,
  children,
  onAdd,
}: {
  label: string;
  maxLength: number;
  children?: ReactNode;
  onAdd: (name: string) => Promise<unknown>;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError("Bitte einen Namen eintragen.");
      return;
    }
    setBusy(true);
    setError(null);
    onAdd(name.trim())
      .then(() => setName(""))
      .catch((problem: unknown) => setError(errorText(problem, "Konnte nicht angelegt werden.")))
      .finally(() => setBusy(false));
  };

  return (
    <form className="settings-form master-add" onSubmit={onSubmit} noValidate>
      <div className="tool-row">
        <label>
          {label}
          <input
            type="text"
            value={name}
            maxLength={maxLength}
            autoComplete="off"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {children}
        <button type="submit" className="button button-secondary" disabled={busy}>
          Hinzufügen
        </button>
      </div>
      {error && (
        <p role="alert" className="hint-box hint-bad">
          {error}
        </p>
      )}
    </form>
  );
}

/** Vorlage anlegen oder ändern: Zeilen mit Bezeichnung, passenden Arten und Anzahl. */
function KitEditor({
  kit,
  kinds,
  onSaved,
  onCancel,
}: {
  kit: Kit | null;
  kinds: Kind[];
  onSaved: (data: MasterData) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(kit?.name ?? "");
  const [rows, setRows] = useState<DraftRow[]>(
    kit ? draftRows(kit.rows) : [{ label: "", count: "1", kindIds: [] }],
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const titleId = useId();

  const setRow = (index: number, patch: Partial<DraftRow>) =>
    setRows(rows.map((row, at) => (at === index ? { ...row, ...patch } : row)));

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const checked = kitProblem(name, rows);
    if (typeof checked === "string") {
      setError(checked);
      return;
    }
    setBusy(true);
    setError(null);
    saveKit(kit?.id ?? null, { name: name.trim(), rows: checked }).then(onSaved, (problem) => {
      setError(errorText(problem, "Die Vorlage konnte nicht gespeichert werden."));
      setBusy(false);
    });
  };

  return (
    <section className="panel" aria-labelledby={titleId}>
      <div className="panel-head">
        <h2 id={titleId}>{kit ? `Vorlage ${kit.name} bearbeiten` : "Neue Vorlage"}</h2>
      </div>
      <form className="detail-body settings-form" onSubmit={onSubmit} noValidate>
        <label>
          Name der Vorlage
          <input
            type="text"
            value={name}
            maxLength={80}
            autoComplete="off"
            placeholder="z. B. Büro Standard"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className="kit-rows">
          {rows.map((row, index) => (
            <fieldset key={index} className="kit-row">
              <legend>Zeile {index + 1}</legend>
              <div className="tool-row">
                <label>
                  Bezeichnung
                  <input
                    type="text"
                    value={row.label}
                    maxLength={80}
                    placeholder="z. B. Monitor"
                    onChange={(event) => setRow(index, { label: event.target.value })}
                  />
                </label>
                <label className="narrow">
                  Anzahl
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={9}
                    value={row.count}
                    onChange={(event) => setRow(index, { count: event.target.value })}
                  />
                </label>
              </div>
              <div
                className="chips"
                role="group"
                aria-label={`Passende Hardware-Arten, Zeile ${index + 1}`}
              >
                {kinds.map((kind) => {
                  const on = row.kindIds.includes(kind.id);
                  return (
                    <button
                      key={kind.id}
                      type="button"
                      className="chip chip-filter"
                      aria-pressed={on}
                      onClick={() =>
                        setRow(index, {
                          kindIds: on
                            ? row.kindIds.filter((value) => value !== kind.id)
                            : [...row.kindIds, kind.id],
                        })
                      }
                    >
                      {kind.name}
                    </button>
                  );
                })}
              </div>
              <div>
                <button
                  type="button"
                  className="row-button"
                  disabled={rows.length === 1}
                  onClick={() => setRows(rows.filter((_, at) => at !== index))}
                >
                  Zeile {index + 1} entfernen
                </button>
              </div>
            </fieldset>
          ))}
        </div>
        <div>
          <button
            type="button"
            className="button button-secondary"
            disabled={rows.length >= 20}
            onClick={() => setRows([...rows, { label: "", count: "1", kindIds: [] }])}
          >
            Zeile hinzufügen
          </button>
        </div>
        {error && (
          <p role="alert" className="hint-box hint-bad">
            {error}
          </p>
        )}
        <div className="project-actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            Vorlage speichern
          </button>
          <button type="button" className="button button-secondary" onClick={onCancel}>
            Abbrechen
          </button>
        </div>
      </form>
    </section>
  );
}

/** Präfix eines Nummernkreises ändern. */
function NumberRangeForm({
  entry,
  canEdit,
  onSaved,
}: {
  entry: NumberRange;
  canEdit: boolean;
  onSaved: (next: NumberRange[]) => void;
}) {
  const [prefix, setPrefix] = useState(entry.prefix);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,9}$/.test(prefix.trim())) {
      setError("Erlaubt sind Buchstaben, Ziffern und . _ / -, höchstens 10 Zeichen.");
      return;
    }
    setError(null);
    updateNumberRange(entry.key, prefix.trim()).then(onSaved, (problem: unknown) =>
      setError(errorText(problem, "Das Präfix konnte nicht gespeichert werden.")),
    );
  };

  return (
    <form className="settings-form form-stack" onSubmit={onSubmit} noValidate>
      <label htmlFor={inputId}>Präfix für {entry.label}</label>
      <div className="tool-row">
        <input
          id={inputId}
          type="text"
          value={prefix}
          maxLength={10}
          disabled={!canEdit}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setPrefix(event.target.value)}
        />
        {canEdit && (
          <button
            type="submit"
            className="button button-secondary"
            disabled={prefix.trim() === entry.prefix}
          >
            Speichern
          </button>
        )}
      </div>
      <p className="small">
        Nächste Nummer: <span className="mono">{entry.next_number}</span>
      </p>
      {error && (
        <p role="alert" className="hint-box hint-bad">
          {error}
        </p>
      )}
    </form>
  );
}

/** IT-Bestand › Stammdaten: Arten, Hersteller, Gründe, Abteilungen, Vorlagen, Nummernkreise. */
export function MasterDataPage({ roles }: { roles: readonly string[] }) {
  const canEdit = roles.includes(INVENTORY_EDITOR_ROLE);
  const [data, setData] = useState<MasterData | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [section, setSection] = useState<Section>("arten");
  const [storage, setStorage] = useState(false);
  const [kitEdit, setKitEdit] = useState<Kit | "neu" | null>(null);
  const [ranges, setRanges] = useState<NumberRange[] | null>(null);

  useEffect(() => {
    let active = true;
    fetchMasterData().then(
      (result) => active && setData(result),
      (error: unknown) =>
        active && setFailed(errorText(error, "Die Stammdaten konnten nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, []);

  const apply = (promise: Promise<MasterData>) => promise.then(setData);

  const openSection = (next: Section) => {
    setSection(next);
    setKitEdit(null);
    if (next === "nummern" && ranges === null) {
      fetchNumberRanges().then(setRanges, (error: unknown) =>
        setFailed(errorText(error, "Die Nummernkreise konnten nicht geladen werden.")),
      );
    }
  };

  return (
    <div className="page page-wide">
      <header className="page-head">
        <p className="module-label">IT-Bestand</p>
        <h1>Stammdaten</h1>
        <p className="page-sub">
          Auswahllisten für Hardware, Stellen und Arbeitsplätze. Einträge, die noch verwendet
          werden, lassen sich umbenennen, aber nicht löschen.
        </p>
      </header>
      {failed && (
        <p role="alert" className="hint-box hint-bad">
          {failed}
        </p>
      )}
      {!failed && !data && <p role="status">Wird geladen …</p>}
      {data && (
        <>
          <div className="chips" role="group" aria-label="Stammdaten">
            {SECTIONS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="chip chip-filter"
                aria-pressed={section === entry.id}
                onClick={() => openSection(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>

          {section === "arten" && (
            <section className="panel" aria-labelledby="stamm-arten">
              <div className="panel-head">
                <h2 id="stamm-arten">Hardware-Arten</h2>
              </div>
              <div className="detail-body">
                <p className="small">
                  Bei Arten mit Datenträger muss beim Ausmustern bestätigt werden, dass er gelöscht
                  oder vernichtet ist.
                </p>
                {canEdit && (
                  <AddForm
                    label="Neue Art"
                    maxLength={80}
                    onAdd={(name) =>
                      apply(createEntry("kinds", { name, has_storage: storage })).then(() =>
                        setStorage(false),
                      )
                    }
                  >
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={storage}
                        onChange={(event) => setStorage(event.target.checked)}
                      />
                      hat einen Datenträger
                    </label>
                  </AddForm>
                )}
                <ul className="master-list">
                  {data.kinds.map((kind) => (
                    <EntryRow
                      key={kind.id}
                      name={kind.name}
                      used={kind.used}
                      canEdit={canEdit}
                      extra={kind.has_storage ? "mit Datenträger" : undefined}
                      onRename={(name) =>
                        apply(
                          updateEntry("kinds", kind.id, { name, has_storage: kind.has_storage }),
                        )
                      }
                      onDelete={() => apply(deleteEntry("kinds", kind.id))}
                    />
                  ))}
                </ul>
                {canEdit && (
                  <details className="master-storage">
                    <summary>Datenträger je Art festlegen</summary>
                    <ul className="master-list">
                      {data.kinds.map((kind) => (
                        <li key={kind.id} className="master-row">
                          <label className="check-label">
                            <input
                              type="checkbox"
                              checked={kind.has_storage}
                              onChange={(event) =>
                                void apply(
                                  updateEntry("kinds", kind.id, {
                                    name: kind.name,
                                    has_storage: event.target.checked,
                                  }),
                                )
                              }
                            />
                            {kind.name} hat einen Datenträger
                          </label>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </section>
          )}

          {section === "hersteller" && (
            <section className="panel" aria-labelledby="stamm-hersteller">
              <div className="panel-head">
                <h2 id="stamm-hersteller">Hersteller und Modelle</h2>
              </div>
              <div className="detail-body">
                {canEdit && (
                  <AddForm
                    label="Neuer Hersteller"
                    maxLength={80}
                    onAdd={(name) => apply(createEntry("makers", { name }))}
                  />
                )}
                {data.makers.length === 0 && <p className="empty">Noch kein Hersteller.</p>}
                {data.makers.map((maker) => (
                  <div key={maker.id} className="master-group">
                    <ul className="master-list">
                      <EntryRow
                        name={maker.name}
                        used={maker.models.reduce((sum, model) => sum + model.used, 0)}
                        canEdit={canEdit}
                        extra={
                          maker.models.length === 1 ? "1 Modell" : `${maker.models.length} Modelle`
                        }
                        onRename={(name) => apply(updateEntry("makers", maker.id, { name }))}
                        onDelete={() => apply(deleteEntry("makers", maker.id))}
                      />
                    </ul>
                    <ul className="master-list master-sub" aria-label={`Modelle von ${maker.name}`}>
                      {maker.models.map((model) => (
                        <EntryRow
                          key={model.id}
                          name={model.name}
                          used={model.used}
                          canEdit={canEdit}
                          onRename={(name) => apply(updateModel(model.id, name))}
                          onDelete={() => apply(deleteEntry("models", model.id))}
                        />
                      ))}
                    </ul>
                    {canEdit && (
                      <AddForm
                        label={`Neues Modell von ${maker.name}`}
                        maxLength={120}
                        onAdd={(name) => apply(createModel(maker.id, name))}
                      />
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {section === "gruende" && (
            <section className="panel" aria-labelledby="stamm-gruende">
              <div className="panel-head">
                <h2 id="stamm-gruende">Gründe fürs Ausmustern</h2>
              </div>
              <div className="detail-body">
                {canEdit && (
                  <AddForm
                    label="Neuer Grund"
                    maxLength={80}
                    onAdd={(name) => apply(createEntry("reasons", { name }))}
                  />
                )}
                <ul className="master-list">
                  {data.reasons.map((reason) => (
                    <EntryRow
                      key={reason.id}
                      name={reason.name}
                      used={reason.used}
                      canEdit={canEdit}
                      onRename={(name) => apply(updateEntry("reasons", reason.id, { name }))}
                      onDelete={() => apply(deleteEntry("reasons", reason.id))}
                    />
                  ))}
                </ul>
              </div>
            </section>
          )}

          {section === "abteilungen" && (
            <section className="panel" aria-labelledby="stamm-abteilungen">
              <div className="panel-head">
                <h2 id="stamm-abteilungen">Abteilungen</h2>
              </div>
              <div className="detail-body">
                <p className="small">Die Abteilung wählst du bei der Stelle.</p>
                {canEdit && (
                  <AddForm
                    label="Neue Abteilung"
                    maxLength={80}
                    onAdd={(name) => apply(createEntry("departments", { name }))}
                  />
                )}
                {data.departments.length === 0 && <p className="empty">Noch keine Abteilung.</p>}
                <ul className="master-list">
                  {data.departments.map((entry) => (
                    <EntryRow
                      key={entry.id}
                      name={entry.name}
                      used={entry.used}
                      units={["Stelle", "Stellen"]}
                      canEdit={canEdit}
                      onRename={(name) => apply(updateEntry("departments", entry.id, { name }))}
                      onDelete={() => apply(deleteEntry("departments", entry.id))}
                    />
                  ))}
                </ul>
              </div>
            </section>
          )}

          {section === "ausstattung" && kitEdit === null && (
            <section className="panel" aria-labelledby="stamm-ausstattung">
              <div className="panel-head">
                <h2 id="stamm-ausstattung">Ausstattung Arbeitsplatz</h2>
                {canEdit && (
                  <button
                    type="button"
                    className="button button-primary"
                    onClick={() => setKitEdit("neu")}
                  >
                    Vorlage anlegen
                  </button>
                )}
              </div>
              <div className="detail-body">
                <p className="small">
                  Eine Vorlage beschreibt, was an einen Arbeitsplatz gehört. Jede Zeile nennt,
                  welche Hardware-Arten passen und wie viele es sein sollen. Am Arbeitsplatz wählst
                  du die Vorlage; dort steht dann, was fehlt.
                </p>
                {data.kits.length === 0 && <p className="empty">Noch keine Vorlage.</p>}
                <ul className="master-list">
                  {data.kits.map((kit) => (
                    <KitEntry
                      key={kit.id}
                      kit={kit}
                      kinds={data.kinds}
                      canEdit={canEdit}
                      onEdit={() => setKitEdit(kit)}
                      onDelete={() => apply(deleteEntry("kits", kit.id))}
                    />
                  ))}
                </ul>
              </div>
            </section>
          )}
          {section === "ausstattung" && kitEdit !== null && canEdit && (
            <KitEditor
              kit={kitEdit === "neu" ? null : kitEdit}
              kinds={data.kinds}
              onCancel={() => setKitEdit(null)}
              onSaved={(next) => {
                setData(next);
                setKitEdit(null);
              }}
            />
          )}

          {section === "nummern" && (
            <section className="panel" aria-labelledby="stamm-nummern">
              <div className="panel-head">
                <h2 id="stamm-nummern">Nummernkreise</h2>
              </div>
              <div className="detail-body">
                <p className="small">
                  Beim Anlegen vergibt die Werkbank die nächste freie Nummer: Präfix und eine
                  dreistellige Zahl. Ein neues Präfix gilt nur für neue Einträge.
                </p>
                {!ranges && <p role="status">Wird geladen …</p>}
                {ranges && (
                  <div className="number-ranges">
                    {ranges.map((entry) => (
                      <NumberRangeForm
                        key={`${entry.key}-${entry.prefix}`}
                        entry={entry}
                        canEdit={canEdit}
                        onSaved={setRanges}
                      />
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

/** Eine Vorlage in der Liste: Zeilen als Text, Bearbeiten und Löschen. */
function KitEntry({
  kit,
  kinds,
  canEdit,
  onEdit,
  onDelete,
}: {
  kit: Kit;
  kinds: Kind[];
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => Promise<unknown>;
}) {
  const [error, setError] = useState<string | null>(null);
  const names = new Map(kinds.map((kind) => [kind.id, kind.name]));
  const summary = kit.rows
    .map(
      (row) =>
        `${row.count} × ${row.label} (${row.kind_ids.map((id) => names.get(id) ?? "?").join(" oder ")})`,
    )
    .join(", ");
  return (
    <li className="master-row">
      <span className="master-name">
        <strong>{kit.name}</strong>
        <span className="small">
          {summary} · {usedText(kit.used, "Arbeitsplatz", "Arbeitsplätze")}
        </span>
      </span>
      {canEdit && (
        <span className="master-actions">
          <button type="button" className="row-button" onClick={onEdit}>
            Bearbeiten
          </button>
          <ConfirmButton
            className="row-button"
            disabled={kit.used > 0}
            title={kit.used > 0 ? "Wird noch an Arbeitsplätzen verwendet" : undefined}
            confirm={{
              title: `Ausstattung „${kit.name}“ löschen?`,
              text: "Der Eintrag wird aus der Liste gelöscht.",
              action: "Löschen",
              danger: true,
            }}
            onConfirm={() =>
              onDelete().catch((problem: unknown) =>
                setError(errorText(problem, "Konnte nicht gelöscht werden.")),
              )
            }
          >
            Löschen
          </ConfirmButton>
        </span>
      )}
      {error && (
        <p role="alert" className="hint-box hint-bad master-error">
          {error}
        </p>
      )}
    </li>
  );
}
