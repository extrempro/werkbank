import { useRef, useState, type FormEvent, type MouseEvent } from "react";
import { Icon } from "../components/Icon";
import { Link } from "../components/Link";
import { PHONE_QUERY, useMediaQuery } from "../components/FilterBar";
import { HandbookMenuContent } from "../components/nav/HandbookMenu";
import { useModal } from "../components/nav/useModal";
import {
  areasFor,
  findTopic,
  HANDBOOK_PATH,
  searchHandbook,
  topicPath,
  topicRoles,
  topicsFor,
  type Area,
  type Block,
  type TopicRef,
} from "../handbook";
import { HELP } from "../help/terms";
import { navigate } from "../router";
import { roleInfo } from "../user";

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

/** Blatt „Alle Themen“ am Handy: dasselbe Menü wie am Computer im Seitenmenü. */
function TopicsSheet({
  roles,
  areaId,
  topicId,
  onClose,
}: {
  roles: readonly string[];
  areaId: string | null;
  topicId: string | null;
  onClose: () => void;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  useModal(sheet, true, onClose);
  const go = (event: MouseEvent<HTMLAnchorElement>, path: string) => {
    event.preventDefault();
    onClose();
    navigate(path);
  };
  return (
    <div
      className="sheet-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        ref={sheet}
        className="sheet handbook-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="handbuch-themen"
      >
        <div className="sheet-head">
          <h2 id="handbuch-themen" className="sheet-title">
            Themen
          </h2>
          <button type="button" className="sheet-close" aria-label="Schließen" onClick={onClose}>
            <Icon name="schliessen" />
          </button>
        </div>
        <div className="sheet-body handbook-menu">
          <HandbookMenuContent roles={roles} areaId={areaId} topicId={topicId} onNavigate={go} />
        </div>
      </div>
    </div>
  );
}

/** Am Handy: Knopf „Alle Themen“, der das Menü als Blatt öffnet. */
function PhoneTopics(props: {
  roles: readonly string[];
  areaId: string | null;
  topicId: string | null;
}) {
  const phone = useMediaQuery(PHONE_QUERY);
  const [open, setOpen] = useState(false);
  if (!phone) {
    return null;
  }
  return (
    <>
      <button
        type="button"
        className="button button-secondary handbook-all"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        Alle Themen
      </button>
      {open && <TopicsSheet {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

function rolesText(roles: readonly string[] | null): string {
  if (!roles) {
    return "alle";
  }
  const labels = roles
    .filter((role) => role !== "Werkbank.Admin")
    .map((role) => roleInfo(role).label);
  return labels.length ? labels.join(", ") : roleInfo("Werkbank.Admin").label;
}

/** Begriffe A–Z: alle Erklärungen der Info-Symbole, deren Thema die Person sehen darf. */
function Glossary({ roles }: { roles: readonly string[] }) {
  const entries = Object.values(HELP)
    .map((help) => ({ help, ref: findTopic(roles, help.topic[0], help.topic[1]) }))
    .filter((entry): entry is { help: (typeof entry)["help"]; ref: TopicRef } => entry.ref !== null)
    .sort((a, b) => a.help.term.localeCompare(b.help.term, "de"));
  if (entries.length === 0) {
    return <p className="empty">Für deine Rollen gibt es noch keine Begriffe.</p>;
  }
  return (
    <dl className="handbook-terms handbook-glossary">
      {entries.map(({ help, ref }) => (
        <div key={help.term}>
          <dt>{help.term}</dt>
          <dd>
            {help.text}{" "}
            <Link to={topicPath(ref.area.id, ref.topic.id)}>
              {ref.topic.title} ({ref.area.title})
            </Link>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function TopicView({ current, roles }: { current: TopicRef; roles: readonly string[] }) {
  const { area, part, topic } = current;
  const all = topicsFor(roles);
  const index = all.findIndex((ref) => ref.area.id === area.id && ref.topic.id === topic.id);
  const previous = index > 0 ? all[index - 1] : undefined;
  const next = index >= 0 ? all[index + 1] : undefined;
  const siblings = part.topics.filter((entry) => entry.id !== topic.id);
  const [first, ...rest] = topic.links ?? [];

  return (
    <div className="page handbook">
      <header className="page-head">
        <p className="module-label handbook-crumbs">
          <Link to={HANDBOOK_PATH}>Handbuch</Link> ›{" "}
          <Link to={topicPath(area.id)}>{area.title}</Link>
          {part.title ? ` › ${part.title}` : ""}
        </p>
        <h1>{topic.title}</h1>
        <div className="handbook-meta">
          <span className="pill pill-neutral">Für: {rolesText(topicRoles(area, part, topic))}</span>
          {first && (
            <Link to={first.to} className="handbook-open">
              {first.label} ›
            </Link>
          )}
          <PhoneTopics roles={roles} areaId={area.id} topicId={topic.id} />
        </div>
      </header>

      <section className="panel handbook-section" aria-label={topic.title}>
        <div className="detail-body handbook-body">
          {topic.blocks.map((block, position) => (
            <BlockView key={position} block={block} />
          ))}
          {topic.glossary && <Glossary roles={roles} />}
          {rest.length > 0 && (
            <p className="handbook-links">
              {rest.map((link) => (
                <Link key={link.to} to={link.to}>
                  {link.label}
                </Link>
              ))}
            </p>
          )}
        </div>
      </section>

      {siblings.length > 0 && (
        <nav className="panel handbook-related" aria-labelledby="handbuch-weitere">
          <h2 id="handbuch-weitere">Weitere Themen in {part.title ?? area.title}</h2>
          <ul>
            {siblings.map((entry) => (
              <li key={entry.id}>
                <Link to={topicPath(area.id, entry.id)}>{entry.title}</Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <nav className="handbook-pager" aria-label="Vorheriges und nächstes Thema">
        {previous ? (
          <Link to={topicPath(previous.area.id, previous.topic.id)}>‹ {previous.topic.title}</Link>
        ) : (
          <span />
        )}
        {next && <Link to={topicPath(next.area.id, next.topic.id)}>{next.topic.title} ›</Link>}
      </nav>
    </div>
  );
}

function AreaView({ area, roles }: { area: Area; roles: readonly string[] }) {
  return (
    <div className="page handbook">
      <header className="page-head">
        <p className="module-label">
          <Link to={HANDBOOK_PATH}>Handbuch</Link>
        </p>
        <h1>{area.title}</h1>
        <p className="page-sub">{area.summary}</p>
        <PhoneTopics roles={roles} areaId={area.id} topicId={null} />
      </header>
      {area.parts.map((part, index) => (
        <section
          key={part.title ?? index}
          className="panel handbook-part"
          aria-label={part.title ?? area.title}
        >
          {part.title && (
            <div className="panel-head">
              <h2>{part.title}</h2>
            </div>
          )}
          <ul className="detail-body handbook-topic-list">
            {part.topics.map((topic) => (
              <li key={topic.id}>
                <Link to={topicPath(area.id, topic.id)}>{topic.title}</Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Overview({ areas, roles }: { areas: Area[]; roles: readonly string[] }) {
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
          So arbeitest du mit der Werkbank. Du siehst die Themen, die zu deinen Rollen passen; im
          Menü stehen sie nach Bereichen geordnet.
        </p>
        <PhoneTopics roles={roles} areaId={null} topicId={null} />
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
                <li key={`${hit.area.id}-${hit.topic.id}`}>
                  <Link to={topicPath(hit.area.id, hit.topic.id)}>{hit.topic.title}</Link>
                  <span className="small"> · {hit.area.title}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <ul className="handbook-chapters">
        {areas.map((area) => (
          <li key={area.id} className="panel">
            <h2>
              <Link to={topicPath(area.id)}>{area.title}</Link>
            </h2>
            <p>{area.summary}</p>
            <p className="small">
              {area.parts.reduce((sum, part) => sum + part.topics.length, 0)} Themen
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Handbuch: Übersicht, ein Bereich oder ein Thema. Unbekanntes: null (nicht gefunden). */
export function HandbookPage({
  roles,
  areaId,
  topicId,
}: {
  roles: readonly string[];
  areaId: string | null;
  topicId: string | null;
}) {
  const areas = areasFor(roles);
  if (areaId === null) {
    return <Overview areas={areas} roles={roles} />;
  }
  if (topicId === null) {
    const area = areas.find((entry) => entry.id === areaId);
    return area ? <AreaView area={area} roles={roles} /> : null;
  }
  const current = findTopic(roles, areaId, topicId);
  return current ? <TopicView current={current} roles={roles} /> : null;
}
