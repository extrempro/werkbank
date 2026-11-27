import { useEffect, useState, type FormEvent } from "react";
import { errorText } from "../../api";
import { ConfirmButton } from "../../components/ConfirmDialog";
import { Feedback } from "../../components/Feedback";
import { FilterBar } from "../../components/FilterBar";
import { FixedChoice } from "../../components/ListChoice";
import { InfoTip } from "../../components/InfoTip";
import { Link } from "../../components/Link";
import { INVENTORY_RETURNS_PATH } from "../../navigation";
import { navigate } from "../../router";
import { hardwarePath, INVENTORY_EDITOR_ROLE, type LookupItem } from "./api";
import {
  completeReturn,
  fetchReturn,
  fetchReturns,
  formatDateTime,
  RETURN_CONDITION_LABELS,
  RETURN_FILTERS,
  RETURN_REASONS,
  RETURN_STATES,
  returnPath,
  startReturn,
  updateReturnItem,
  type Return,
  type ReturnCondition,
  type ReturnFilter,
  type ReturnItem,
  type ReturnItemState,
  type ReturnSummary,
} from "./issuesApi";
import { LookupPicker } from "./LookupPicker";
import { MoreButton, useDebounced, usePagedList } from "./paged";

const ITEM_STATES: { value: ReturnItemState; label: string }[] = [
  { value: "zurueck", label: "Zurück" },
  { value: "offen", label: "Noch offen" },
  { value: "fehlt", label: "Fehlt" },
];

const ITEM_PILLS: Record<ReturnItemState, { label: string; pill: string }> = {
  zurueck: { label: "zurück", pill: "pill-ok" },
  offen: { label: "offen", pill: "pill-neutral" },
  fehlt: { label: "fehlt", pill: "pill-bad" },
};

function ErrorText({ text }: { text: string | null }) {
  return text ? (
    <p role="alert" className="hint-box hint-bad">
      {text}
    </p>
  ) : null;
}

/** Rückgabe von Hand: ausgehend von einer Stelle, mit allen Geräten der Person. */
function StartReturnForm({ onStarted }: { onStarted: (row: Return) => void }) {
  const [target, setTarget] = useState<LookupItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!target) {
      setError("Bitte wähle die Stelle der Person.");
      return;
    }
    setBusy(true);
    setError(null);
    startReturn(target.id).then(onStarted, (problem: unknown) => {
      setError(errorText(problem, "Die Rückgabe konnte nicht angelegt werden."));
      setBusy(false);
    });
  };
  return (
    <form className="tool-row" onSubmit={onSubmit} noValidate>
      <LookupPicker
        kind="position"
        label="Rückgabe starten für die Person an Stelle"
        placeholder="Nummer, Stelle oder Person …"
        value={target}
        onChange={setTarget}
        hint="Alle Geräte der Person an ihren Stellen und aus offenen Verleihen."
        error={error}
      />
      <button type="submit" className="button button-primary" disabled={busy}>
        Rückgabe starten
      </button>
    </form>
  );
}

/** Ein Gerät der Rückgabe: zurück, offen oder fehlt; Zustand, Verbleib, Häkchen. */
function ReturnItemCard({
  item,
  editable,
  onSave,
}: {
  item: ReturnItem;
  editable: boolean;
  onSave: (item: ReturnItem, change: Partial<ReturnItem>) => void;
}) {
  const room: LookupItem | null = item.room_id
    ? { id: item.room_id, label: item.room, detail: "" }
    : null;
  return (
    <div className="return-item">
      <div className="return-item-head">
        <div>
          <strong>
            <Link to={hardwarePath(item.hardware_id)}>{item.name}</Link>
          </strong>{" "}
          <span className="small">({item.kind})</span>
          <div className="small">
            {[item.serial ? `SN ${item.serial}` : "", item.inventory_no ?? "", item.source]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
        <span className={`pill ${ITEM_PILLS[item.state].pill}`}>
          {ITEM_PILLS[item.state].label}
        </span>
      </div>
      {editable && (
        <FixedChoice
          label={`Ist „${item.name}“ zurück?`}
          value={item.state}
          options={ITEM_STATES}
          onChange={(state) => onSave(item, { state })}
        />
      )}
      {item.state === "zurueck" && (
        <div className="form-grid">
          <FixedChoice
            label="Zustand"
            value={item.condition}
            disabled={!editable}
            options={(Object.keys(RETURN_CONDITION_LABELS) as ReturnCondition[]).map((value) => ({
              value,
              label: RETURN_CONDITION_LABELS[value],
            }))}
            onChange={(condition) => onSave(item, { condition })}
          />
          {editable ? (
            <LookupPicker
              kind="room"
              label="Wohin (Raum, freiwillig)"
              placeholder="Raum, Etage oder Standort …"
              value={room}
              onChange={(next) =>
                onSave(item, { room_id: next?.id ?? null, room: next?.label ?? "" })
              }
            />
          ) : (
            <div className="field">
              <span className="field-label">Wohin</span>
              <span>{item.room || "–"}</span>
            </div>
          )}
          <label className="check-label issue-check">
            <input
              type="checkbox"
              className="check"
              checked={item.accessories_ok}
              disabled={!editable}
              onChange={(event) => onSave(item, { accessories_ok: event.target.checked })}
            />
            <span>Zubehör vollständig</span>
          </label>
          <label className="check-label issue-check">
            <input
              type="checkbox"
              className="check"
              checked={item.wiped}
              disabled={!editable}
              onChange={(event) => onSave(item, { wiped: event.target.checked })}
            />
            <span>
              Daten gelöscht <InfoTip term="bestand.rueckgabe-daten" />
            </span>
          </label>
        </div>
      )}
      {item.state === "fehlt" && (
        <p className="small">
          Bleibt beim Abschließen an der Stelle und steht im Verlauf des Geräts als „nicht
          zurückgegeben“. Verloren oder gestohlen trägst du danach beim Gerät ein.
        </p>
      )}
    </div>
  );
}

/** Eine Rückgabe: alle Geräte der Person mit Stand, dann abschließen. */
function ReturnDetail({
  returnId,
  canEdit,
  onChanged,
}: {
  returnId: number;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [row, setRow] = useState<Return | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "status" | "alert"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetchReturn(returnId).then(
      (result) => active && setRow(result),
      (problem: unknown) =>
        active && setFailed(errorText(problem, "Die Rückgabe konnte nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, [returnId]);

  if (failed) {
    return <ErrorText text={failed} />;
  }
  if (!row || row.id !== returnId) {
    return <p role="status">Wird geladen …</p>;
  }
  const editable = canEdit && row.state === "offen";
  const fail = (problem: unknown) => {
    setNotice({ kind: "alert", text: errorText(problem, "Das hat nicht geklappt.") });
    setBusy(false);
  };
  const save = (item: ReturnItem, change: Partial<ReturnItem>) => {
    const next = { ...item, ...change };
    setBusy(true);
    updateReturnItem(row.id, item.id, {
      state: next.state,
      condition: next.condition,
      room_id: next.room_id,
      accessories_ok: next.accessories_ok,
      wiped: next.wiped,
    }).then((result) => {
      setRow(result);
      setBusy(false);
      onChanged();
    }, fail);
  };
  const undecided = row.entries.filter((item) => item.state === "offen").length;

  return (
    <section className="panel" aria-labelledby="rueckgabe-titel">
      <div className="panel-head case-head">
        <div>
          <p className="small">
            <span className="mono">{row.number}</span> · {RETURN_REASONS[row.reason] ?? row.reason}{" "}
            · angelegt am {formatDateTime(row.created_at)}
          </p>
          <h2 id="rueckgabe-titel">Rückgabe von {row.person_name}</h2>
          <p className="small">
            <span className={`pill ${RETURN_STATES[row.state].pill}`}>
              {RETURN_STATES[row.state].label}
            </span>{" "}
            {row.items_back} von {row.items} zurück
            {row.items_missing > 0 ? ` · ${row.items_missing} fehlt` : ""}
          </p>
        </div>
      </div>
      <div className="detail-body" aria-busy={busy}>
        <Feedback message={notice} onClose={() => setNotice(null)} />
        <div className="return-bars" aria-hidden="true">
          {row.entries.map((item) => (
            <span
              key={item.id}
              className={
                item.state === "zurueck"
                  ? "is-back"
                  : item.state === "fehlt"
                    ? "is-missing"
                    : undefined
              }
            />
          ))}
        </div>
        {row.entries.map((item) => (
          <ReturnItemCard key={item.id} item={item} editable={editable} onSave={save} />
        ))}
        {editable && (
          <div className="project-actions">
            <ConfirmButton
              className="button button-primary"
              disabled={busy || undecided > 0}
              confirm={{
                title: "Rückgabe abschließen?",
                text: "Zurückgegebene Geräte sind danach frei bzw. im Verleih zurückgetragen. Was fehlt, bleibt an der Stelle. Danach lässt sich nichts mehr ändern.",
                action: "Abschließen",
              }}
              onConfirm={() =>
                completeReturn(row.id).then((result) => {
                  setRow(result);
                  setNotice({ kind: "status", text: "Die Rückgabe ist abgeschlossen." });
                  onChanged();
                }, fail)
              }
            >
              Rückgabe abschließen
            </ConfirmButton>
            {undecided > 0 && (
              <span className="small">Bei {undecided} Geräten fehlt noch, ob sie zurück sind.</span>
            )}
          </div>
        )}
        {row.state === "abgeschlossen" && (
          <div className="project-actions no-print">
            <button
              type="button"
              className="button button-secondary"
              onClick={() => window.print()}
            >
              Rückgabeprotokoll drucken
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

/** IT-Bestand › Rückgabe: offene und abgeschlossene Rückgaben. */
export function ReturnsPage({
  returnId,
  roles,
}: {
  returnId: number | null;
  roles: readonly string[];
}) {
  const canEdit = roles.includes(INVENTORY_EDITOR_ROLE);
  const [filter, setFilter] = useState<ReturnFilter>("offen");
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState("");
  const query = useDebounced(search);
  const paged = usePagedList<ReturnSummary, { open: number }>(
    `${filter}|${query}`,
    reload,
    (offset, limit) =>
      fetchReturns(filter, query, offset, limit).then((result) => ({
        items: result.returns,
        total: result.total,
        extra: { open: result.open },
      })),
    "Die Rückgaben konnten nicht geladen werden.",
  );
  const rows = paged.items;

  return (
    <div className="page page-wide">
      <header className="page-head project-head">
        <div>
          <p className="module-label">IT-Bestand</p>
          <h1>Rückgabe</h1>
          <p className="page-sub">
            Alle Geräte einer Person zurück, je Gerät geprüft. Wird das Konto in Entra deaktiviert,
            legt die Werkbank die Rückgabe selbst an.
          </p>
        </div>
      </header>
      <ErrorText text={paged.error} />
      {canEdit && returnId === null && (
        <section className="panel no-print" aria-label="Rückgabe starten">
          <div className="detail-body">
            <StartReturnForm
              onStarted={(row) => {
                setReload(reload + 1);
                navigate(returnPath(row.id));
              }}
            />
          </div>
        </section>
      )}
      <div className={returnId === null ? "case-layout" : "case-layout case-layout-detail"}>
        <nav className="panel case-list no-print" aria-label="Rückgaben">
          <div className="case-filters">
            <FilterBar
              plain
              search={{
                label: "Suchen",
                value: search,
                placeholder: "Nummer oder Person …",
                onChange: setSearch,
                hits: (rows ?? []).map((entry) => ({
                  key: entry.id,
                  title: entry.person_name,
                  extra: RETURN_STATES[entry.state].label,
                  meta: entry.number,
                  href: returnPath(entry.id),
                })),
                total: paged.total,
              }}
              status={{
                label: "Status",
                value: filter,
                onChange: setFilter,
                options: RETURN_FILTERS.map((entry) => ({
                  value: entry.id,
                  label: entry.label,
                  count: entry.id === "offen" && paged.extra ? paged.extra.open : null,
                })),
              }}
            />
          </div>
          <div className="case-scroll">
            {!rows && !paged.error && <p role="status">Wird geladen …</p>}
            {rows && rows.length === 0 && (
              <p className="empty">
                {query.trim()
                  ? "Keine Rückgabe passt zur Suche."
                  : "Keine Rückgaben in dieser Liste."}
              </p>
            )}
            {rows && rows.length > 0 && (
              <ul>
                {rows.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      className="case-item"
                      aria-current={entry.id === returnId ? "true" : undefined}
                      onClick={() => navigate(returnPath(entry.id))}
                    >
                      <span className="case-item-head">
                        <span className="mono">{entry.number}</span>
                        <span className={`pill ${RETURN_STATES[entry.state].pill}`}>
                          {RETURN_STATES[entry.state].label}
                        </span>
                      </span>
                      <strong>{entry.person_name}</strong>
                      <span className="small">
                        {entry.items_back} von {entry.items} zurück
                        {entry.items_missing > 0 ? ` · ${entry.items_missing} fehlt` : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {rows && (
              <MoreButton
                shown={rows.length}
                total={paged.total}
                loading={paged.loadingMore}
                onMore={paged.more}
              />
            )}
          </div>
        </nav>
        <div className="case-main">
          {returnId !== null && (
            <a
              className="case-back no-print"
              href={INVENTORY_RETURNS_PATH}
              onClick={(event) => {
                event.preventDefault();
                navigate(INVENTORY_RETURNS_PATH);
              }}
            >
              ‹ Zur Liste
            </a>
          )}
          {returnId === null ? (
            <p className="panel panel-empty">Wähle links eine Rückgabe.</p>
          ) : (
            <ReturnDetail
              key={returnId}
              returnId={returnId}
              canEdit={canEdit}
              onChanged={() => setReload(reload + 1)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
