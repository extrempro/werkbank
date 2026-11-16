import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { NetNotice } from "../NetNotice";
import { downloadBlob } from "../download";
import { dropParams, readParam, useToolParams } from "../params";
import { CopyButton, ErrorBox, Segmented } from "../ui";
import { commonRecordTypes, dnsRecordTypes, moreRecordTypes, reverseName } from "./doh";
import { humanTtl, readable } from "./format";
import { builtInResolvers, queryResolver, type Resolver } from "./resolvers";
import {
  buildMatrix,
  rowKeyOf,
  toCsv,
  toJson,
  toText,
  type Cell,
  type TypeResult,
} from "./results";
import { SubdomainPanel } from "./SubdomainPanel";
import { toQueryName } from "./subdomains";

const QUICK_COMMON = ["A", "AAAA", "CNAME", "MX", "NS", "TXT", "SOA", "CAA"];

const isIp = (value: string) =>
  /^\d{1,3}(\.\d{1,3}){3}$/.test(value.trim()) ||
  (value.includes(":") && /^[0-9a-f:.]+$/i.test(value.trim()));

function statusPill(cell: Cell): string {
  if (cell.error) {
    return "pill pill-bad";
  }
  const status = cell.result!.status;
  if (status === "NOERROR") {
    return cell.result!.answers.length ? "pill pill-ok" : "pill pill-neutral";
  }
  return status === "NXDOMAIN" ? "pill pill-todo" : "pill pill-bad";
}

function statusText(cell: Cell): string {
  if (cell.error) {
    return cell.error;
  }
  const result = cell.result!;
  if (result.status === "NOERROR") {
    const count = result.answers.length;
    return count ? `${count} Eintr${count === 1 ? "ag" : "äge"}` : "keine Einträge";
  }
  return result.status;
}

/** Typ ohne Einträge, und alle Resolver sind sich einig */
const isEmpty = (tr: TypeResult) =>
  tr.cells.every(
    (cell) =>
      cell.result &&
      cell.result.answers.length === 0 &&
      cell.result.status === tr.cells[0]!.result?.status,
  );

const shortName = (resolver: Resolver) => resolver.name.replace(/\s*\(.*\)$/, "");

function RecordView({
  type,
  name,
  data,
  ttl,
  showName,
  children,
}: {
  type: string;
  name: string;
  data: string;
  ttl?: number;
  showName: boolean;
  children?: ReactNode;
}) {
  const record = readable(type, data);
  return (
    <li className="dns-record">
      <div className="image-info">
        {showName && (
          <span className="small mono">
            {name} <span className="pill pill-neutral">{type}</span>
          </span>
        )}
        <span>
          <span className="mono tool-break">{record.main}</span>{" "}
          {record.kind && <span className="pill pill-neutral">{record.kind}</span>}
        </span>
        {record.fields.length > 0 && (
          <span className="small">
            {record.fields.map((field) => (
              <span key={field.label} className="dns-field">
                {field.label} <span className="mono">{field.value}</span>
              </span>
            ))}
          </span>
        )}
        {record.hint && <span className="small">{record.hint}</span>}
        {children}
      </div>
      <div className="tool-row">
        {ttl !== undefined && <span className="small">TTL {humanTtl(ttl)}</span>}
        <CopyButton value={data} label="Eintrag kopieren" />
      </div>
    </li>
  );
}

function ResolverStatus({ cell, withName }: { cell: Cell; withName: boolean }) {
  return (
    <span className="tool-row">
      {withName && <strong>{cell.resolver.name}</strong>}
      <span className={statusPill(cell)}>{statusText(cell)}</span>
      {cell.result && <span className="small">{cell.result.ms} ms</span>}
      {cell.result?.authenticated && <span className="pill pill-ok">DNSSEC geprüft</span>}
    </span>
  );
}

function TypeCard({ tr, side }: { tr: TypeResult; side: boolean }) {
  const matrix = useMemo(() => buildMatrix(tr), [tr]);
  const multi = tr.cells.length > 1;
  const okCells = tr.cells.filter((cell) => cell.result);
  const showName = (name: string, type: string) =>
    name.toLowerCase() !== tr.query.toLowerCase() || type !== tr.type;

  return (
    <li className="tool-card">
      <div className="tool-row">
        <span className="pill pill-info mono">{tr.type}</span>
        <span className="mono small tool-break">{tr.query}</span>
        {multi && okCells.length > 1 && (
          <span className={matrix.consistent ? "pill pill-ok" : "pill pill-todo"}>
            {matrix.consistent ? `alle ${okCells.length} Resolver gleich` : "Resolver weichen ab"}
          </span>
        )}
      </div>

      {side && multi && !matrix.consistent ? (
        <div className="tool-columns">
          {tr.cells.map((cell) => (
            <div key={cell.resolver.id}>
              <ResolverStatus cell={cell} withName />
              <ul className="dns-records">
                {(cell.result?.answers ?? []).map((answer, index) => {
                  const key = rowKeyOf(answer.name, answer.type, answer.data);
                  const row = matrix.rows.find((entry) => entry.key === key);
                  const differs = !!row && okCells.some((other) => !row.present[other.resolver.id]);
                  return (
                    <RecordView
                      key={index}
                      type={answer.type}
                      name={answer.name}
                      data={answer.data}
                      ttl={answer.ttl}
                      showName={showName(answer.name, answer.type)}
                    >
                      {differs && <span className="pill pill-todo">nicht bei allen Resolvern</span>}
                    </RecordView>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="tool-row">
            {tr.cells.map((cell) => (
              <ResolverStatus key={cell.resolver.id} cell={cell} withName={multi} />
            ))}
          </div>
          {matrix.rows.length > 0 && (
            <ul className="dns-records">
              {matrix.rows.map((row) => {
                const ttls = tr.cells
                  .map((cell) => row.ttl[cell.resolver.id])
                  .filter((value): value is number => value !== undefined);
                const have = okCells.filter((cell) => row.present[cell.resolver.id]);
                const lack = okCells.filter((cell) => !row.present[cell.resolver.id]);
                return (
                  <RecordView
                    key={row.key}
                    type={row.type}
                    name={row.name}
                    data={row.data}
                    ttl={ttls.length ? Math.max(...ttls) : undefined}
                    showName={showName(row.name, row.type)}
                  >
                    {multi && lack.length > 0 && (
                      <span className="pill pill-todo">
                        {have.length <= lack.length
                          ? `nur bei ${have.map((cell) => shortName(cell.resolver)).join(", ")}`
                          : `fehlt bei ${lack.map((cell) => shortName(cell.resolver)).join(", ")}`}
                      </span>
                    )}
                  </RecordView>
                );
              })}
            </ul>
          )}
        </>
      )}
    </li>
  );
}

const DEFAULTS = { modus: "eintraege", typen: "A", resolver: "cloudflare", ansicht: "zusammen" };

export default function DnsLookupTool() {
  // In der Adresszeile stehen nur Einstellungen; der abgefragte Name nicht.
  const [params, setParams] = useToolParams(DEFAULTS);
  const mode = params.modus === "subdomains" ? "subdomains" : "eintraege";
  const side = params.ansicht === "nebeneinander";
  const types = useMemo(() => {
    const list = params.typen
      .split(",")
      .map((entry) => entry.trim().toUpperCase())
      .filter((entry) => (dnsRecordTypes as readonly string[]).includes(entry));
    return list.length ? [...new Set(list)] : ["A"];
  }, [params.typen]);
  const selectedResolvers = useMemo(() => {
    const ids = params.resolver.split(",").map((entry) => entry.trim());
    const list = builtInResolvers.filter((entry) => ids.includes(entry.id));
    return list.length ? list : [builtInResolvers[0]!];
  }, [params.resolver]);

  // Ein Verweis aus einem anderen Tool (z. B. E-Mail-Header) bringt Name und Typen mit.
  const [domain, setDomain] = useState(() => readParam("domain"));
  const [note, setNote] = useState<string | null>(null);
  const [subTrigger, setSubTrigger] = useState(0);
  const [subDomain, setSubDomain] = useState<string | null>(null);
  const [subBusy, setSubBusy] = useState(false);
  const [results, setResults] = useState<TypeResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showMore, setShowMore] = useState(() =>
    types.some((entry) => (moreRecordTypes as readonly string[]).includes(entry)),
  );
  const runId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const lastQuery = useRef("");

  const run = async (input: string, typeList: string[], resolverList: Resolver[]) => {
    const value = input.trim().replace(/\.$/, "");
    if (!value) {
      return;
    }
    lastQuery.current = value;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const id = ++runId.current;
    setError(null);
    let qname: string;
    let effectiveTypes = typeList;
    try {
      if (isIp(value)) {
        setNote(null);
        qname = reverseName(value);
        effectiveTypes = ["PTR"];
      } else {
        const query = toQueryName(value);
        qname = query.name;
        setNote(query.note ?? null);
        // PTR auf einen Namen ergibt keinen Sinn; nur abfragen, wenn es der einzige Typ ist.
        if (effectiveTypes.length > 1) {
          effectiveTypes = effectiveTypes.filter((entry) => entry !== "PTR");
        }
      }
    } catch (caught) {
      setResults(null);
      setError((caught as Error).message);
      return;
    }
    setLoading(true);
    const table: TypeResult[] = effectiveTypes.map((type) => ({
      type,
      query: qname,
      cells: resolverList.map((resolver) => ({ resolver })),
    }));
    await Promise.all(
      table.flatMap((tr) =>
        tr.cells.map(async (cell) => {
          try {
            cell.result = await queryResolver(cell.resolver, qname, tr.type, controller.signal);
          } catch (caught) {
            if (!controller.signal.aborted) {
              cell.error = (caught as Error).message;
            }
          }
        }),
      ),
    );
    if (id !== runId.current) {
      return;
    }
    setResults(table);
    setLoading(false);
  };

  const startSubdomains = (input: string) => {
    try {
      const query = toQueryName(input);
      if (query.name.startsWith("*.")) {
        throw new Error("Für die Subdomain-Suche bitte die Domain ohne * eingeben.");
      }
      setError(null);
      setNote(query.note ?? null);
      setSubDomain(query.name);
      setSubTrigger((count) => count + 1);
    } catch (caught) {
      setError((caught as Error).message);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (mode === "subdomains") {
      startSubdomains(domain);
    } else {
      void run(domain, types, selectedResolvers);
    }
  };

  // Mitgebrachten Namen gleich abfragen; Name und Typen verlassen die Adresszeile, die Typen
  // bleiben als Einstellung.
  useEffect(() => {
    const linked = readParam("domain");
    const linkedTypes = readParam("types");
    dropParams(["domain", "types"]);
    queueMicrotask(() => {
      if (linkedTypes) {
        setParams({ typen: linkedTypes });
      }
      if (linked) {
        void run(
          linked,
          linkedTypes ? linkedTypes.split(",").map((entry) => entry.toUpperCase()) : types,
          selectedResolvers,
        );
      }
    });
    return () => abortRef.current?.abort();
    // Nur beim Öffnen des Tools.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Andere Typen oder Resolver: die letzte Abfrage gleich wiederholen. */
  const rerun = (typeList: string[], resolverList: Resolver[]) => {
    if (lastQuery.current && mode === "eintraege") {
      void run(lastQuery.current, typeList, resolverList);
    }
  };

  const setTypes = (list: string[]) => {
    setParams({ typen: list.join(",") });
    rerun(list, selectedResolvers);
  };
  const toggleType = (type: string) => {
    const next = types.includes(type) ? types.filter((entry) => entry !== type) : [...types, type];
    if (next.length) {
      setTypes(next);
    }
  };
  const toggleResolver = (resolver: Resolver) => {
    const ids = selectedResolvers.map((entry) => entry.id);
    const next = ids.includes(resolver.id)
      ? ids.filter((entry) => entry !== resolver.id)
      : [...ids, resolver.id];
    if (next.length) {
      setParams({ resolver: next.join(",") });
      rerun(
        types,
        builtInResolvers.filter((entry) => next.includes(entry.id)),
      );
    }
  };

  /** Klick auf eine gefundene Subdomain: deren Einträge abfragen */
  const pick = (name: string) => {
    setDomain(name);
    setParams({ modus: "eintraege" });
    void run(name, types, selectedResolvers);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const ipMode = isIp(domain) && mode === "eintraege";
  const multi = (results?.[0]?.cells.length ?? 0) > 1;
  const fileBase = `dns-${(results?.[0]?.query ?? "abfrage").replace(/[^a-z0-9.-]+/gi, "_")}`;
  const typeChips = showMore ? [...commonRecordTypes, ...moreRecordTypes] : commonRecordTypes;
  const empty = results?.filter(isEmpty) ?? [];

  return (
    <div className="tool-body settings-form">
      <Segmented
        label="Funktion"
        value={mode}
        options={[
          ["eintraege", "Einträge abfragen"],
          ["subdomains", "Subdomains finden"],
        ]}
        onChange={(value) => {
          setError(null);
          setParams({ modus: value });
        }}
      />

      <form className="tool-row" onSubmit={onSubmit}>
        <label>
          {mode === "subdomains" ? "Domain" : "Domain oder IP-Adresse"}
          <input
            type="text"
            value={domain}
            spellCheck={false}
            placeholder={
              mode === "subdomains" ? "example.com" : "example.com, *.example.com oder 192.0.2.10"
            }
            onChange={(event) => setDomain(event.target.value)}
          />
        </label>
        <button
          type="submit"
          className="button button-primary"
          disabled={(mode === "subdomains" ? subBusy : loading) || !domain.trim()}
        >
          {mode === "subdomains"
            ? subBusy
              ? "Suche läuft …"
              : "Subdomains suchen"
            : loading
              ? "Frage ab …"
              : "Abfragen"}
        </button>
      </form>

      {mode === "eintraege" &&
        (ipMode ? (
          <p className="small">IP-Adresse erkannt: Es wird PTR abgefragt.</p>
        ) : (
          <div className="tool-row">
            <div className="chips" role="group" aria-label="Typ">
              {typeChips.map((type) => (
                <button
                  key={type}
                  type="button"
                  className="chip chip-filter"
                  aria-pressed={types.includes(type)}
                  onClick={() => toggleType(type)}
                >
                  {type}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="button button-link"
              aria-expanded={showMore}
              onClick={() => setShowMore(!showMore)}
            >
              {showMore ? "weniger Typen" : "weitere Typen"}
            </button>
            <button
              type="button"
              className="button button-link"
              onClick={() => setTypes(QUICK_COMMON)}
            >
              gängige
            </button>
            <button type="button" className="button button-link" onClick={() => setTypes(["A"])}>
              nur A
            </button>
          </div>
        ))}
      <div className="chips" role="group" aria-label="Resolver">
        {builtInResolvers.map((resolver) => (
          <button
            key={resolver.id}
            type="button"
            className="chip chip-filter"
            aria-pressed={selectedResolvers.some((entry) => entry.id === resolver.id)}
            onClick={() => toggleResolver(resolver)}
          >
            {resolver.name}
          </button>
        ))}
      </div>

      <NetNotice>
        Die Werkbank fragt die gewählten öffentlichen Resolver über DNS über HTTPS. Interne Namen,
        die nur das Firmen-DNS kennt, lösen sie nicht auf.
      </NetNotice>

      {error && <ErrorBox>{error}</ErrorBox>}
      {note && !error && <p className="small">{note}</p>}

      {mode === "subdomains" && (
        <SubdomainPanel
          domain={subDomain}
          trigger={subTrigger}
          resolver={selectedResolvers[0]!}
          onPick={pick}
          onBusy={setSubBusy}
        />
      )}

      {mode === "eintraege" && results && (
        <>
          <div className="tool-row">
            <p className="small" role="status">
              <span className="mono">{results[0]?.query}</span> · {results.length} Typ
              {results.length === 1 ? "" : "en"} · {selectedResolvers.length} Resolver
              {loading && " · aktualisiere …"}
            </p>
            {multi && (
              <Segmented
                label="Ansicht"
                value={side ? "nebeneinander" : "zusammen"}
                options={[
                  ["zusammen", "Zusammengefasst"],
                  ["nebeneinander", "Nebeneinander"],
                ]}
                onChange={(value) => setParams({ ansicht: value })}
              />
            )}
            <CopyButton value={toText(results)} label="Als Text kopieren" />
            <button
              type="button"
              className="button button-secondary"
              onClick={() =>
                downloadBlob(new Blob([toCsv(results)], { type: "text/csv" }), `${fileBase}.csv`)
              }
            >
              CSV
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={() =>
                downloadBlob(
                  new Blob([toJson(results)], { type: "application/json" }),
                  `${fileBase}.json`,
                )
              }
            >
              JSON
            </button>
          </div>
          <ul className="tool-cards dns-cards">
            {results
              .filter((tr) => !isEmpty(tr))
              .map((tr) => (
                <TypeCard key={tr.type} tr={tr} side={side} />
              ))}
          </ul>
          {empty.length > 0 && (
            <p className="tool-row small">
              Keine Einträge{multi ? " bei allen Resolvern" : ""}:
              {empty.map((tr) => (
                <span key={tr.type} className="pill pill-neutral mono">
                  {tr.type}
                </span>
              ))}
              ({empty[0]!.cells[0]!.result!.status})
            </p>
          )}
        </>
      )}
    </div>
  );
}
