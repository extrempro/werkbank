import { useEffect, useRef, useState } from "react";
import { downloadBlob } from "../download";
import { CopyButton, ErrorBox } from "../ui";
import type { Resolver } from "./resolvers";
import {
  commonSubdomains,
  findSubdomains,
  subdomainsToCsv,
  type Subdomain,
  type SubdomainResult,
} from "./subdomains";

type Filter = "live" | "wildcard" | "dead";

const DATE = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });

function classify(entry: Subdomain): Filter {
  if (entry.viaWildcard) {
    return "wildcard";
  }
  return entry.live ? "live" : "dead";
}

const FILTERS: readonly (readonly [Filter, string])[] = [
  ["live", "aktiv"],
  ["wildcard", "über Wildcard"],
  ["dead", "löst nicht auf"],
];

/** Subdomains finden. `trigger` wechselt bei jedem Klick auf „Subdomains suchen“. */
export function SubdomainPanel({
  domain,
  trigger,
  resolver,
  onPick,
  onBusy,
}: {
  domain: string | null;
  trigger: number;
  resolver: Resolver;
  onPick: (name: string) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [useCrtSh, setUseCrtSh] = useState(true);
  const [useList, setUseList] = useState(true);
  const [result, setResult] = useState<SubdomainResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ text: string; done?: number; total?: number } | null>(
    null,
  );
  const [filters, setFilters] = useState<Set<Filter>>(new Set<Filter>(["live", "dead"]));
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!domain || trigger === 0) {
      return undefined;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    // Der Start einer neuen Suche setzt die Anzeige zurück; Ergebnisse kommen später.
    queueMicrotask(() => {
      if (controller.signal.aborted) {
        return;
      }
      setError(null);
      setResult(null);
      onBusy(true);
    });
    findSubdomains({
      domain,
      resolver,
      useCrtSh,
      useList,
      signal: controller.signal,
      onProgress: (text, done, total) => {
        if (!controller.signal.aborted) {
          setProgress({ text, done, total });
        }
      },
    })
      .then(
        (found) => {
          if (!controller.signal.aborted) {
            setResult(found);
          }
        },
        (caught: unknown) => {
          if (!controller.signal.aborted) {
            setError((caught as Error).message);
          }
        },
      )
      .finally(() => {
        if (abortRef.current === controller) {
          setProgress(null);
          onBusy(false);
        }
      });
    return () => controller.abort();
    // Nur bei einer neuen Suche starten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  const cancel = () => {
    abortRef.current?.abort();
    setProgress(null);
    onBusy(false);
  };

  const counts: Record<Filter, number> = { live: 0, wildcard: 0, dead: 0 };
  for (const entry of result?.items ?? []) {
    counts[classify(entry)]++;
  }
  const shown = (result?.items ?? []).filter((entry) => filters.has(classify(entry)));
  const toggle = (filter: Filter) =>
    setFilters((previous) => {
      const next = new Set(previous);
      if (next.has(filter)) {
        next.delete(filter);
      } else {
        next.add(filter);
      }
      return next;
    });

  return (
    <>
      <fieldset className="tool-options">
        <legend>Quellen</legend>
        <p className="small">
          Eine vollständige Liste aller Subdomains gibt es im öffentlichen DNS nicht, weil
          Zonentransfers gesperrt sind. Gesucht wird deshalb hier:
        </p>
        <label className="check-label">
          <input
            type="checkbox"
            className="check"
            checked={useCrtSh}
            onChange={(event) => setUseCrtSh(event.target.checked)}
          />
          Zertifikats-Logs (crt.sh): jeder Name, für den je ein öffentliches Zertifikat ausgestellt
          wurde. Die Domain geht dabei über die Werkbank an crt.sh.
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            className="check"
            checked={useList}
            onChange={(event) => setUseList(event.target.checked)}
          />
          Typische Namen wie www, mail, vpn, autodiscover, api ({commonSubdomains.length})
        </label>
        <p className="small">
          Aufgelöst wird über {resolver.name}. Interne Namen ohne öffentliches Zertifikat findet
          keine der beiden Quellen.
        </p>
      </fieldset>

      {progress && (
        <div className="tool-row" role="status">
          <label>
            {progress.text}
            {progress.total ? `: ${progress.done ?? 0} von ${progress.total}` : ""}
            <progress
              max={progress.total ?? undefined}
              value={progress.total ? (progress.done ?? 0) : undefined}
            />
          </label>
          <button type="button" className="button button-secondary" onClick={cancel}>
            Abbrechen
          </button>
        </div>
      )}

      {error && <ErrorBox>{error}</ErrorBox>}

      {result && (
        <>
          {result.warnings.map((warning) => (
            <p key={warning} className="hint-box hint-warn">
              {warning}
            </p>
          ))}
          {result.wildcard && (
            <p className="hint-box hint-warn">
              {result.domain} hat einen Wildcard-Eintrag ({result.wildcard.join(", ")}): Jeder
              beliebige Name löst auf. Namen mit genau dieser Antwort stehen unter „über Wildcard“.
            </p>
          )}
          <div className="tool-row">
            <div className="chips" role="group" aria-label="Filter">
              {FILTERS.map(([filter, label]) => (
                <button
                  key={filter}
                  type="button"
                  className="chip chip-filter"
                  aria-pressed={filters.has(filter)}
                  onClick={() => toggle(filter)}
                >
                  {label} {counts[filter]}
                </button>
              ))}
            </div>
            <CopyButton
              value={shown.map((entry) => entry.name).join("\n")}
              label="Namen kopieren"
            />
            <button
              type="button"
              className="button button-secondary"
              disabled={shown.length === 0}
              onClick={() =>
                downloadBlob(
                  new Blob([subdomainsToCsv(shown)], { type: "text/csv" }),
                  `subdomains-${result.domain}.csv`,
                )
              }
            >
              CSV
            </button>
          </div>

          {shown.length === 0 ? (
            <p className="small">
              {result.items.length
                ? "Keine Einträge für die gewählten Filter."
                : "Keine Subdomains gefunden."}
            </p>
          ) : (
            <ul className="image-list">
              {shown.map((entry) => {
                const kind = classify(entry);
                return (
                  <li key={entry.name} className="image-item">
                    <div className="image-info">
                      <button
                        type="button"
                        className="button button-link mono tool-break"
                        onClick={() => onPick(entry.name)}
                      >
                        {entry.name}
                      </button>
                      <span className="tool-row">
                        {kind === "live" && <span className="pill pill-ok">aktiv</span>}
                        {kind === "wildcard" && (
                          <span className="pill pill-todo">über Wildcard</span>
                        )}
                        {kind === "dead" && !entry.error && (
                          <span className="pill pill-neutral">löst nicht auf</span>
                        )}
                        {entry.error && <span className="pill pill-bad">{entry.error}</span>}
                        {entry.sources.includes("crtsh") && (
                          <span className="pill pill-neutral">
                            Zertifikat{entry.certWildcard ? " (Wildcard)" : ""}
                          </span>
                        )}
                        {entry.sources.includes("list") && (
                          <span className="pill pill-neutral">typischer Name</span>
                        )}
                        {entry.lastSeen && (
                          <span className="small">zuletzt {DATE.format(entry.lastSeen)}</span>
                        )}
                      </span>
                    </div>
                    <div className="image-info small mono tool-break">
                      {entry.cname && <span>→ {entry.cname}</span>}
                      {entry.addresses.length > 0 && <span>{entry.addresses.join(", ")}</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </>
  );
}
