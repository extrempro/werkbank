import { useEffect, useId, useState, type FormEvent } from "react";
import { errorText, formatDateTime } from "../../api";
import type { FeedbackMessage } from "../../components/Feedback";
import { InfoTip } from "../../components/InfoTip";
import { fetchVersions, nameVersion, type Version } from "./api";

/** Versionen einer Seite: ansehen, aktuellen Stand benennen. */
export function VersionsPanel({
  pageId,
  revision,
  canEdit,
  viewing,
  onView,
  onFeedback,
}: {
  pageId: string;
  /** Lädt neu, wenn sich der Stand der Seite ändert */
  revision: number;
  canEdit: boolean;
  viewing: number | null;
  onView: (version: Version) => void;
  onFeedback: (message: FeedbackMessage) => void;
}) {
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [reload, setReload] = useState(0);
  const inputId = useId();

  useEffect(() => {
    let active = true;
    fetchVersions(pageId).then(
      (result) => active && setVersions(result),
      () => active && setVersions([]),
    );
    return () => {
      active = false;
    };
  }, [pageId, revision, reload]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      return;
    }
    nameVersion(pageId, name.trim()).then(
      () => {
        setNaming(false);
        setName("");
        setReload(reload + 1);
        onFeedback({ kind: "status", text: "Der Stand wurde als Version gespeichert." });
      },
      (problem: unknown) =>
        onFeedback({
          kind: "alert",
          text: errorText(problem, "Die Version konnte nicht gespeichert werden."),
        }),
    );
  };

  return (
    <section className="panel doku-side-panel" aria-labelledby={`${inputId}-titel`}>
      <h2 id={`${inputId}-titel`}>
        Versionen <InfoTip term="doku.version" />
      </h2>
      <p className="small">
        Jede Änderung wird automatisch gespeichert. Nach einer Weile Bearbeitung entsteht eine
        Version; wichtige Stände kannst du benennen.
      </p>
      {canEdit &&
        (naming ? (
          <form className="doku-name-form" onSubmit={submit}>
            <label htmlFor={inputId}>Name der Version</label>
            <input
              id={inputId}
              value={name}
              maxLength={120}
              required
              autoFocus
              placeholder="z. B. Freigegeben"
              onChange={(event) => setName(event.target.value)}
            />
            <div className="doku-actions">
              <button type="submit" className="button button-primary">
                Benennen
              </button>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setNaming(false)}
              >
                Abbrechen
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className="button button-secondary" onClick={() => setNaming(true)}>
            Aktuellen Stand benennen
          </button>
        ))}
      {versions === null && <p role="status">Wird geladen …</p>}
      {versions?.length === 0 && <p className="small">Noch keine Versionen.</p>}
      {versions && versions.length > 0 && (
        <ol className="doku-versions">
          {versions.map((version) => (
            <li key={version.id} className={viewing === version.id ? "doku-version-open" : ""}>
              <button
                type="button"
                className="doku-version"
                aria-current={viewing === version.id ? "true" : undefined}
                onClick={() => onView(version)}
              >
                <span className="doku-version-when">
                  {formatDateTime(version.created_at)}
                  {version.name && <span className="doku-badge">benannt</span>}
                </span>
                {version.name && <strong>{version.name}</strong>}
                {version.authors && <span className="small">{version.authors}</span>}
                {version.note && <span className="small">{version.note}</span>}
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
