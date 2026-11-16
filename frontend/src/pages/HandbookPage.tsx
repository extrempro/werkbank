import { useEffect, useState, type FormEvent } from "react";
import { Link } from "../components/Link";
import {
  chapterPath,
  chaptersFor,
  HANDBOOK_PATH,
  searchHandbook,
  type Block,
  type Chapter,
} from "../handbook";

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "text":
      return <p>{block.text}</p>;
    case "hint":
      return (
        <p className="hint-box">
          <strong>Hinweis: </strong>
          {block.text}
        </p>
      );
    case "list":
      return (
        <ul>
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );
    case "steps":
      return (
        <ol className="handbook-steps">
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      );
    case "terms":
      return (
        <dl className="handbook-terms">
          {block.items.map(([term, meaning]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{meaning}</dd>
            </div>
          ))}
        </dl>
      );
  }
}

/** Abschnitt aus der Adresse (…#ablauf); Unbrauchbares ergibt nichts. */
function hashSection(): string {
  const raw = window.location.hash.slice(1);
  return /^[a-z0-9-]{1,60}$/.test(raw) ? raw : "";
}

function ChapterView({ chapter, chapters }: { chapter: Chapter; chapters: Chapter[] }) {
  const [target, setTarget] = useState(hashSection);
  useEffect(() => {
    const update = () => setTarget(hashSection());
    window.addEventListener("hashchange", update);
    window.addEventListener("werkbank:navigate", update);
    return () => {
      window.removeEventListener("hashchange", update);
      window.removeEventListener("werkbank:navigate", update);
    };
  }, []);
  useEffect(() => {
    if (target) {
      document.getElementById(target)?.scrollIntoView({ block: "start" });
    }
  }, [target, chapter.id]);

  const index = chapters.findIndex((entry) => entry.id === chapter.id);
  const previous = index > 0 ? chapters[index - 1] : undefined;
  const next = index >= 0 ? chapters[index + 1] : undefined;

  return (
    <div className="page handbook">
      <header className="page-head">
        <p className="module-label">
          <Link to={HANDBOOK_PATH}>Handbuch</Link>
        </p>
        <h1>{chapter.title}</h1>
        <p className="page-sub">{chapter.summary}</p>
      </header>

      <nav className="panel handbook-toc" aria-labelledby="handbuch-inhalt">
        <h2 id="handbuch-inhalt">Inhalt</h2>
        <ol>
          {chapter.sections.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`}>{section.title}</a>
            </li>
          ))}
        </ol>
      </nav>

      {chapter.sections.map((section) => (
        <section
          key={section.id}
          id={section.id}
          className="panel handbook-section"
          aria-labelledby={`${section.id}-titel`}
        >
          <div className="panel-head">
            <h2 id={`${section.id}-titel`}>{section.title}</h2>
          </div>
          <div className="detail-body handbook-body">
            {section.blocks.map((block, position) => (
              <BlockView key={position} block={block} />
            ))}
            {section.links && section.links.length > 0 && (
              <p className="handbook-links">
                {section.links.map((link) => (
                  <Link key={link.to} to={link.to}>
                    {link.label}
                  </Link>
                ))}
              </p>
            )}
          </div>
        </section>
      ))}

      <nav className="handbook-pager" aria-label="Weitere Kapitel">
        {previous ? <Link to={chapterPath(previous.id)}>← {previous.title}</Link> : <span />}
        {next && <Link to={chapterPath(next.id)}>{next.title} →</Link>}
      </nav>
    </div>
  );
}

function Overview({ chapters, roles }: { chapters: Chapter[]; roles: readonly string[] }) {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const hits = query.length >= 2 ? searchHandbook(query, roles, 20) : [];

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setQuery(draft.trim());
  };

  return (
    <div className="page handbook">
      <header className="page-head">
        <h1>Handbuch</h1>
        <p className="page-sub">
          So arbeitest du mit der Werkbank. Du siehst die Kapitel, die zu deinen Rollen passen.
        </p>
      </header>

      <form className="search-form" role="search" onSubmit={onSubmit}>
        <label htmlFor="handbuch-suche">Im Handbuch suchen</label>
        <div className="search-row">
          <input
            id="handbuch-suche"
            type="search"
            value={draft}
            maxLength={100}
            autoComplete="off"
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit" className="button button-primary">
            Suchen
          </button>
        </div>
      </form>

      {query.length >= 2 && (
        <section className="panel" aria-labelledby="handbuch-treffer">
          <div className="panel-head">
            <h2 id="handbuch-treffer">Treffer</h2>
            <span className="small" role="status">
              {hits.length === 0 ? `Keine Treffer für „${query}“` : `${hits.length} Treffer`}
            </span>
          </div>
          {hits.length > 0 && (
            <ul className="detail-body handbook-hits">
              {hits.map((hit) => (
                <li key={`${hit.chapter.id}-${hit.section.id}`}>
                  <Link to={chapterPath(hit.chapter.id, hit.section.id)}>{hit.section.title}</Link>
                  <span className="small"> · {hit.chapter.title}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <ul className="handbook-chapters">
        {chapters.map((chapter) => (
          <li key={chapter.id} className="panel">
            <h2>
              <Link to={chapterPath(chapter.id)}>{chapter.title}</Link>
            </h2>
            <p>{chapter.summary}</p>
            <p className="small">{chapter.sections.map((section) => section.title).join(" · ")}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Handbuch: Übersicht der Kapitel oder ein Kapitel. Unbekannte Kapitel: null (nicht gefunden). */
export function HandbookPage({
  roles,
  chapterId,
}: {
  roles: readonly string[];
  chapterId: string | null;
}) {
  const chapters = chaptersFor(roles);
  if (chapterId === null) {
    return <Overview chapters={chapters} roles={roles} />;
  }
  const chapter = chapters.find((entry) => entry.id === chapterId);
  return chapter ? <ChapterView chapter={chapter} chapters={chapters} /> : null;
}
