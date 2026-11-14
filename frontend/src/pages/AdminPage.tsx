import { useEffect, useState } from "react";
import { ApiError, fetchRoles, formatDateTime, type RoleInfo } from "../api";

export function AdminPage() {
  const [roles, setRoles] = useState<RoleInfo[] | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "forbidden" | "error">("loading");

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
          setStatus(error instanceof ApiError && error.status === 403 ? "forbidden" : "error");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <p className="module-label">Verwaltung</p>
      <h1>Einstellungen der Werkbank</h1>

      <section aria-labelledby="rollen-titel">
        <h2 id="rollen-titel">Rollen</h2>
        <p className="note">
          Rollen werden in Microsoft Entra ID vergeben (App-Rollen der Unternehmensanwendung
          „Werkbank“). Diese Übersicht zeigt, wer eine Rolle bei der letzten Anmeldung hatte, und
          dient nur zur Information.
        </p>
        {status === "loading" && <p role="status">Wird geladen …</p>}
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
                              {holder.display_name}{" "}
                              <span className="small">({formatDateTime(holder.last_login_at)})</span>
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
    </>
  );
}
