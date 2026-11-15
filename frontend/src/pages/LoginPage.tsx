import { surfaceLogo, useBranding } from "../branding";
import { BrandMark } from "../components/Brand";
import { useTheme } from "../theme";

export function LoginPage() {
  const branding = useBranding();
  const theme = useTheme();
  return (
    <main className="login">
      <div className="login-card">
        <BrandMark logoUrl={surfaceLogo(branding, theme)} size="large" />
        <h1>{branding.app_name}</h1>
        <p>Melde dich mit deinem Firmenkonto an.</p>
        <a className="button button-primary button-wide" href="/auth/login">
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
