import type { Me } from "../api";
import { AccountSessions } from "../components/AccountSessions";
import { Avatar } from "../components/Avatar";
import { Link } from "../components/Link";
import { NotificationPreferences } from "../components/NotificationPreferences";
import { MenuSizeSwitch } from "../components/MenuSizeSwitch";
import { MenuSpacingSwitch } from "../components/MenuSpacingSwitch";
import { ThemeSwitch } from "../components/ThemeSwitch";
import { NEWS_PATH } from "../navigation";
import { HANDBOOK_PATH } from "../handbook";
import { NOTIFICATIONS_PATH } from "../notifications";
import { roleInfo } from "../user";

/** Eigene Angaben, Rollen, angemeldete Geräte und persönliche Einstellungen. */
export function AccountPage({ me }: { me: Me }) {
  return (
    <div className="page account">
      <header className="page-head">
        <h1>Konto</h1>
        <p className="page-sub">
          Deine Angaben, Rollen, angemeldeten Geräte und persönlichen Einstellungen.
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

      <section className="panel" aria-labelledby="konto-rollen">
        <div className="panel-head">
          <h2 id="konto-rollen">Meine Rollen</h2>
          <span className="small">vergeben in Microsoft Entra ID</span>
        </div>
        <ul className="rows">
          {me.roles.map((role) => {
            const info = roleInfo(role);
            return (
              <li key={role}>
                <span className="row-main">
                  <span className="row-title">{info.label}</span>
                  <span className="small">{info.description}</span>
                </span>
                <span className="mono small">{role}</span>
              </li>
            );
          })}
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

      <NotificationPreferences />
      <p>
        <Link to={NOTIFICATIONS_PATH}>Alle Benachrichtigungen ansehen</Link>
      </p>

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
