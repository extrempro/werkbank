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
import { AiSettings } from "./AiSettings";
import { BrandingSettings } from "./BrandingSettings";
import { GeneralSettings } from "./GeneralSettings";
import { NinjaSettings } from "./NinjaSettings";
import { PeopleRoles } from "./PeopleRoles";

/** Seiten im Bereich Verwaltung (das Audit-Log hat eine eigene Seite). */
export type AdminSection = "allgemein" | "rollen" | "mail-teams" | "verbindungen";

const SECTIONS: Record<AdminSection, { title: string; path: string }> = {
  allgemein: { title: "Allgemein", path: "/verwaltung" },
  rollen: { title: "Rollen", path: "/verwaltung/rollen" },
  "mail-teams": { title: "Mail & Teams", path: "/verwaltung/mail-teams" },
  verbindungen: { title: "Verbindungen", path: "/verwaltung/verbindungen" },
};

export function AdminPage({ section = "allgemein" }: { section?: AdminSection }) {
  const [roles, setRoles] = useState<RoleInfo[] | null>(null);
  const [general, setGeneral] = useState<AdminSettings | null>(null);
  const [view, setView] = useState<"rolle" | "person">("rolle");
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

  const ready = status === "ready" && general !== null;

  return (
    <div className="page">
      <header className="page-head">
        <p className="module-label">Verwaltung</p>
        <h1>{SECTIONS[section].title}</h1>
      </header>

      {status === "loading" && <p role="status">Wird geladen …</p>}
      {status === "stepup" && (
        <div role="status">
          <p>
            Zur Sicherheit öffnet sich die Verwaltung nur kurz nach einer Anmeldung. Bitte melde
            dich erneut an.
          </p>
          <p>
            <a className="button button-primary" href={stepUpLoginUrl(SECTIONS[section].path)}>
              Erneut anmelden
            </a>
          </p>
        </div>
      )}
      {status === "forbidden" && <p>Keine Berechtigung. Die Verwaltung sehen nur Admins.</p>}
      {status === "error" && <p role="alert">Die Verwaltung konnte nicht geladen werden.</p>}

      {ready && section === "allgemein" && (
        <div className="admin-section">
          <BrandingSettings />
          <GeneralSettings
            settings={general}
            onChange={setGeneral}
            parts={["aufbewahrung", "ablauf"]}
          />
        </div>
      )}
      {ready && section === "mail-teams" && (
        <div className="admin-section">
          <GeneralSettings
            settings={general}
            onChange={setGeneral}
            parts={["smtp", "teams", "push"]}
          />
        </div>
      )}
      {ready && section === "verbindungen" && (
        <div className="admin-section">
          {general.ai && <AiSettings ai={general.ai} onChange={setGeneral} />}
          <GeneralSettings
            settings={general}
            onChange={setGeneral}
            parts={["netbox", "internet"]}
          />
          <NinjaSettings />
        </div>
      )}

      {status === "ready" && section === "rollen" && (
        <div className="admin-section">
          <p className="note">
            Rollen werden in Microsoft Entra ID vergeben (App-Rollen der Unternehmensanwendung
            „Werkbank“). Diese Übersicht zeigt, wer eine Rolle bei der letzten Anmeldung hatte, und
            dient nur zur Information. Wer sich noch nie angemeldet hat, steht hier nicht.
          </p>
          <div className="chips" role="group" aria-label="Ansicht der Rollen">
            <button
              type="button"
              className="chip chip-filter"
              aria-pressed={view === "rolle"}
              onClick={() => setView("rolle")}
            >
              Nach Rolle
            </button>
            <button
              type="button"
              className="chip chip-filter"
              aria-pressed={view === "person"}
              onClick={() => setView("person")}
            >
              Nach Person
            </button>
          </div>
          {view === "person" && <PeopleRoles />}
          {view === "rolle" && roles && (
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
        </div>
      )}
    </div>
  );
}
