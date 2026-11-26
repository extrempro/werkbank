import { useState } from "react";
import { fetchAchievements, fetchPeek, GLYPHS, type Peek } from "./api";
import { levelName, type BadgeStyle } from "./badges";
import { BadgeView } from "./BadgeView";

/**
 * Vitrine einer anderen Person (Ticketseite, bei „Zuständig“). Lädt erst beim Aufklappen. Ob
 * die Person Erfolge nutzt oder sie nur für sich hat, bleibt gleich verborgen.
 */
export function AchievementPeek({ oid, name }: { oid: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ peek: Peek | null; style: BadgeStyle } | null>(null);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && state === null) {
      const style = fetchAchievements().then(
        (mine) => mine.style,
        () => "wappen" as BadgeStyle,
      );
      Promise.all([fetchPeek(oid).catch(() => null), style]).then(([peek, s]) =>
        setState({ peek, style: s }),
      );
    }
  };

  return (
    <div className="erfolg-peek-wrap">
      <button type="button" className="row-button" aria-expanded={open} onClick={toggle}>
        {open ? "Erfolge ausblenden" : `Erfolge von ${name}`}
      </button>
      {open && !state && (
        <p className="small" role="status">
          Wird geladen …
        </p>
      )}
      {open && state && !state.peek && <p className="small">{name} zeigt keine Erfolge.</p>}
      {open && state?.peek && (
        <div>
          <p className="small">Gesamtstufe {state.peek.total}</p>
          {state.peek.showcase.length === 0 ? (
            <p className="small">Die Vitrine ist leer.</p>
          ) : (
            <ul className="plain erfolg-peek">
              {state.peek.showcase.map((item) => (
                <li key={item.id}>
                  <BadgeView
                    style={state.style}
                    level={item.level}
                    size={52}
                    glyph={GLYPHS[item.id]}
                  />
                  <span>
                    {item.name} · {levelName(state.style, item.level)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
