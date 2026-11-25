import type { Me } from "../api";
import { AccountSessions } from "../components/AccountSessions";
import { Avatar } from "../components/Avatar";
import { Link } from "../components/Link";
import { MenuSizeSwitch } from "../components/MenuSizeSwitch";
import { MenuSpacingSwitch } from "../components/MenuSpacingSwitch";
import { TicketBarSettings } from "../modules/tickets/TicketBarSettings";
import { ThemeSwitch } from "../components/ThemeSwitch";
import { NEWS_PATH } from "../navigation";
import { HANDBOOK_PATH } from "../handbook";
import { NOTIFICATION_SETTINGS_PATH, NOTIFICATIONS_PATH } from "../notifications";
import { ADMIN_ROLE, myRights } from "../user";

/** Eigene Angaben, Rollen, angemeldete Geräte und persönliche Einstellungen. */
export function AccountPage({ me, tickets = false }: { me: Me; tickets?: boolean }) {
  const rights = myRights(me.roles);
  return (
    <div className="page account">
      <header className="page-head">
        <h1>Konto</h1>
        <p className="page-sub">
          Deine Angaben, Rechte, angemeldeten Geräte und persönlichen Einstellungen.
        </p>
      </header>

      <section className="panel account-profile" aria-label="Profil">
        <Avatar name={me.display_name} url={me.avatar_url} size="large" />
        <div>
          <p className="account-name">{me.display_name}</p>
          <p className="small">{me.email ?? "Keine E-Mail-Adresse hinterlegt"}</p>
          <p className="small">
            Name, E-Mail-Adresse und Bild kommen aus Microsoft Entra ID und werden bei jeder
            Anmeldung übernommen.
          </p>
        </div>
      </section>

      <section className="panel" aria-labelledby="konto-rechte">
        <div className="panel-head">
          <h2 id="konto-rechte">Meine Rechte</h2>
          <span className="small">vergeben unter Verwaltung › Berechtigungen</span>
        </div>
        <ul className="rows">
          {me.roles.includes(ADMIN_ROLE) && (
            <li>
              <span className="row-main">
                <span className="row-title">Verwaltung</span>
                <span className="small">
                  Du bist in der Admin-Gruppe. Das kommt aus Entra und lässt sich in der Werkbank
                  nicht ändern.
                </span>
              </span>
            </li>
          )}
          {rights.map((right) => (
            <li key={right.area}>
              <span className="row-main">
                <span className="row-title">{right.area}</span>
                <span className="small">{right.description}</span>
              </span>
              <span className="pill pill-neutral">{right.level}</span>
            </li>
          ))}
          {rights.length === 0 && !me.roles.includes(ADMIN_ROLE) && (
            <li className="empty">Du hast noch keine Rechte in einem Bereich.</li>
          )}
        </ul>
      </section>

      <AccountSessions />

      <section className="panel" aria-labelledby="konto-darstellung">
        <div className="panel-head">
          <h2 id="konto-darstellung">Darstellung</h2>
          <span className="small">gilt für diesen Browser</span>
        </div>
        <div className="detail-body">
          <ThemeSwitch />
          <MenuSizeSwitch />
          <MenuSpacingSwitch />
        </div>
      </section>

      {tickets && <TicketBarSettings />}

      <section className="panel" aria-labelledby="konto-benachrichtigungen">
        <div className="panel-head">
          <h2 id="konto-benachrichtigungen">Benachrichtigungen</h2>
        </div>
        <div className="detail-body">
          <p>
            Welche Benachrichtigungen du in der Glocke, per Mail, in Teams und als Push bekommst,
            welcher Ton dazu erklingt und welche Geräte Push bekommen.
          </p>
          <p className="handbook-links">
            <Link to={NOTIFICATION_SETTINGS_PATH}>Benachrichtigungen einstellen</Link>
            <Link to={NOTIFICATIONS_PATH}>Alle Benachrichtigungen ansehen</Link>
          </p>
        </div>
      </section>

      <section className="panel" aria-labelledby="konto-version">
        <div className="panel-head">
          <h2 id="konto-version">Werkbank</h2>
        </div>
        <div className="detail-body">
          <p>
            Version <strong>{me.version ?? "unbekannt"}</strong>
          </p>
          <p className="handbook-links">
            <Link to={NEWS_PATH}>Neuigkeiten ansehen</Link>
            <Link to={HANDBOOK_PATH}>Handbuch öffnen</Link>
          </p>
        </div>
      </section>
    </div>
  );
}
