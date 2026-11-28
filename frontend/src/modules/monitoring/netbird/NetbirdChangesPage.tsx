import { useEffect, useRef, useState } from "react";
import { errorText, formatDateTime } from "../../../api";
import { useConfirm } from "../../../components/ConfirmDialog";
import { Feedback, type FeedbackMessage } from "../../../components/Feedback";
import { Field } from "../../../components/Field";
import { FilterBar } from "../../../components/FilterBar";
import { InfoTip } from "../../../components/InfoTip";
import { Link } from "../../../components/Link";
import { ADMIN_NETBIRD_PATH } from "../../../navigation";
import { useSearchParam } from "../../../router";
import { useDebounced } from "../../inventory/paged";
import { replaceParams } from "../fortigate/params";
import { NbDataBar, NbHead, useLoaded } from "./NetbirdPages";
import {
  confirmAllNbChanges,
  confirmNbChange,
  fetchNbChange,
  fetchNbChanges,
  type NbChange,
  type NbChangeDetail,
  type NbChangeFilter,
  type NbChangeStatus,
  type NbChanges,
} from "./api";

/* IT-Monitoring › NetBird › Gruppen & Policies: erkannte Änderungen, melden, bestätigen. */

const PAGE = 50;
const STATUS_LABELS: Record<NbChangeStatus, string> = {
  offen: "offen",
  bestaetigt: "bestätigt",
  automatisch: "automatisch",
};
const STATUS_CLASS: Record<NbChangeStatus, string> = {
  offen: "pill pill-todo",
  bestaetigt: "pill pill-ok",
  automatisch: "pill pill-neutral",
};
const KIND_LABELS = { group: "Gruppe", policy: "Policy" } as const;
const FLAG_LABELS = { fremde_gruppe: "fremde Gruppe", von_hand: "von Hand" } as const;
const COMMENT_MAX = 500;

function initial(name: string, fallback = ""): string {
  return new URLSearchParams(window.location.search).get(name) ?? fallback;
}

function dayLabel(iso: string): string {
  const day = new Date(iso);
  const today = new Date();
  const start = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const diff = Math.round((start(today) - start(day)) / (24 * 3600 * 1000));
  if (diff === 0) {
    return "Heute";
  }
  if (diff === 1) {
    return "Gestern";
  }
  return day.toLocaleDateString("de-DE", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

export function NetbirdChangesPage() {
  const [search, setSearch] = useState(() => initial("q"));
  const [filter, setFilter] = useState<Omit<NbChangeFilter, "q">>(() => ({
    state: initial("status", "offen"),
    kind: initial("objekt"),
    action: initial("art"),
    initiator: initial("von"),
    days: initial("zeitraum", "30"),
    object: initial("objekt_id"),
  }));
  const [limit, setLimit] = useState(PAGE);
  const [version, setVersion] = useState(0);
  const [message, setMessage] = useState<FeedbackMessage | null>(null);
  const [ask, dialog] = useConfirm();
  const q = useDebounced(search.trim());
  const { data, error } = useLoaded<NbChanges>(
    () => fetchNbChanges({ ...filter, q }, limit),
    "Die Änderungen konnten nicht geladen werden.",
    [
      q,
      filter.state,
      filter.kind,
      filter.action,
      filter.initiator,
      filter.days,
      filter.object,
      limit,
      version,
    ],
  );
  const selected = useSearchParam("auswahl");
  const detailRef = useRef<HTMLElement>(null);
  const change = (next: Partial<Omit<NbChangeFilter, "q">>) => {
    setFilter((current) => ({ ...current, ...next }));
    setLimit(PAGE);
  };
  const moreActive = [
    filter.kind,
    filter.action,
    filter.initiator,
    filter.days !== "30" ? "1" : "",
    filter.object,
  ].filter(Boolean).length;
  const items = data?.items ?? [];
  const days: { label: string; rows: NbChange[] }[] = [];
  for (const item of items) {
    const label = dayLabel(item.detected_at);
    const last = days[days.length - 1];
    if (last && last.label === label) {
      last.rows.push(item);
    } else {
      days.push({ label, rows: [item] });
    }
  }

  const choose = (id: number) => {
    replaceParams({ auswahl: String(id) });
    window.setTimeout(() => {
      if (detailRef.current && window.matchMedia?.("(max-width: 1023px)").matches) {
        detailRef.current.scrollIntoView({ block: "start" });
      }
    }, 0);
  };

  const confirmAll = () =>
    ask(
      {
        title: `${data?.open_count ?? 0} offene Änderungen bestätigen?`,
        text: "Alle offenen Änderungen gelten dann als geprüft. Person und Zeitpunkt werden gespeichert und lassen sich nicht mehr ändern.",
        action: "Bestätigen",
      },
      () =>
        confirmAllNbChanges().then(
          (result) => {
            setMessage({
              kind: "status",
              text:
                result.confirmed === 1
                  ? "Die offene Änderung ist bestätigt."
                  : `${result.confirmed} offene Änderungen sind bestätigt.`,
            });
            setVersion((value) => value + 1);
          },
          (caught: unknown) =>
            setMessage({
              kind: "alert",
              text: errorText(caught, "Die Änderungen konnten nicht bestätigt werden."),
            }),
        ),
    );

  return (
    <div className="page page-wide fg-page">
      <NbHead
        title="Gruppen & Policies"
        sub="Änderungen an überwachten Gruppen und Policies in NetBird erkennen, melden und bestätigen."
      />
      <NbDataBar data={data} />
      {data && <Watched data={data} />}
      <FilterBar<string>
        search={{
          label: "Suchen",
          value: search,
          placeholder: "Objekt, Änderung, Person",
          onChange: (value) => {
            setSearch(value);
            setLimit(PAGE);
          },
        }}
        status={{
          label: "Status",
          value: filter.state,
          onChange: (value) => change({ state: value }),
          options: [
            { value: "offen", label: "offen", count: data ? data.open_count : null },
            { value: "bestaetigt", label: "bestätigt" },
            { value: "automatisch", label: "automatisch" },
            { value: "", label: "alle" },
          ],
        }}
        statusSelect
        moreActive={moreActive}
        onReset={
          search || filter.state !== "offen" || moreActive
            ? () => {
                setSearch("");
                change({
                  state: "offen",
                  kind: "",
                  action: "",
                  initiator: "",
                  days: "30",
                  object: "",
                });
              }
            : undefined
        }
        more={
          <>
            <label className="filter-field">
              Objekt
              <select
                value={filter.kind}
                onChange={(event) => change({ kind: event.target.value })}
              >
                <option value="">Gruppen und Policies</option>
                <option value="group">Gruppen</option>
                <option value="policy">Policies</option>
              </select>
            </label>
            <label className="filter-field">
              Art
              <select
                value={filter.action}
                onChange={(event) => change({ action: event.target.value })}
              >
                <option value="">Alle Arten</option>
                <option value="angelegt">angelegt</option>
                <option value="geaendert">geändert</option>
                <option value="geloescht">gelöscht</option>
                <option value="mitglieder">Mitglieder</option>
              </select>
            </label>
            <label className="filter-field">
              Ausgelöst von
              <select
                value={filter.initiator}
                onChange={(event) => change({ initiator: event.target.value })}
              >
                <option value="">Alle</option>
                <option value="person">Personen</option>
                <option value="scim">Entra (SCIM)</option>
                <option value="unbekannt">unbekannt</option>
              </select>
            </label>
            <label className="filter-field">
              Zeitraum
              <select
                value={filter.days}
                onChange={(event) => change({ days: event.target.value })}
              >
                <option value="7">7 Tage</option>
                <option value="30">30 Tage</option>
                <option value="90">90 Tage</option>
                <option value="0">alles</option>
              </select>
            </label>
          </>
        }
      />
      {filter.object && (
        <p className="small">
          Nur Änderungen an einem Objekt.{" "}
          <button type="button" className="button-link" onClick={() => change({ object: "" })}>
            Alle Objekte zeigen
          </button>
        </p>
      )}
      {error && (
        <p role="alert" className="hint-box hint-bad">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Wird geladen …</p>}
      {data && (
        <div className="nb-open-bar">
          <p className="small fg-count" role="status">
            {data.open_count === 1 ? "1 offene Änderung" : `${data.open_count} offene Änderungen`}
            {!data.can_confirm && " · bestätigen nur mit „NetBird: Bestätigen“"}
          </p>
          {data.can_confirm && data.open_count > 0 && (
            <button type="button" className="button button-secondary" onClick={confirmAll}>
              Alle offenen bestätigen
            </button>
          )}
        </div>
      )}
      <div className="fg-layout">
        <div className="fg-list">
          {data && items.length === 0 && (
            <p className="empty">
              {data.watch.active
                ? "Keine Änderung passt zur Auswahl."
                : "Es wird noch nichts überwacht. Ein Admin legt die Präfixe in der Verwaltung fest."}
            </p>
          )}
          {items.length > 0 && (
            <div className="table-wrap card-wrap">
              <table className="table-cards fg-table" aria-label="Änderungen">
                <thead>
                  <tr>
                    <th scope="col">Uhrzeit</th>
                    <th scope="col">Objekt</th>
                    <th scope="col">Änderung</th>
                    <th scope="col">Ausgelöst von</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                {days.map((day) => (
                  <tbody key={day.label}>
                    <tr className="nb-day-row">
                      <th scope="colgroup" colSpan={5}>
                        {day.label}
                      </th>
                    </tr>
                    {day.rows.map((row) => {
                      const isSelected = String(row.id) === selected;
                      return (
                        <tr key={row.id} className={isSelected ? "is-selected" : undefined}>
                          <td data-label="Uhrzeit">{timeLabel(row.detected_at)}</td>
                          <th scope="row">
                            <button
                              type="button"
                              className="button-link fg-pick"
                              aria-pressed={isSelected}
                              onClick={() => choose(row.id)}
                            >
                              {row.object_name}
                            </button>
                            <span className="fg-sub">{KIND_LABELS[row.kind]}</span>
                          </th>
                          <td data-label="Änderung">
                            {row.summary}
                            {row.flag && (
                              <span
                                className={
                                  row.flag === "fremde_gruppe" ? "fg-sub nb-bad" : "fg-sub nb-warn"
                                }
                              >
                                {FLAG_LABELS[row.flag]}
                              </span>
                            )}
                          </td>
                          <td data-label="Ausgelöst von">{row.initiator}</td>
                          <td data-label="Status">
                            <span className={STATUS_CLASS[row.status]}>
                              {STATUS_LABELS[row.status]}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                ))}
              </table>
              {data && data.total > items.length && (
                <p className="detail-body">
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => setLimit(limit + PAGE)}
                  >
                    Mehr anzeigen ({data.total - items.length} weitere)
                  </button>
                </p>
              )}
            </div>
          )}
        </div>
        <aside ref={detailRef} className="panel fg-detail" aria-label="Detail der Änderung">
          {selected && /^\d+$/.test(selected) ? (
            <ChangeDetail
              key={`${selected}-${version}`}
              id={Number(selected)}
              dashboard={data?.dashboard_url ?? ""}
              onConfirmed={(text) => {
                setMessage({ kind: "status", text });
                setVersion((value) => value + 1);
              }}
              onError={(text) => setMessage({ kind: "alert", text })}
              onObject={(objectId) => change({ object: objectId, state: "" })}
            />
          ) : (
            <p className="small fg-detail-empty">
              Wähle eine Änderung aus der Liste, um Vorher und Nachher zu sehen.
            </p>
          )}
        </aside>
      </div>
      <Feedback message={message} onClose={() => setMessage(null)} />
      {dialog}
    </div>
  );
}

function Watched({ data }: { data: NbChanges }) {
  const watch = data.watch;
  return (
    <section className="panel nb-watched" aria-labelledby="nb-ueberwacht">
      <div className="panel-head nb-panel-head">
        <h2 id="nb-ueberwacht">
          Überwacht <InfoTip term="netbird.ueberwacht" />
        </h2>
        {data.can_configure && <Link to={ADMIN_NETBIRD_PATH}>Einstellungen</Link>}
      </div>
      {watch.active ? (
        <ul className="detail-body nb-watch-list">
          {watch.group_prefixes.length > 0 && (
            <li>
              Gruppen mit „{watch.group_prefixes.join("“, „")}“ ({watch.groups.length} Treffer)
            </li>
          )}
          {watch.policy_prefixes.length > 0 && (
            <li>
              Policies mit „{watch.policy_prefixes.join("“, „")}“ ({watch.policies_by_prefix}{" "}
              Treffer)
            </li>
          )}
          {watch.by_group && watch.group_prefixes.length > 0 && (
            <li>Policies mit überwachter Gruppe (+{watch.policies_by_group})</li>
          )}
        </ul>
      ) : (
        <p className="detail-body small">
          Noch keine Präfixe eingetragen.{" "}
          {data.can_configure ? (
            <Link to={ADMIN_NETBIRD_PATH}>Zur Verwaltung › NetBird</Link>
          ) : (
            "Ein Admin legt sie in der Verwaltung fest."
          )}
        </p>
      )}
    </section>
  );
}

function ChangeDetail({
  id,
  dashboard,
  onConfirmed,
  onError,
  onObject,
}: {
  id: number;
  dashboard: string;
  onConfirmed: (text: string) => void;
  onError: (text: string) => void;
  onObject: (objectId: string) => void;
}) {
  const [data, setData] = useState<NbChangeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [ask, dialog] = useConfirm();
  useEffect(() => {
    let active = true;
    fetchNbChange(id).then(
      (value) => active && setData(value),
      (caught: unknown) =>
        active && setError(errorText(caught, "Die Änderung konnte nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, [id]);
  if (error) {
    return (
      <p role="alert" className="hint-box hint-bad">
        {error}
      </p>
    );
  }
  if (!data) {
    return <p role="status">Wird geladen …</p>;
  }
  const confirm = () =>
    ask(
      {
        title: "Änderung bestätigen?",
        text: "Person, Zeitpunkt und Kommentar werden gespeichert und lassen sich danach nicht mehr ändern.",
        action: "Bestätigen",
      },
      () =>
        confirmNbChange(data.id, comment.trim()).then(
          () => onConfirmed("Die Änderung ist bestätigt."),
          (caught: unknown) =>
            onError(errorText(caught, "Die Änderung konnte nicht bestätigt werden.")),
        ),
    );
  const path = data.kind === "policy" ? "/access-control" : "/groups";
  return (
    <div className="detail-body fg-detail-body">
      <p className="small fg-sub">
        {KIND_LABELS[data.kind]} · {dayLabel(data.detected_at)} {timeLabel(data.detected_at)} ·{" "}
        <span className={STATUS_CLASS[data.status]}>{STATUS_LABELS[data.status]}</span>
      </p>
      <h2 className="fg-detail-title">{data.object_name}</h2>
      <p>{data.summary}</p>
      {data.flag && (
        <p className={data.flag === "fremde_gruppe" ? "hint-box hint-bad" : "hint-box hint-warn"}>
          <strong>{FLAG_LABELS[data.flag]}:</strong> {data.flag_text}{" "}
          <InfoTip
            term={data.flag === "fremde_gruppe" ? "netbird.fremde_gruppe" : "netbird.von_hand"}
          />
        </p>
      )}
      <dl className="facts">
        <div>
          <dt>Ausgelöst von</dt>
          <dd>{data.initiator}</dd>
        </div>
        <div>
          <dt>Erkannt über</dt>
          <dd>{data.via}</dd>
        </div>
        <div>
          <dt>Gemeldet an</dt>
          <dd>{data.notified}</dd>
        </div>
      </dl>
      <div className="table-wrap">
        <table className="nb-mini-table nb-diff" aria-label="Vorher und Nachher">
          <thead>
            <tr>
              <th scope="col">Feld</th>
              <th scope="col">Vorher</th>
              <th scope="col">Nachher</th>
            </tr>
          </thead>
          <tbody>
            {data.fields.map(([field, before, after, changed]) => (
              <tr key={field} className={changed ? "nb-diff-changed" : undefined}>
                <th scope="row">
                  {field}
                  {changed && <span className="visually-hidden"> (geändert)</span>}
                </th>
                <td className="nb-break">{before}</td>
                <td className="nb-break">{after}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.status === "bestaetigt" ? (
        <p className="hint-box">
          Bestätigt von {data.confirmed_by_name || "unbekannt"}
          {data.confirmed_at ? `, ${formatDateTime(data.confirmed_at)}` : ""}
          {data.comment ? `: „${data.comment}“` : "."} Nicht mehr änderbar.
        </p>
      ) : data.status === "offen" && data.can_confirm ? (
        <div className="nb-confirm">
          <Field
            label="Kommentar (freiwillig)"
            hint={`Höchstens ${COMMENT_MAX} Zeichen. Wird mit der Bestätigung gespeichert.`}
          >
            {(control) => (
              <textarea
                {...control}
                rows={3}
                value={comment}
                maxLength={COMMENT_MAX}
                onChange={(event) => setComment(event.target.value)}
              />
            )}
          </Field>
          <button type="button" className="button button-primary" onClick={confirm}>
            Änderung bestätigen
          </button>
        </div>
      ) : data.status === "automatisch" ? (
        <p className="small">Nur protokolliert, nicht gemeldet: automatisch bestätigt.</p>
      ) : (
        <p className="small">Bestätigen kann nur, wer „NetBird: Bestätigen“ hat.</p>
      )}
      <div className="actions">
        {data.related > 1 && (
          <button
            type="button"
            className="button button-secondary"
            onClick={() => onObject(data.object_id)}
          >
            Alle Änderungen an diesem Objekt ({data.related})
          </button>
        )}
        {dashboard && (
          <a
            className="button button-secondary"
            href={`${dashboard}${path}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            In NetBird öffnen
          </a>
        )}
      </div>
      {dialog}
    </div>
  );
}
