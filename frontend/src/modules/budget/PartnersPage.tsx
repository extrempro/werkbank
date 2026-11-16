import { useEffect, useState, type FormEvent } from "react";
import { errorText } from "../../api";
import { Link } from "../../components/Link";
import { BUDGET_PARTNERS_PATH } from "../../navigation";
import {
  BUDGET_EDITOR_ROLES,
  deletePartner,
  createPartner,
  fetchPartners,
  partnerRoles,
  updatePartner,
  type Partner,
} from "./api";
import { BudgetHead, DeleteButton, ReadOnlyNote, useRevealOnMount } from "./shared";

interface FormProps {
  /** null: neuen Partner anlegen. */
  partner: Partner | null;
  onSaved: (partner: Partner) => void;
  onCancel: () => void;
}

function PartnerForm({ partner, onSaved, onCancel }: FormProps) {
  const reveal = useRevealOnMount<HTMLElement>();
  const [name, setName] = useState(partner?.name ?? "");
  const [contractPartner, setContractPartner] = useState(partner?.is_contract_partner ?? true);
  const [invoicer, setInvoicer] = useState(partner?.is_invoicer ?? true);
  const [customerNumber, setCustomerNumber] = useState(partner?.customer_number ?? "");
  const [note, setNote] = useState(partner?.note ?? "");
  const [active, setActive] = useState(partner?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError("Bitte einen Namen eintragen.");
      return;
    }
    if (!contractPartner && !invoicer) {
      setError("Bitte Vertragspartner, Rechnungssteller oder beides ankreuzen.");
      return;
    }
    const update = {
      name: name.trim(),
      is_contract_partner: contractPartner,
      is_invoicer: invoicer,
      customer_number: customerNumber.trim(),
      note: note.trim(),
      active,
    };
    setBusy(true);
    setError(null);
    (partner ? updatePartner(partner.id, update) : createPartner(update))
      .then(onSaved)
      .catch((problem: unknown) => {
        setError(errorText(problem, "Der Partner konnte nicht gespeichert werden."));
        setBusy(false);
      });
  };

  return (
    <section className="panel" aria-labelledby="partner-formular-titel" ref={reveal} tabIndex={-1}>
      <div className="panel-head">
        <h2 id="partner-formular-titel">
          {partner ? `${partner.name} bearbeiten` : "Partner anlegen"}
        </h2>
      </div>
      <form className="detail-body settings-form" onSubmit={onSubmit} noValidate>
        <div className="tool-row">
          <label>
            Name der Firma
            <input
              type="text"
              value={name}
              maxLength={160}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="narrow">
            Unsere Kundennummer (freiwillig)
            <input
              type="text"
              value={customerNumber}
              maxLength={60}
              onChange={(event) => setCustomerNumber(event.target.value)}
            />
          </label>
        </div>
        <label className="check-label">
          <input
            type="checkbox"
            className="check"
            checked={contractPartner}
            onChange={(event) => setContractPartner(event.target.checked)}
          />
          Vertragspartner
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            className="check"
            checked={invoicer}
            onChange={(event) => setInvoicer(event.target.checked)}
          />
          Rechnungssteller
        </label>
        <label>
          Notiz (freiwillig)
          <input
            type="text"
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        {partner && (
          <label className="check-label">
            <input
              type="checkbox"
              className="check"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
            />
            Partner ist aktiv
          </label>
        )}
        <div className="actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            {partner ? "Änderungen speichern" : "Partner speichern"}
          </button>
          <button type="button" className="button button-secondary" onClick={onCancel}>
            Abbrechen
          </button>
        </div>
        {error && (
          <p role="alert" className="hint-box hint-bad">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}

/** IT-Budget › Partner: Vertragspartner und Rechnungssteller. */
export function PartnersPage({ roles }: { roles: readonly string[] }) {
  const canEdit = BUDGET_EDITOR_ROLES.some((role) => roles.includes(role));
  const [partners, setPartners] = useState<Partner[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<Partner | null>(null);
  const [formRound, setFormRound] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const closeForm = () => {
    setEditing(null);
    setFormOpen(false);
  };
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchPartners()
      .then((result) => {
        if (active) {
          setPartners(result);
        }
      })
      .catch(() => {
        if (active) {
          setFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const onSaved = (saved: Partner) => {
    const others = (partners ?? []).filter((entry) => entry.id !== saved.id);
    setPartners(
      [...others, saved].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())),
    );
    setStatus(`${saved.name} ist gespeichert.`);
    setEditing(null);
    setFormOpen(false);
    setFormRound(formRound + 1);
  };

  return (
    <div className="page page-wide budget-page">
      <BudgetHead
        title="Partner"
        sub={
          <>
            Firmen, mit denen Verträge bestehen oder die Rechnungen stellen. Partner werden nicht
            gelöscht, sondern stillgelegt.
          </>
        }
      />
      <ReadOnlyNote roles={roles} />
      {canEdit && partners && (
        <div className="budget-toolbar">
          <button
            type="button"
            className="button button-primary"
            aria-expanded={formOpen || editing !== null}
            onClick={() => {
              setEditing(null);
              setFormRound(formRound + 1);
              setFormOpen(true);
            }}
          >
            Partner anlegen
          </button>
        </div>
      )}
      {canEdit && partners && (formOpen || editing) && (
        <PartnerForm
          key={editing ? `partner-${editing.id}` : `neu-${formRound}`}
          partner={editing}
          onSaved={onSaved}
          onCancel={closeForm}
        />
      )}

      {failed && (
        <p role="alert" className="panel panel-empty">
          Die Partner konnten nicht geladen werden.
        </p>
      )}
      {!failed && !partners && <p role="status">Wird geladen …</p>}
      {partners && partners.length === 0 && (
        <p className="panel panel-empty">Es sind noch keine Partner angelegt.</p>
      )}
      {partners && partners.length > 0 && (
        <div className="table-wrap budget-table" tabIndex={0} role="region" aria-label="Partner">
          <table>
            <caption className="visually-hidden">Vertragspartner und Rechnungssteller</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Rolle</th>
                <th scope="col">Kundennummer</th>
                <th scope="col">Notiz</th>
                <th scope="col">Stand</th>
                {canEdit && <th scope="col">Aktion</th>}
              </tr>
            </thead>
            <tbody>
              {partners.map((partner) => (
                <tr key={partner.id}>
                  <th scope="row">
                    <Link to={`${BUDGET_PARTNERS_PATH}/${partner.id}`}>{partner.name}</Link>
                  </th>
                  <td>{partnerRoles(partner)}</td>
                  <td>{partner.customer_number || "–"}</td>
                  <td>{partner.note || "–"}</td>
                  <td>
                    <span className={partner.active ? "pill pill-ok" : "pill pill-neutral"}>
                      {partner.active ? "aktiv" : "stillgelegt"}
                    </span>
                  </td>
                  {canEdit && (
                    <td>
                      <button
                        type="button"
                        className="button button-secondary"
                        aria-label={`${partner.name} bearbeiten`}
                        onClick={() => {
                          setStatus(null);
                          setEditing(partner);
                        }}
                      >
                        Bearbeiten
                      </button>
                      <DeleteButton
                        what={`Partner ${partner.name}`}
                        run={() => deletePartner(partner.id)}
                        onDeleted={() => {
                          setPartners((partners ?? []).filter((entry) => entry.id !== partner.id));
                          closeForm();
                          setStatus(`${partner.name} ist gelöscht.`);
                        }}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {status && (
        <p role="status" className="hint-box">
          {status}
        </p>
      )}
    </div>
  );
}
