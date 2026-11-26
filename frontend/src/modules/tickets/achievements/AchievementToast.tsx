import { useEffect, useRef, useState } from "react";
import { fetchAchievements, GLYPHS, markSeen, type LevelRef } from "./api";
import { levelName, type BadgeStyle } from "./badges";
import { BadgeView } from "./BadgeView";

/** So lange bleibt die Einblendung stehen. */
export const TOAST_MS = 6000;

/**
 * Einblendung „Neue Stufe“: prüft nach jeder Änderung am Ticket (`trigger`), ob eine Stufe
 * dazugekommen ist. Nur mit eingeschalteten Erfolgen und Einblendung; ohne Ton.
 */
export function AchievementToast({ trigger }: { trigger: string }) {
  const [shown, setShown] = useState<{ item: LevelRef; more: number; style: BadgeStyle } | null>(
    null,
  );
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    let active = true;
    fetchAchievements()
      .then((data) => {
        const item = data.new[0];
        if (!active || !data.enabled || !data.toast || !item) {
          return;
        }
        setShown({ item, more: data.new.length - 1, style: data.style });
        void markSeen().catch(() => undefined);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [trigger]);

  useEffect(() => {
    if (!shown) {
      return;
    }
    const timer = window.setTimeout(() => setShown(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [shown]);

  return (
    <div role="status" aria-live="polite">
      {shown && (
        <div className="erfolg-toast">
          <BadgeView
            style={shown.style}
            level={shown.item.level}
            size={56}
            glyph={GLYPHS[shown.item.id]}
          />
          <div>
            <p className="erfolg-toast-kopf">NEUE STUFE</p>
            <p>
              <strong>
                {shown.item.name} · {levelName(shown.style, shown.item.level)}
              </strong>
            </p>
            <p className="small">
              Stufe {shown.item.level} von 30
              {shown.more > 0 && ` · und ${shown.more} weitere`}
            </p>
          </div>
          <button type="button" aria-label="Einblendung schließen" onClick={() => setShown(null)}>
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
