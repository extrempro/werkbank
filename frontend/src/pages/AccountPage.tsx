import { formatDateTime, type Me } from "../api";
import { Avatar } from "../components/Avatar";
import { Link } from "../components/Link";
import { NotificationPreferences } from "../components/NotificationPreferences";
import { ThemeSwitch } from "../components/ThemeSwitch";
import { NEWS_PATH } from "../navigation";
import { HANDBOOK_PATH } from "../handbook";
import { NOTIFICATIONS_PATH } from "../notifications";
import { roleInfo } from "../user";

/** Eigene Angaben, Rollen, Sitzung und persönliche Einstellungen. */
export function AccountPage({ me }: { me: Me }) {
  return (
    <div className="page account">
      <header className="page-head">
        <h1>Konto</h1>
        <p className="page-sub">Deine Angaben, Rollen und persönlichen Einstellungen.</p>
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

      <section className="panel" aria-labelledby="konto-sitzung">
        <div className="panel-head">
          <h2 id="konto-sitzung">Sitzung</h2>
        </div>
        <div className="detail-body">
          <dl className="detail-facts">
            <div>
              <dt>Angemeldet seit</dt>
              <dd>{formatDateTime(me.authenticated_at)}</dd>
            </div>
            {me.session_expires_at && (
              <div>
                <dt>Läuft spätestens ab</dt>
                <dd>{formatDateTime(me.session_expires_at)}</dd>
              </div>
            )}
          </dl>
          <p className="small">
            Ohne Aktivität endet die Sitzung früher. Eine neue Anmeldung beendet die bisherige
            Sitzung dieses Browsers.
          </p>
          <form method="post" action="/auth/logout">
            <button type="submit" className="button button-secondary">
              Abmelden
            </button>
          </form>
        </div>
      </section>

      <section className="panel" aria-labelledby="konto-darstellung">
        <div className="panel-head">
          <h2 id="konto-darstellung">Darstellung</h2>
          <span className="small">gilt für diesen Browser</span>
        </div>
        <div className="detail-body">
          <ThemeSwitch />
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
