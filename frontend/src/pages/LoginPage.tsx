import { loginUrl } from "../api";
import { surfaceLogo, useBranding } from "../branding";
import { BrandMark } from "../components/Brand";
import { useTheme } from "../theme";

interface LoginPageProps {
  /** Die Sitzung ist abgelaufen, während die Werkbank offen war. */
  expired?: boolean;
}

export function LoginPage({ expired = false }: LoginPageProps) {
  const branding = useBranding();
  const theme = useTheme();
  return (
    <main className="login">
      <div className="login-card">
        <BrandMark logoUrl={surfaceLogo(branding, theme)} size="large" />
        <h1>{branding.app_name}</h1>
        {expired ? (
          <p className="hint-box hint-warn" role="alert">
            Deine Sitzung ist abgelaufen. Melde dich erneut an, dann geht es auf derselben Seite
            weiter.
          </p>
        ) : (
          <p>Melde dich mit deinem Firmenkonto an.</p>
        )}
        <a
          className="button button-primary button-wide"
          href={expired ? loginUrl(window.location.pathname) : "/auth/login"}
        >
          Mit Microsoft anmelden
        </a>
        <p className="login-hint">
          Die Anmeldung erfolgt über Microsoft Entra ID. Die Werkbank speichert nur, was für
          Anmeldung, Berechtigungen und Nachvollziehbarkeit nötig ist.
        </p>
      </div>
    </main>
  );
}
