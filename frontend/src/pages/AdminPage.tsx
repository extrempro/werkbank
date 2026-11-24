import { useEffect, useState } from "react";
import { ApiError, fetchAdminSettings, stepUpLoginUrl, type AdminSettings } from "../api";
import { AiSettings } from "./AiSettings";
import { BrandingSettings } from "./BrandingSettings";
import { CollectorCheckPanel } from "./CollectorCheck";
import { GeneralSettings } from "./GeneralSettings";
import { NinjaSettings } from "./NinjaSettings";
import { Permissions } from "./Permissions";

/** Seiten im Bereich Verwaltung (das Audit-Log hat eine eigene Seite). */
export type AdminSection = "allgemein" | "berechtigungen" | "mail-teams" | "verbindungen";

const SECTIONS: Record<AdminSection, { title: string; path: string }> = {
  allgemein: { title: "Allgemein", path: "/verwaltung" },
  berechtigungen: { title: "Berechtigungen", path: "/verwaltung/berechtigungen" },
  "mail-teams": { title: "Mail & Teams", path: "/verwaltung/mail-teams" },
  verbindungen: { title: "Verbindungen", path: "/verwaltung/verbindungen" },
};

export function AdminPage({ section = "allgemein" }: { section?: AdminSection }) {
  const [general, setGeneral] = useState<AdminSettings | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "stepup" | "forbidden" | "error">(
    "loading",
  );

  useEffect(() => {
    let active = true;
    fetchAdminSettings()
      .then((result) => {
        if (active && result && typeof result === "object" && "smtp" in result) {
          setGeneral(result);
          setStatus("ready");
        } else if (active) {
          setStatus("error");
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
          <CollectorCheckPanel />
          {general.ai && <AiSettings ai={general.ai} onChange={setGeneral} />}
          <GeneralSettings
            settings={general}
            onChange={setGeneral}
            parts={["netbox", "zabbix", "internet"]}
          />
          <NinjaSettings />
        </div>
      )}

      {ready && section === "berechtigungen" && <Permissions />}
    </div>
  );
}
