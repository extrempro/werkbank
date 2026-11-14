import { useEffect, useState } from "react";
import { ApiError, formatDateTime, type Me } from "../../api";
import { Link } from "../../components/Link";
import {
  criticalityLabel,
  fetchSetting,
  formatMetaValue,
  formatValue,
  kindLabel,
  metaFieldLabel,
  settingTitle,
  statusClass,
  statusLabel,
  workloadLabel,
  type SettingDetail,
} from "./api";
import { MetaForm } from "./MetaForm";

interface SettingDetailPageProps {
  id: number;
  me: Me;
}

export function SettingDetailPage({ id, me }: SettingDetailPageProps) {
  const [detail, setDetail] = useState<SettingDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState(false);
  const canEdit = me.roles.includes("Config.Reviewer");

  useEffect(() => {
    let active = true;
    fetchSetting(id)
      .then((result) => {
        if (active) {
          setDetail(result);
          setStatus("ready");
        }
      })
      .catch((error: unknown) => {
        if (active) {
          const missing = error instanceof ApiError && [404, 422].includes(error.status);
          setStatus(missing ? "missing" : "error");
        }
      });
    return () => {
      active = false;
    };
  }, [id, reloadKey]);

  const back = (
    <p className="back">
      <Link to="/m365/einstellungen">Zurück zu den Einstellungen</Link>
    </p>
  );

  if (status !== "ready" || !detail) {
    return (
      <div className="page">
        <header className="page-head">
          <p className="module-label">M365-Konfiguration</p>
          <h1>Einstellung</h1>
        </header>
        {status === "loading" && <p role="status">Wird geladen …</p>}
        {status === "missing" && <p>Diese Einstellung gibt es nicht.</p>}
        {status === "error" && <p role="alert">Die Einstellung konnte nicht geladen werden.</p>}
        {back}
      </div>
    );
  }

  const { setting, meta, versions, changes } = detail;
  const history = detail.meta_history;
  const crumbs = [workloadLabel(setting.workload), setting.area, setting.object_name]
    .filter((part): part is string => Boolean(part))
    .join(" › ");
  const fromEvergreen = meta.target_set && (meta.target_source ?? "").startsWith("Evergreen");

  return (
    <div className="page">
      {back}
      <article className="panel setting" aria-labelledby="einstellung-titel">
        <header className="setting-head">
          <p className="module-label">M365-Konfiguration</p>
          <p className="small">{crumbs}</p>
          <h1 id="einstellung-titel">{settingTitle(setting)}</h1>
          <p className="mono small path">{setting.path}</p>
        </header>

        <dl className="strip">
          <div className="strip-wide">
            <dt>Aktueller Wert</dt>
            <dd>
              {setting.active ? (
                <pre className="value-block" tabIndex={0}>
                  {formatValue(setting.value, true)}
                </pre>
              ) : (
                "Im letzten Abruf nicht mehr vorhanden"
              )}
            </dd>
          </div>
          <div>
            <dt>Gültig seit</dt>
            <dd>{setting.active ? formatDateTime(setting.valid_from) : "–"}</dd>
          </div>
          <div>
            <dt>Kritikalität</dt>
            <dd>
              {meta.criticality ? (
                <span className={meta.criticality === "hoch" ? "pill pill-bad" : "pill pill-todo"}>
                  {criticalityLabel(meta.criticality)}
                </span>
              ) : (
                "–"
              )}
            </dd>
          </div>
          <div>
            <dt>Soll-Wert</dt>
            <dd>
              {meta.target_set ? (
                <>
                  <span className="mono">{formatValue(meta.target_value)}</span>{" "}
                  <span className={setting.deviates ? "mark-bad" : "mark-ok"}>
                    {setting.deviates ? "✗ weicht ab" : "✓ eingehalten"}
                  </span>
                </>
              ) : (
                "Nicht festgelegt"
              )}
            </dd>
          </div>
        </dl>

        {setting.deviates && (
          <p className="hint-box hint-bad" role="status">
            <strong>Weicht vom Soll-Wert ab.</strong> Soll: {formatValue(meta.target_value)}, Ist:{" "}
            {formatValue(setting.value)}
          </p>
        )}

        {fromEvergreen && (
          <div className="hint-box hint-evergreen">
            <p className="hint-title">Geregelt durch Evergreen-Vorgang</p>
            <p>
              Der Soll-Wert stammt aus {meta.target_source}.{" "}
              {setting.deviates ? "Der Wert weicht vom Beschluss ab." : "Der Beschluss ist eingehalten."}
            </p>
            <Link to="/evergreen">Zu den Vorgängen →</Link>
          </div>
        )}

        <section className="setting-section" aria-labelledby="angaben-titel">
          <div className="section-head">
            <h2 id="angaben-titel">Beschreibung und Vorgaben</h2>
            {canEdit && !editing && (
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setEditing(true)}
              >
                Angaben bearbeiten
              </button>
            )}
          </div>
          {editing ? (
            <MetaForm
              settingId={setting.id}
              meta={meta}
              onSaved={() => {
                setEditing(false);
                setReloadKey((key) => key + 1);
              }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <>
              <p className="text">
                {meta.description ?? (
                  <span className="empty">Noch keine Beschreibung hinterlegt.</span>
                )}
              </p>
              <h3>Warum bei uns so</h3>
              <p className="text">
                {meta.reasoning ?? <span className="empty">Noch keine Begründung hinterlegt.</span>}
              </p>
              <dl className="detail-facts">
                <div>
                  <dt>Verantwortlich</dt>
                  <dd>{meta.owner ?? "–"}</dd>
                </div>
                <div>
                  <dt>Microsoft Learn</dt>
                  <dd>
                    {meta.learn_url ? (
                      <a href={meta.learn_url} rel="noreferrer noopener" target="_blank">
                        Dokumentation öffnen (neues Fenster)
                      </a>
                    ) : (
                      "–"
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Bereich</dt>
                  <dd>{setting.area}</dd>
                </div>
              </dl>
            </>
          )}
        </section>

        <section className="setting-section" aria-labelledby="verlauf-titel">
          <div className="section-head">
            <h2 id="verlauf-titel">Verlauf</h2>
            <span className="small">
              {changes.length === 1 ? "1 Änderung" : `${changes.length} Änderungen`}
            </span>
          </div>
          {changes.length === 0 ? (
            <p className="empty">Seit dem Ausgangsstand wurde keine Änderung erkannt.</p>
          ) : (
            <ol className="timeline">
              {changes.map((change) => (
                <li key={change.id} className={`timeline-${change.status}`}>
                  <div className="timeline-head">
                    <strong>{formatDateTime(change.detected_at)}</strong>
                    <span>{kindLabel(change.kind)}</span>
                    <span className={statusClass(change.status)}>
                      {statusLabel(change.status)}
                    </span>
                  </div>
                  <div className="timeline-diff mono">
                    {change.kind !== "neu" && (
                      <span className="diff-old">
                        <span aria-hidden="true">− </span>
                        <span className="visually-hidden">Vorher: </span>
                        {formatValue(change.old_value)}
                      </span>
                    )}
                    {change.kind !== "entfernt" && (
                      <span className="diff-new">
                        <span aria-hidden="true">+ </span>
                        <span className="visually-hidden">Nachher: </span>
                        {formatValue(change.new_value)}
                      </span>
                    )}
                  </div>
                  <p className="small">
                    von {change.changed_by ?? "unbekannt"}
                    {change.reviewed_by && ` · bewertet von ${change.reviewed_by}`}
                    {change.comment && ` · ${change.comment}`}
                  </p>
                </li>
              ))}
            </ol>
          )}

          <details className="more">
            <summary>Alle Werte mit Gültigkeit</summary>
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Verlauf der Werte">
              <table>
                <caption className="visually-hidden">Werte der Einstellung, neueste zuerst</caption>
                <thead>
                  <tr>
                    <th scope="col">Gültig von</th>
                    <th scope="col">Gültig bis</th>
                    <th scope="col">Wert</th>
                  </tr>
                </thead>
                <tbody>
                  {versions.map((version) => (
                    <tr key={version.id}>
                      <td className="nowrap">{formatDateTime(version.valid_from)}</td>
                      <td className="nowrap">
                        {version.valid_to ? formatDateTime(version.valid_to) : "heute"}
                      </td>
                      <td className="value">{formatValue(version.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>

        {history.length > 0 && (
          <section className="setting-section" aria-labelledby="angaben-verlauf-titel">
            <div className="section-head">
              <h2 id="angaben-verlauf-titel">Verlauf der Angaben</h2>
            </div>
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Verlauf der Angaben">
              <table>
                <caption className="visually-hidden">
                  Änderungen an den Angaben, neueste zuerst
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Zeitpunkt</th>
                    <th scope="col">Person</th>
                    <th scope="col">Feld</th>
                    <th scope="col">Vorher</th>
                    <th scope="col">Nachher</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((entry) => (
                    <tr key={entry.id}>
                      <td className="nowrap">{formatDateTime(entry.changed_at)}</td>
                      <td>{entry.user ?? "–"}</td>
                      <td>{metaFieldLabel(entry.field)}</td>
                      <td className="value">{formatMetaValue(entry.field, entry.old_value)}</td>
                      <td className="value">{formatMetaValue(entry.field, entry.new_value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </article>
    </div>
  );
}
