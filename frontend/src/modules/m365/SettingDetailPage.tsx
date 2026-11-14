import { useEffect, useState } from "react";
import { ApiError, formatDateTime } from "../../api";
import { Link } from "../../components/Link";
import {
  fetchSetting,
  formatValue,
  kindLabel,
  settingTitle,
  statusLabel,
  type SettingDetail,
} from "./api";

interface SettingDetailPageProps {
  id: number;
}

export function SettingDetailPage({ id }: SettingDetailPageProps) {
  const [detail, setDetail] = useState<SettingDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing" | "error">("loading");

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
  }, [id]);

  const back = (
    <p>
      <Link to="/m365/einstellungen">Zurück zu den Einstellungen</Link>
    </p>
  );

  if (status !== "ready" || !detail) {
    return (
      <>
        <p className="module-label">M365-Konfiguration</p>
        <h1>Einstellung</h1>
        {status === "loading" && <p role="status">Wird geladen …</p>}
        {status === "missing" && <p>Diese Einstellung gibt es nicht.</p>}
        {status === "error" && <p role="alert">Die Einstellung konnte nicht geladen werden.</p>}
        {back}
      </>
    );
  }

  const { setting, versions, changes } = detail;
  return (
    <>
      <p className="module-label">M365-Konfiguration</p>
      <h1>{settingTitle(setting)}</h1>
      {back}

      <section className="card" aria-labelledby="wert-titel">
        <h2 id="wert-titel">Aktueller Wert</h2>
        {setting.active ? (
          <pre className="value-block" tabIndex={0}>
            {formatValue(setting.value, true)}
          </pre>
        ) : (
          <p>Diese Einstellung war im letzten Abruf nicht mehr vorhanden.</p>
        )}
        <dl className="facts">
          <div>
            <dt>Gültig seit</dt>
            <dd>{setting.active ? formatDateTime(setting.valid_from) : "–"}</dd>
          </div>
          <div>
            <dt>Workload</dt>
            <dd>{setting.workload}</dd>
          </div>
          <div>
            <dt>Bereich</dt>
            <dd>{setting.area}</dd>
          </div>
          <div>
            <dt>Pfad</dt>
            <dd className="mono path">{setting.path}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="verlauf-titel">
        <h2 id="verlauf-titel">Verlauf</h2>
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
      </section>

      <section aria-labelledby="aenderungen-titel">
        <h2 id="aenderungen-titel">Erkannte Änderungen</h2>
        {changes.length === 0 ? (
          <p className="empty">Seit dem Ausgangsstand wurde keine Änderung erkannt.</p>
        ) : (
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Erkannte Änderungen">
            <table>
              <caption className="visually-hidden">Änderungen, neueste zuerst</caption>
              <thead>
                <tr>
                  <th scope="col">Erkannt</th>
                  <th scope="col">Art</th>
                  <th scope="col">Geändert von</th>
                  <th scope="col">Bewertung</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((change) => (
                  <tr key={change.id}>
                    <td className="nowrap">{formatDateTime(change.detected_at)}</td>
                    <td>{kindLabel(change.kind)}</td>
                    <td>{change.changed_by ?? "unbekannt"}</td>
                    <td>
                      {statusLabel(change.status)}
                      {change.comment && <span className="small path">{change.comment}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
