import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { formatDay } from "../../components/LineChart";
import {
  credentialKind,
  LEVEL_INFO,
  remainingText,
  type Credential,
  type CredentialLevel,
} from "./api";
import { hexLayout, hexPoints, nameLines, shortRemaining } from "./honeycomb";

const DEFAULT_WIDTH = 680;
const MIN_WIDTH = 240;
const POINTS = hexPoints();
const LEVELS: CredentialLevel[] = ["abgelaufen", "dringend", "warnung", "hinweis", "ok"];

function expiry(entry: Credential): string {
  return entry.expires_at ? formatDay(entry.expires_at.slice(0, 10)) : "–";
}

function describe(entry: Credential): string {
  return `${entry.owner_name}, ${credentialKind(entry)}, ${remainingText(entry.days_left)}, läuft ab ${expiry(entry)}`;
}

/** Alle Zertifikate und Secrets als Waben, das Dringendste zuerst. */
export function Honeycomb({ entries }: { entries: Credential[] }) {
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    const element = frame.current;
    if (!element || typeof ResizeObserver === "undefined") {
      return undefined;
    }
    const observer = new ResizeObserver((observed) => {
      const measured = observed[0]?.contentRect.width ?? 0;
      if (measured > 0) {
        setWidth(Math.round(Math.max(MIN_WIDTH, measured)));
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const layout = hexLayout(entries.length, width);
  const selected = entries.find((entry) => entry.id === selectedId) ?? null;
  const counts = LEVELS.map(
    (level) => [level, entries.filter((entry) => entry.level === level).length] as const,
  ).filter(([, count]) => count > 0);

  const toggle = (id: number) => setSelectedId(id === selectedId ? null : id);
  const onKey = (event: KeyboardEvent, id: number) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggle(id);
    }
  };

  return (
    <div className="waben" ref={frame}>
      <svg
        className="waben-bild"
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="group"
        aria-label="Zertifikate und Secrets als Waben, sortiert nach Ablauf"
      >
        {entries.map((entry, index) => {
          const center = layout.centers[index] ?? { x: 0, y: 0 };
          const lines = nameLines(entry.owner_name);
          const twoLines = lines.length > 1;
          return (
            <g
              key={entry.id}
              className={`wabe wabe-${entry.level}`}
              transform={`translate(${center.x.toFixed(1)} ${center.y.toFixed(1)})`}
              role="button"
              tabIndex={0}
              aria-pressed={entry.id === selectedId}
              aria-label={describe(entry)}
              onClick={() => toggle(entry.id)}
              onKeyDown={(event) => onKey(event, entry.id)}
            >
              <title>{describe(entry)}</title>
              <polygon points={POINTS} />
              {lines.map((line, position) => (
                <text
                  key={position}
                  className="wabe-name"
                  textAnchor="middle"
                  y={(twoLines ? -24 : -14) + position * 14}
                >
                  {line}
                </text>
              ))}
              <text className="wabe-zeile" textAnchor="middle" y={twoLines ? 8 : 5}>
                {shortRemaining(entry.days_left)}
              </text>
              <text className="wabe-zeile" textAnchor="middle" y={twoLines ? 24 : 22}>
                {expiry(entry)}
              </text>
            </g>
          );
        })}
      </svg>
      <ul className="waben-legende" aria-label="Legende">
        {counts.map(([level, count]) => (
          <li key={level}>
            <span className={`waben-farbe wabe-${level}`} aria-hidden="true" />
            {LEVEL_INFO[level].text} ({count})
          </li>
        ))}
      </ul>
      <div className="panel waben-detail" aria-live="polite">
        {selected ? (
          <>
            <h2>{selected.owner_name}</h2>
            <dl className="facts">
              <dt>Art</dt>
              <dd>{credentialKind(selected)}</dd>
              <dt>Bezeichnung</dt>
              <dd>{selected.name ?? "–"}</dd>
              <dt>Läuft ab</dt>
              <dd>
                {expiry(selected)} ({remainingText(selected.days_left)})
              </dd>
              <dt>Stand</dt>
              <dd>
                <span className={`pill pill-${LEVEL_INFO[selected.level].tone}`}>
                  {LEVEL_INFO[selected.level].text}
                </span>
              </dd>
              {selected.app_id && (
                <>
                  <dt>App-ID</dt>
                  <dd className="mono tool-break">{selected.app_id}</dd>
                </>
              )}
            </dl>
          </>
        ) : (
          <p className="small">Eine Wabe auswählen, um die Einzelheiten zu sehen.</p>
        )}
      </div>
    </div>
  );
}
