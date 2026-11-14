export function LoginPage() {
  return (
    <main className="login">
      <div className="login-card">
        <span className="brand-mark brand-mark-large" aria-hidden="true" />
        <h1>Werkbank</h1>
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
