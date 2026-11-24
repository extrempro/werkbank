import { useEffect, useState } from "react";
import { formatDateTime } from "../../api";
import { InfoTip } from "../../components/InfoTip";
import { Link } from "../../components/Link";
import { fetchBacklinks, pagePath, type Backlink, type RefKind } from "./api";

/**
 * „In der Dokumentation“ an einem Objekt: Seiten, die darauf verweisen. Nur für Personen, die
 * die Dokumentation nutzen dürfen, und nur Seiten, die sie lesen dürfen (prüft der Server).
 * Ohne Zugang zur Dokumentation erscheint nichts.
 */
export function DokuBacklinks({ kind, id }: { kind: RefKind; id: string | number }) {
  const [pages, setPages] = useState<Backlink[] | null>(null);
  const [hidden, setHidden] = useState(false);
  const key = String(id);
  useEffect(() => {
    let active = true;
    fetchBacklinks(kind, key).then(
      (found) => {
        if (active) {
          // Nur eine Liste ist eine Antwort; alles andere wie „kein Zugang“ behandeln
          setPages(Array.isArray(found) ? found : null);
          setHidden(!Array.isArray(found));
        }
      },
      () => active && setHidden(true),
    );
    return () => {
      active = false;
    };
  }, [kind, key]);
  if (hidden || pages === null) {
    return null;
  }
  return (
    <section
      className="panel doku-side-panel doku-backlinks"
      aria-labelledby={`doku-rueck-${kind}`}
    >
      <h2 id={`doku-rueck-${kind}`}>
        In der Dokumentation <InfoTip term="doku.verweise" />
      </h2>
      {pages.length === 0 ? (
        <p className="small">Keine Seite, die du lesen darfst, verweist hierauf.</p>
      ) : (
        <ul>
          {pages.map((page) => (
            <li key={page.id}>
              <Link to={pagePath(page.id)}>{page.title}</Link>
              <p className="small">
                {[page.path, `geändert ${formatDateTime(page.updated_at)}`]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
