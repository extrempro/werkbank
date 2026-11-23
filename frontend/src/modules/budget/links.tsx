import { useEffect, useState } from "react";
import { Icon } from "../../components/Icon";
import { Link } from "../../components/Link";
import { BUDGET_CONTRACTS_PATH, BUDGET_INVOICES_PATH, BUDGET_ITEMS_PATH } from "../../navigation";
import { documentUrl } from "./api";

/** Eigene Adressen für Budgetposten, Rechnungen und Verträge, zum Springen und Weitergeben. */
function withYear(path: string, year: number | null | undefined): string {
  return year ? `${path}?jahr=${year}` : path;
}

export function itemPath(id: number, year?: number | null): string {
  return withYear(`${BUDGET_ITEMS_PATH}/${id}`, year);
}

export function invoicePath(id: number, year?: number | null): string {
  return withYear(`${BUDGET_INVOICES_PATH}/${id}`, year);
}

export function contractPath(id: number): string {
  return `${BUDGET_CONTRACTS_PATH}/${id}`;
}

/** Geschäftsjahr aus `?jahr=` der Adresse; ohne lesbares Jahr null. */
export function linkedYear(text: string): number | null {
  return /^\d{4}$/.test(text) ? Number(text) : null;
}

type CopyState = "idle" | "done" | "failed";

/** Kopiert die volle Adresse in die Zwischenablage; der Zustand verfällt nach einigen Sekunden. */
function useCopy(): [CopyState, (path: string) => void] {
  const [state, setState] = useState<CopyState>("idle");
  useEffect(() => {
    if (state === "idle") {
      return;
    }
    const timer = window.setTimeout(() => setState("idle"), 4000);
    return () => window.clearTimeout(timer);
  }, [state]);
  const copy = (path: string) => {
    const clipboard = navigator.clipboard as Clipboard | undefined;
    if (!clipboard) {
      setState("failed");
      return;
    }
    clipboard.writeText(window.location.origin + path).then(
      () => setState("done"),
      () => setState("failed"),
    );
  };
  return [state, copy];
}

const COPY_DONE = "Link kopiert. Wer ihn öffnet, braucht eine Rolle im IT-Budget.";
const COPY_FAILED = "Kopieren ist hier nicht möglich. Markiere die Adresse und kopiere sie selbst.";

/** Adresse der Ansicht mit „Link kopieren“, z. B. zum Weiterschicken. */
export function CopyLinkBar({ path }: { path: string }) {
  const [state, copy] = useCopy();
  return (
    <div className="budget-link-bar">
      <span className="mono budget-link-url">{window.location.origin + path}</span>
      <button type="button" className="button button-secondary" onClick={() => copy(path)}>
        <Icon name="link" />
        Link kopieren
      </button>
      <p className="small budget-link-state" role="status">
        {state === "done" ? COPY_DONE : state === "failed" ? COPY_FAILED : ""}
      </p>
    </div>
  );
}

/** Kleiner Knopf, der den Link zu einem verknüpften Eintrag kopiert. */
function CopyLinkIcon({ path, what }: { path: string; what: string }) {
  const [state, copy] = useCopy();
  const label = `Link zu ${what} kopieren`;
  return (
    <>
      <button
        type="button"
        className="button button-secondary budget-icon-button"
        aria-label={label}
        title={label}
        onClick={() => copy(path)}
      >
        <Icon name={state === "done" ? "haken" : "link"} />
      </button>
      <span className="visually-hidden" role="status">
        {state === "done" ? COPY_DONE : state === "failed" ? COPY_FAILED : ""}
      </span>
    </>
  );
}

/** Symbol, das den PDF-Beleg einer Rechnung direkt öffnet. */
export function PdfLink({
  invoiceId,
  number,
  small = false,
}: {
  invoiceId: number;
  number: string;
  /** Kleiner, z. B. in einer Tabellenzeile */
  small?: boolean;
}) {
  const label = `PDF von Rechnung ${number} öffnen`;
  return (
    <a
      className={small ? "budget-pdf budget-pdf-small" : "budget-pdf"}
      href={documentUrl(invoiceId)}
      aria-label={label}
      title={label}
    >
      <Icon name="pdf" />
    </a>
  );
}

export interface LinkedEntry {
  key: string;
  /** Art des Eintrags, z. B. „Vertrag“ oder „Rechnung“ */
  kind: string;
  /** Nummer oder Titel, für Link und Kopierknopf */
  label: string;
  path: string;
  extra?: string;
  /** Gesetzt: Rechnung mit PDF-Beleg */
  pdf?: { invoiceId: number; number: string };
}

/** „Verknüpft“: Sprünge zu den zugehörigen Einträgen, je mit Link zum Kopieren und PDF. */
export function LinkedBlock({ entries, id }: { entries: LinkedEntry[]; id: string }) {
  return (
    <section className="budget-linked" aria-labelledby={id}>
      <h3 id={id}>Verknüpft</h3>
      {entries.length === 0 ? (
        <p className="small budget-muted">Noch nichts verknüpft.</p>
      ) : (
        <ul>
          {entries.map((entry) => (
            <li key={entry.key}>
              <span className="small budget-linked-kind">{entry.kind}</span>
              <Link to={entry.path}>{entry.label}</Link>
              {entry.extra && <span className="small budget-muted">{entry.extra}</span>}
              <span className="budget-linked-actions">
                <CopyLinkIcon path={entry.path} what={entry.label} />
                {entry.pdf && <PdfLink invoiceId={entry.pdf.invoiceId} number={entry.pdf.number} />}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
