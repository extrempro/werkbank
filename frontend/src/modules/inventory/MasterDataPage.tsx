import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { errorText } from "../../api";
import {
  createEntry,
  createModel,
  deleteEntry,
  fetchMasterData,
  INVENTORY_EDITOR_ROLE,
  updateEntry,
  updateModel,
  type MasterData,
} from "./api";

type Section = "arten" | "hersteller" | "gruende";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "arten", label: "Hardware-Arten" },
  { id: "hersteller", label: "Hersteller und Modelle" },
  { id: "gruende", label: "Gründe fürs Ausmustern" },
];

function usedText(count: number): string {
  if (count === 0) {
    return "nicht verwendet";
  }
  return count === 1 ? "1 Gerät" : `${count} Geräte`;
}

/** Eine Zeile mit Name, Verwendung, Umbenennen und Löschen. */
function EntryRow({
  name,
  used,
  canEdit,
  extra,
  onRename,
  onDelete,
}: {
  name: string;
  used: number;
  canEdit: boolean;
  extra?: string;
  onRename: (next: string) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [confirming, setConfirming] = useState(false);
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
          <span className="small">{[extra, usedText(used)].filter(Boolean).join(" · ")}</span>
        </span>
      )}
      {canEdit && !editing && (
        <span className="master-actions">
          {confirming ? (
            <>
              <span className="small">Wirklich löschen?</span>
              <button
                type="button"
                className="button button-danger"
                onClick={() =>
                  onDelete().catch((problem: unknown) => {
                    setError(errorText(problem, "Konnte nicht gelöscht werden."));
                    setConfirming(false);
                  })
                }
              >
                Ja, löschen
              </button>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setConfirming(false)}
              >
                Nein
              </button>
            </>
          ) : (
            <>
              <button type="button" className="row-button" onClick={() => setEditing(true)}>
                Umbenennen
              </button>
              <button
                type="button"
                className="row-button"
                disabled={used > 0}
                title={used > 0 ? "Wird noch verwendet" : undefined}
                onClick={() => setConfirming(true)}
              >
                Löschen
              </button>
            </>
          )}
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

/** IT-Bestand › Stammdaten: Hardware-Arten, Hersteller und Modelle, Gründe fürs Ausmustern. */
export function MasterDataPage({ roles }: { roles: readonly string[] }) {
  const canEdit = roles.includes(INVENTORY_EDITOR_ROLE);
  const [data, setData] = useState<MasterData | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [section, setSection] = useState<Section>("arten");
  const [storage, setStorage] = useState(false);

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

  return (
    <div className="page page-wide">
      <header className="page-head">
        <p className="module-label">IT-Bestand</p>
        <h1>Stammdaten</h1>
        <p className="page-sub">
          Auswahllisten für die Hardware. Einträge, die noch verwendet werden, lassen sich
          umbenennen, aber nicht löschen.
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
                onClick={() => setSection(entry.id)}
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
        </>
      )}
    </div>
  );
}
