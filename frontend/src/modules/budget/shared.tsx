import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { errorText } from "../../api";
import { ConfirmButton } from "../../components/ConfirmDialog";
import { BUDGET_EDITOR_ROLES, fetchBudgetSettings, type BudgetSettings } from "./api";

interface HeadProps {
  title: string;
  /** Erklärung unter der Kopfzeile. */
  sub?: ReactNode;
  /** Bedienelemente rechts, z. B. die Wahl des Geschäftsjahrs. */
  children?: ReactNode;
}

/** Gemeinsamer Kopf der Budget-Seiten: Titel, Kostenstelle und laufendes Geschäftsjahr. */
export function BudgetHead({ title, sub, children }: HeadProps) {
  const [settings, setSettings] = useState<BudgetSettings | null>(null);

  useEffect(() => {
    let active = true;
    // Die Zeile mit Kostenstelle und Jahr ist eine Zugabe: Ohne sie bleibt die Seite nutzbar.
    fetchBudgetSettings()
      .then((result) => {
        if (active) {
          setSettings(result);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  return (
    <header className="page-head budget-head">
      <div>
        <p className="module-label">IT-Budget</p>
        <h1>{title}</h1>
        {settings && (
          <p className="page-sub budget-meta">
            {settings.cost_center ? `Kostenstelle ${settings.cost_center} · ` : ""}
            {settings.year_label} {settings.current_year_name} läuft
          </p>
        )}
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {children}
    </header>
  );
}

/** Hinweis für Personen, die das Budget nur lesen dürfen. */
export function ReadOnlyNote({ roles }: { roles: readonly string[] }) {
  if (BUDGET_EDITOR_ROLES.some((role) => roles.includes(role))) {
    return null;
  }
  return (
    <p className="hint-box budget-readonly">
      <strong>Nur Lesezugriff.</strong> Du siehst alle Zahlen, Verträge und Partner, kannst aber
      nichts ändern. Die Rolle kommt aus der Entra-Gruppe.
    </p>
  );
}

/**
 * Bringt ein eben geöffnetes Formular in den Blick und setzt den Fokus darauf, damit es auch
 * unter einer langen Tabelle oder mit Tastatur und Screenreader nicht übersehen wird.
 */
export function useRevealOnMount<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    element.focus();
    if (typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ block: "nearest" });
    }
  }, []);
  return ref;
}

interface DeleteProps {
  /** Was gelöscht wird: „Vertrag Wartung“. Steht in der Frage und für Screenreader am Knopf. */
  what: string;
  /** Was das Löschen sonst noch bewirkt, ein Satz; ohne Angabe ein allgemeiner Satz. */
  detail?: string;
  run: () => Promise<unknown>;
  onDeleted: () => void;
  disabled?: boolean;
}

/** „Löschen“ mit Bestätigungsdialog. Lehnt der Server ab, steht der Grund daneben. */
export function DeleteButton({ what, detail, run, onDeleted, disabled = false }: DeleteProps) {
  const [error, setError] = useState<string | null>(null);

  const onDelete = () => {
    setError(null);
    return run()
      .then(onDeleted)
      .catch((problem: unknown) => {
        setError(errorText(problem, "Das Löschen hat nicht geklappt."));
      });
  };

  return (
    <span className="budget-delete">
      <ConfirmButton
        className="button button-secondary"
        aria-label={`${what} löschen`}
        disabled={disabled}
        confirm={{
          title: `${what} löschen?`,
          text: detail ?? `${what} wird endgültig gelöscht.`,
          action: "Löschen",
          danger: true,
        }}
        onConfirm={onDelete}
      >
        Löschen
      </ConfirmButton>
      {error && (
        <span role="alert" className="small budget-bad budget-delete-error">
          {error}
        </span>
      )}
    </span>
  );
}

export { FormStep } from "../../components/FormStep";
