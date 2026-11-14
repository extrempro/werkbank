import { useEffect } from "react";
import { markReleaseSeen, RELEASES } from "../release-notes";

const dateFormat = new Intl.DateTimeFormat("de-DE", { dateStyle: "long" });

function formatDate(iso: string): string {
  return dateFormat.format(new Date(`${iso}T00:00:00`));
}

interface NewsPageProps {
  /** Wird aufgerufen, sobald die Neuigkeiten als gesehen gelten. */
  onSeen?: () => void;
}

/** Was sich in der Werkbank geändert hat – nur, was man in der Anwendung bemerkt. */
export function NewsPage({ onSeen }: NewsPageProps) {
  useEffect(() => {
    markReleaseSeen();
    onSeen?.();
  }, [onSeen]);

  return (
    <div className="news">
      <header className="page-head">
        <h1>Neuigkeiten</h1>
        <p className="page-sub">Was sich in der Werkbank geändert hat.</p>
      </header>
      {RELEASES.map((release) => (
        <section
          className="panel news-release"
          key={release.version}
          aria-labelledby={`version-${release.version}`}
        >
          <div className="panel-head">
            <h2 id={`version-${release.version}`}>Version {release.version}</h2>
            <span className="small">{formatDate(release.date)}</span>
          </div>
          <div className="news-body">
            <p>{release.summary}</p>
            {release.sections.map((section) => (
              <div key={section.area}>
                <h3>{section.area}</h3>
                <ul>
                  {section.entries.map((entry) => (
                    <li key={entry}>{entry}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
