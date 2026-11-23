import { useEffect, useRef, useState, type FormEvent } from "react";
import { NetNotice } from "../NetNotice";
import { builtInResolvers } from "../dns-lookup/resolvers";
import { toQueryName } from "../dns-lookup/subdomains";
import { dropParams, readParam, useToolParams } from "../params";
import { CopyButton, ErrorBox } from "../ui";
import { runMailCheck, type CheckResult, type Section } from "./check";
import type { Level, SpfNode } from "./records";

const PILL: Record<Level, string> = {
  ok: "pill pill-ok",
  info: "pill pill-neutral",
  warn: "pill pill-todo",
  error: "pill pill-bad",
};
const LABEL: Record<Level, string> = {
  ok: "OK",
  info: "Hinweis",
  warn: "Warnung",
  error: "Fehler",
};
const RANK: Record<Level, number> = { error: 0, warn: 1, info: 2, ok: 3 };

function worst(section: Section): Level {
  return section.findings.reduce<Level>(
    (current, finding) => (RANK[finding.level] < RANK[current] ? finding.level : current),
    "ok",
  );
}

function SpfTree({ node, depth = 0 }: { node: SpfNode; depth?: number }) {
  return (
    <li>
      <span className="mono">{node.domain}</span>{" "}
      <span className="small">
        {node.lookups} Lookup{node.lookups === 1 ? "" : "s"}
      </span>
      {!node.record && depth > 0 && <span className="pill pill-bad">kein SPF</span>}
      {node.record && depth > 0 && <span className="small mono tool-break"> {node.record}</span>}
      {node.children.length > 0 && (
        <ul className="tool-list">
          {node.children.map((child) => (
            <SpfTree key={child.domain} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

function SectionCard({ section, result }: { section: Section; result: CheckResult }) {
  const level = worst(section);
  const sorted = [...section.findings].sort((left, right) => RANK[left.level] - RANK[right.level]);
  return (
    <li className="tool-card">
      <div className="tool-card-head">
        <h3>{section.title}</h3>
        <span className={PILL[level]}>{LABEL[level]}</span>
      </div>
      <ul className="tool-list">
        {sorted.map((finding, index) => (
          <li key={index}>
            <span className={PILL[finding.level]}>{LABEL[finding.level]}</span> {finding.title}
            {finding.detail && <span className="small tool-break"> {finding.detail}</span>}
          </li>
        ))}
      </ul>
      {section.id === "spf" && result.spf.tree && result.spf.tree.children.length > 0 && (
        <details className="budget-more">
          <summary>include-Baum ({result.spf.lookups} Lookups)</summary>
          <div className="budget-more-body">
            <ul className="tool-list">
              <SpfTree node={result.spf.tree} />
            </ul>
          </div>
        </details>
      )}
      {section.records && section.records.length > 0 && (
        <dl className="mail-records">
          {section.records.map((record, index) => (
            <div key={index}>
              <dt className="small">{record.label}</dt>
              <dd>
                <span className="mono tool-break">{record.value}</span>
                {record.note && <span className="small"> {record.note}</span>}{" "}
                <CopyButton value={record.value} label={`${record.label} kopieren`} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  );
}

export default function MailCheckTool() {
  // In der Adresszeile steht nur der Resolver; die Domain nicht.
  const [params, setParams] = useToolParams({ resolver: "cloudflare" });
  const resolver =
    builtInResolvers.find((entry) => entry.id === params.resolver) ?? builtInResolvers[0]!;
  // Ein Verweis aus einem anderen Tool (z. B. E-Mail-Header) bringt die Domain mit.
  const [domain, setDomain] = useState(() => readParam("domain"));
  const [selectors, setSelectors] = useState("");
  const [result, setResult] = useState<CheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = async (input: string, selectorText: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setResult(null);
    try {
      const query = toQueryName(input);
      if (query.name.startsWith("*.")) {
        throw new Error("Bitte gib eine Domain ohne * ein.");
      }
      setProgress("Starte");
      const checked = await runMailCheck({
        domain: query.name,
        selectors: selectorText.split(/[\s,;]+/).filter(Boolean),
        resolver,
        signal: controller.signal,
        onProgress: (text) => {
          if (!controller.signal.aborted) {
            setProgress(text);
          }
        },
      });
      if (!controller.signal.aborted) {
        setResult(checked);
      }
    } catch (caught) {
      if (!controller.signal.aborted) {
        setError(
          (caught as Error).name === "TimeoutError"
            ? "Zeitüberschreitung bei einer DNS-Abfrage."
            : (caught as Error).message,
        );
      }
    } finally {
      if (abortRef.current === controller) {
        setProgress(null);
      }
    }
  };

  // Mitgebrachte Domain gleich prüfen und aus der Adresszeile nehmen.
  useEffect(() => {
    const linked = readParam("domain");
    dropParams(["domain"]);
    if (linked) {
      queueMicrotask(() => void run(linked, ""));
    }
    return () => abortRef.current?.abort();
    // Nur beim Öffnen des Tools.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void run(domain, selectors);
  };

  const counts = { ok: 0, info: 0, warn: 0, error: 0 };
  for (const section of result?.sections ?? []) {
    for (const finding of section.findings) {
      counts[finding.level]++;
    }
  }

  return (
    <div className="tool-body settings-form">
      <form className="tool-row" onSubmit={onSubmit}>
        <label>
          Domain
          <input
            type="text"
            value={domain}
            spellCheck={false}
            placeholder="example.com"
            onChange={(event) => setDomain(event.target.value)}
          />
        </label>
        <label>
          DKIM-Selektoren (freiwillig)
          <input
            type="text"
            value={selectors}
            spellCheck={false}
            placeholder="z. B. s1, mail2024"
            onChange={(event) => setSelectors(event.target.value)}
          />
        </label>
        <label className="narrow">
          Resolver
          <select
            value={resolver.id}
            onChange={(event) => setParams({ resolver: event.target.value })}
          >
            {builtInResolvers.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="button button-primary"
          disabled={progress !== null || !domain.trim()}
        >
          {progress !== null ? "Prüfe …" : "Prüfen"}
        </button>
      </form>
      <NetNotice>
        Geprüft wird das öffentliche DNS über den gewählten Resolver; die Werkbank stellt die
        Abfragen. Gängige DKIM-Selektoren (Microsoft 365, Google und andere) werden automatisch
        versucht; eigene stehen im Header „DKIM-Signature: s=…“ einer gesendeten Mail.
      </NetNotice>

      {progress !== null && (
        <p className="small" role="status">
          Prüfe: {progress} …
        </p>
      )}
      {error && <ErrorBox>{error}</ErrorBox>}

      {result && (
        <>
          <p className="tool-row" role="status">
            <strong className="mono">{result.domain}</strong>
            {counts.error > 0 && <span className="pill pill-bad">{counts.error} Fehler</span>}
            {counts.warn > 0 && <span className="pill pill-todo">{counts.warn} Warnungen</span>}
            <span className="pill pill-ok">{counts.ok} OK</span>
            <span className="pill pill-neutral">{counts.info} Hinweise</span>
            <span className="small">{result.queries} DNS-Abfragen</span>
          </p>
          <ul className="tool-cards mail-sections">
            {result.sections.map((section) => (
              <SectionCard key={section.id} section={section} result={result} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
