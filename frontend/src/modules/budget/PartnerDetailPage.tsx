import { useEffect, useState } from "react";
import { ApiError, errorText } from "../../api";
import { ConfirmButton } from "../../components/ConfirmDialog";
import { Link } from "../../components/Link";
import { BUDGET_CONTRACTS_PATH, BUDGET_PARTNERS_PATH } from "../../navigation";
import { navigate } from "../../router";
import {
  contractItemsText,
  BUDGET_MANAGER_ROLE,
  fetchPartnerDetail,
  fetchPartners,
  formatBudgetDay,
  formatEuro,
  mergePartner,
  partnerRoles,
  STATUS_LABELS,
  type Partner,
  type PartnerDetail,
} from "./api";
import { BudgetHead, ReadOnlyNote } from "./shared";

interface Props {
  roles: readonly string[];
  partnerId: number;
}

/** IT-Budget › Partner › eine Firma: ihre Verträge, Budgetposten und Rechnungen; zusammenlegen. */
export function PartnerDetailPage({ roles, partnerId }: Props) {
  const canMerge = roles.includes(BUDGET_MANAGER_ROLE);
  const [detail, setDetail] = useState<PartnerDetail | null>(null);
  const [others, setOthers] = useState<Partner[]>([]);
  const [state, setState] = useState<"laden" | "fehler" | "fehlt" | "da">("laden");
  const [target, setTarget] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([fetchPartnerDetail(partnerId), fetchPartners()])
      .then(([result, partners]) => {
        if (active) {
          setDetail(result);
          setOthers(partners.filter((entry) => entry.id !== partnerId));
          setState("da");
        }
      })
      .catch((problem: unknown) => {
        if (active) {
          const missing = problem instanceof ApiError && problem.status === 404;
          setState(missing ? "fehlt" : "fehler");
        }
      });
    return () => {
      active = false;
    };
  }, [partnerId]);

  const onMerge = () => {
    if (!detail || !target) {
      return;
    }
    setBusy(true);
    setError(null);
    return mergePartner(detail.partner.id, Number(target))
      .then((result) => navigate(`${BUDGET_PARTNERS_PATH}/${result.partner.id}`))
      .catch((problem: unknown) => {
        setError(errorText(problem, "Die Partner konnten nicht zusammengelegt werden."));
        setBusy(false);
      });
  };

  const partner = detail?.partner;
  // Budgetposten der Firma: als Partner des Postens oder mit ihren Verträgen und Rechnungen
  const items = new Map<string, { own: boolean; contracts: number; invoices: number }>();
  for (const item of detail?.items ?? []) {
    const key = `${item.account_number} ${item.account_name} · ${item.name}`;
    items.set(key, { own: true, contracts: 0, invoices: 0 });
  }
  for (const entry of detail?.contracts ?? []) {
    for (const item of entry.items) {
      const key = `${item.account_number} ${item.account_name} · ${item.name}`;
      const row = items.get(key) ?? { own: false, contracts: 0, invoices: 0 };
      items.set(key, { ...row, contracts: row.contracts + 1 });
    }
  }
  for (const entry of detail?.invoices ?? []) {
    // Je Rechnung zählt ein Budgetposten einmal, auch mit mehreren Positionen.
    const keys = new Set(
      entry.lines.map((line) => `${line.account_number} ${line.account_name} · ${line.item_name}`),
    );
    for (const key of keys) {
      const row = items.get(key) ?? { own: false, contracts: 0, invoices: 0 };
      items.set(key, { ...row, invoices: row.invoices + 1 });
    }
  }
  const targetName = others.find((entry) => String(entry.id) === target)?.name ?? "";

  return (
    <div className="page page-wide budget-page">
      <BudgetHead title={partner?.name ?? "Partner"} />
      <ReadOnlyNote roles={roles} />
      <p>
        <Link to={BUDGET_PARTNERS_PATH}>← Zurück zu den Partnern</Link>
      </p>
      {state === "fehler" && (
        <p role="alert" className="panel panel-empty">
          Der Partner konnte nicht geladen werden.
        </p>
      )}
      {state === "laden" && <p role="status">Wird geladen …</p>}
      {state === "fehlt" && <p className="panel panel-empty">Diesen Partner gibt es nicht.</p>}
      {detail && partner && (
        <>
          <p className="budget-badges">
            <span className={partner.active ? "pill pill-ok" : "pill pill-neutral"}>
              {partner.active ? "aktiv" : "stillgelegt"}
            </span>
            <span className="pill pill-neutral">{partnerRoles(partner)}</span>
            {partner.customer_number && (
              <span className="pill pill-neutral">Kundennummer {partner.customer_number}</span>
            )}
          </p>

          <section className="panel budget-section" aria-labelledby="partner-vertraege">
            <h2 id="partner-vertraege">Verträge ({detail.contracts.length})</h2>
            {detail.contracts.length === 0 ? (
              <p className="budget-muted">Kein Vertrag mit dieser Firma.</p>
            ) : (
              <ul className="budget-list">
                {detail.contracts.map((entry) => (
                  <li key={entry.id}>
                    <span>
                      <Link to={`${BUDGET_CONTRACTS_PATH}/${entry.id}`}>{entry.title}</Link>
                      <span className="budget-muted budget-line">
                        {entry.partner_id === partner.id ? "Vertragspartner" : "Rechnungssteller"}
                        {" · "}
                        {contractItemsText(entry)}
                        {entry.running ? "" : " · beendet"}
                      </span>
                    </span>
                    <span className="betrag">
                      {entry.yearly_cents === null
                        ? `${formatEuro(entry.amount_cents)} einmalig`
                        : `${formatEuro(entry.yearly_cents)} im Jahr`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel budget-section" aria-labelledby="partner-posten">
            <h2 id="partner-posten">Budgetposten ({items.size})</h2>
            {items.size === 0 ? (
              <p className="budget-muted">Noch keinem Budgetposten zugeordnet.</p>
            ) : (
              <ul className="budget-list">
                {[...items.entries()].map(([name, count]) => (
                  <li key={name}>
                    <span>{name}</span>
                    <span className="budget-muted">
                      {count.own ? "Partner des Postens · " : ""}
                      {count.contracts} {count.contracts === 1 ? "Vertrag" : "Verträge"},{" "}
                      {count.invoices} {count.invoices === 1 ? "Rechnung" : "Rechnungen"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel budget-section" aria-labelledby="partner-rechnungen">
            <h2 id="partner-rechnungen">Rechnungen ({detail.invoice_total})</h2>
            {detail.invoices.length === 0 ? (
              <p className="budget-muted">Noch keine Rechnung von dieser Firma.</p>
            ) : (
              <ul className="budget-list">
                {detail.invoices.map((entry) => (
                  <li key={entry.id}>
                    <span>
                      {formatBudgetDay(entry.invoice_date)} · {entry.number}
                      <span className="budget-muted budget-line">
                        {entry.lines
                          .map(
                            (line) =>
                              `${line.account_number} · ${line.item_name}` +
                              (line.contract_title ? ` · ${line.contract_title}` : ""),
                          )
                          .join("; ")}
                      </span>
                    </span>
                    <span className="betrag">
                      {formatEuro(entry.gross_cents)}{" "}
                      <span
                        className={entry.status === "gebucht" ? "pill pill-ok" : "pill pill-todo"}
                      >
                        {STATUS_LABELS[entry.status]}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {detail.invoice_total > detail.invoices.length && (
              <p className="small budget-muted">
                Gezeigt werden die neuesten {detail.invoices.length} Rechnungen.
              </p>
            )}
          </section>

          {canMerge && others.length > 0 && (
            <section className="panel budget-section" aria-labelledby="partner-merge">
              <h2 id="partner-merge">Mit einem anderen Partner zusammenlegen</h2>
              <p className="budget-muted">
                Für doppelt angelegte Firmen, z. B. nach einem Schreibfehler. Alle Verträge und
                Rechnungen von „{partner.name}“ wandern zum gewählten Partner, danach wird „
                {partner.name}“ gelöscht. Das lässt sich nicht rückgängig machen.
              </p>
              <div className="settings-form budget-merge">
                <label>
                  Zusammenlegen mit
                  <select
                    value={target}
                    onChange={(event) => {
                      setTarget(event.target.value);
                    }}
                  >
                    <option value="">Bitte wählen</option>
                    {others.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                  </select>
                </label>
                <ConfirmButton
                  className="button button-secondary"
                  disabled={!target || busy}
                  confirm={{
                    title: "Partner zusammenlegen?",
                    text: `Alle Verträge, Rechnungen und Budgetposten von „${partner.name}“ wandern zu „${targetName}“. Danach wird „${partner.name}“ gelöscht.`,
                    action: "Zusammenlegen",
                    danger: true,
                  }}
                  onConfirm={onMerge}
                >
                  Zusammenlegen
                </ConfirmButton>
              </div>
              {error && (
                <p role="alert" className="hint-box hint-bad">
                  {error}
                </p>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
