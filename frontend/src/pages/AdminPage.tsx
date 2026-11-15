import { useEffect, useState } from "react";
import { Avatar } from "../components/Avatar";
import {
  ApiError,
  fetchAdminSettings,
  fetchRoles,
  formatDateTime,
  stepUpLoginUrl,
  type AdminSettings,
  type RoleInfo,
} from "../api";
import { GeneralSettings } from "./GeneralSettings";

export function AdminPage() {
  const [roles, setRoles] = useState<RoleInfo[] | null>(null);
  const [general, setGeneral] = useState<AdminSettings | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "stepup" | "forbidden" | "error">(
    "loading",
  );

  useEffect(() => {
    let active = true;
    fetchRoles()
      .then((result) => {
        if (active) {
          setRoles(result);
          setStatus("ready");
        }
      })
      .catch((error: unknown) => {
        if (active) {
          if (error instanceof ApiError && error.stepUpRequired) {
            setStatus("stepup");
          } else if (error instanceof ApiError && error.status === 403) {
            setStatus("forbidden");
          } else {
            setStatus("error");
          }
        }
      });
    fetchAdminSettings()
      .then((result) => {
        if (active && result && typeof result === "object" && "smtp" in result) {
          setGeneral(result);
        }
      })
      .catch(() => {
        // Die Meldung zur Anmeldung bzw. zum Fehler kommt vom Abruf der Rollen.
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="page">
      <header className="page-head">
        <p className="module-label">Verwaltung</p>
        <h1>Einstellungen der Werkbank</h1>
      </header>

      {status === "ready" && general && (
        <section className="admin-section" aria-labelledby="allgemein-titel">
          <h2 id="allgemein-titel">Allgemein</h2>
          <GeneralSettings settings={general} onChange={setGeneral} />
        </section>
      )}

      <section aria-labelledby="rollen-titel">
        <h2 id="rollen-titel">Rollen</h2>
        <p className="note">
          Rollen werden in Microsoft Entra ID vergeben (App-Rollen der Unternehmensanwendung
          „Werkbank“). Diese Übersicht zeigt, wer eine Rolle bei der letzten Anmeldung hatte, und
          dient nur zur Information.
        </p>
        {status === "loading" && <p role="status">Wird geladen …</p>}
        {status === "stepup" && (
          <div role="status">
            <p>
              Zur Sicherheit öffnet sich die Verwaltung nur kurz nach einer Anmeldung. Bitte melde
              dich erneut an.
            </p>
            <p>
              <a className="button button-primary" href={stepUpLoginUrl("/verwaltung")}>
                Erneut anmelden
              </a>
            </p>
          </div>
        )}
        {status === "forbidden" && <p>Keine Berechtigung. Die Verwaltung sehen nur Admins.</p>}
        {status === "error" && <p role="alert">Die Rollen konnten nicht geladen werden.</p>}
        {status === "ready" && roles && (
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Rollen">
            <table>
              <caption className="visually-hidden">App-Rollen und Personen</caption>
              <thead>
                <tr>
                  <th scope="col">Rolle</th>
                  <th scope="col">Darf</th>
                  <th scope="col">Personen (letzte Anmeldung)</th>
                </tr>
              </thead>
              <tbody>
                {roles.map((role) => (
                  <tr key={role.value}>
                    <td>
                      <span className="role-label">{role.label}</span>
                      <span className="mono small">{role.value}</span>
                    </td>
                    <td>{role.description}</td>
                    <td>
                      {role.holders.length === 0 ? (
                        <span className="empty">niemand</span>
                      ) : (
                        <ul className="plain">
                          {role.holders.map((holder) => (
                            <li key={`${role.value}-${holder.display_name}-${holder.email}`}>
                              <Avatar name={holder.display_name} url={holder.avatar_url} />{" "}
                              {holder.display_name}{" "}
                              <span className="small">
                                ({formatDateTime(holder.last_login_at)})
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
