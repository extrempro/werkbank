import { useEffect, useId, useState } from "react";
import { errorText } from "../../../api";
import { useConfirm } from "../../../components/ConfirmDialog";
import { Feedback, type FeedbackMessage } from "../../../components/Feedback";
import { InfoTip } from "../../../components/InfoTip";
import { PreviewChoice } from "../../../components/PreviewChoice";
import {
  fetchAchievements,
  GLYPHS,
  saveAchievementSettings,
  saveShowcase,
  WHAT_COUNTS,
  type Achievements,
  type AchievementSettings,
  type CategoryState,
  type ShowcaseId,
} from "./api";
import { levelName, RANK_NAMES, STYLE_LABELS, STYLES, type BadgeStyle } from "./badges";
import { BadgeView } from "./BadgeView";

const fmt = (value: number) => value.toLocaleString("de-DE");

/** Tickets › Meine Erfolge: freiwillig, Standard aus, Stil frei wählbar. */
export function AchievementsPage() {
  const [data, setData] = useState<Achievements | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [message, setMessage] = useState<FeedbackMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const [ask, confirmDialog] = useConfirm();
  const audienceName = useId();

  useEffect(() => {
    fetchAchievements().then(setData, (problem: unknown) =>
      setFailed(errorText(problem, "Die Erfolge konnten nicht geladen werden.")),
    );
  }, []);

  if (failed) {
    return (
      <div className="page">
        <p role="alert" className="hint-box hint-bad">
          {failed}
        </p>
      </div>
    );
  }
  if (!data) {
    return (
      <p className="page-message" role="status">
        Wird geladen …
      </p>
    );
  }

  const settings: AchievementSettings = {
    enabled: data.enabled,
    audience: data.audience,
    toast: data.toast,
    style: data.style,
  };

  const save = (next: AchievementSettings, done: string) => {
    setBusy(true);
    saveAchievementSettings(next)
      .then((result) => {
        setData(result);
        setMessage({ kind: "status", text: done });
      })
      .catch((problem: unknown) =>
        setMessage({
          kind: "alert",
          text: errorText(problem, "Die Einstellung konnte nicht gespeichert werden."),
        }),
      )
      .finally(() => setBusy(false));
  };

  const toggle = (enabled: boolean) => {
    if (enabled) {
      save({ ...settings, enabled }, "Erfolge sind eingeschaltet. Ab jetzt wird gezählt.");
      return;
    }
    ask(
      {
        title: "Erfolge ausschalten?",
        text: "Die Werkbank löscht dabei alle gesammelten Erfolge und deine Vitrine. Schaltest du sie später wieder ein, beginnt alles bei null.",
        action: "Ausschalten",
        danger: true,
      },
      () => save({ ...settings, enabled: false }, "Erfolge sind ausgeschaltet."),
    );
  };

  const pin = (id: ShowcaseId) => {
    const next = data.showcase.includes(id)
      ? data.showcase.filter((s) => s !== id)
      : [...data.showcase, id];
    saveShowcase(next).then(
      (result) => {
        setData(result);
        setMessage({
          kind: "status",
          text: data.showcase.includes(id)
            ? "Aus der Vitrine genommen."
            : "In die Vitrine gestellt.",
        });
      },
      (problem: unknown) =>
        setMessage({
          kind: "alert",
          text: errorText(problem, "Die Vitrine konnte nicht gespeichert werden."),
        }),
    );
  };

  const style = data.style;
  const allrounder: CategoryState = {
    id: "chronist",
    name: "Allrounder",
    count: 0,
    level: data.allrounder,
    current_at: 0,
    next_at: null,
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="module-label">Tickets</p>
          <h1>Meine Erfolge</h1>
          <p className="page-sub">
            Kleine Meilensteine für sorgfältige Ticketarbeit. Freiwillig, ohne Rangliste und ohne
            Zeitmessung.
            <InfoTip term="tickets.erfolge" />
          </p>
        </div>
      </header>
      <Feedback message={message} onClose={() => setMessage(null)} />
      {confirmDialog}

      <section className="panel" aria-labelledby="erfolge-einstellungen">
        <div className="panel-head">
          <h2 id="erfolge-einstellungen">Einstellungen</h2>
          <span className="small">gilt für dein Konto</span>
        </div>
        <div className="detail-body settings-form">
          <label className="check-label">
            <input
              type="checkbox"
              checked={data.enabled}
              disabled={busy}
              onChange={(event) => toggle(event.target.checked)}
            />
            Erfolge sammeln
          </label>
          <p className="small">
            Gezählt wird erst ab dem Einschalten, nichts rückwirkend. Ausgeschaltet zählt die
            Werkbank nichts.
          </p>
          {data.enabled && (
            <>
              <fieldset className="theme-switch" disabled={busy}>
                <legend>
                  Wer sieht meine Erfolge? <InfoTip term="tickets.erfolge-sichtbar" />
                </legend>
                <div className="theme-options">
                  <label>
                    <input
                      type="radio"
                      name={audienceName}
                      checked={data.audience === "me"}
                      onChange={() =>
                        save({ ...settings, audience: "me" }, "Nur du siehst deine Erfolge.")
                      }
                    />
                    <span>Nur ich</span>
                  </label>
                  <label>
                    <input
                      type="radio"
                      name={audienceName}
                      checked={data.audience === "areas"}
                      onChange={() =>
                        save(
                          { ...settings, audience: "areas" },
                          "Mitglieder deiner Bereiche sehen jetzt deine Vitrine.",
                        )
                      }
                    />
                    <span>Mitglieder meiner Bereiche</span>
                  </label>
                </div>
              </fieldset>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={data.toast}
                  disabled={busy}
                  onChange={(event) =>
                    save(
                      { ...settings, toast: event.target.checked },
                      event.target.checked
                        ? "Neue Stufen werden kurz eingeblendet."
                        : "Keine Einblendung mehr bei neuen Stufen.",
                    )
                  }
                />
                Kurze Einblendung bei neuer Stufe
              </label>
              <PreviewChoice<BadgeStyle>
                legend="Stil der Abzeichen"
                value={style}
                disabled={busy}
                options={STYLES.map((s) => ({
                  value: s,
                  label: STYLE_LABELS[s],
                  preview: <BadgeView style={s} level={18} size={52} glyph={GLYPHS.chronist} />,
                }))}
                onChange={(s) => save({ ...settings, style: s }, `Stil „${STYLE_LABELS[s]}“.`)}
                hint="Andere sehen deine Vitrine in ihrem eigenen Stil."
              />
            </>
          )}
        </div>
      </section>

      {data.enabled && (
        <div className="erfolg-raum">
          <section className="erfolg-spieler" aria-labelledby="erfolge-spieler">
            <div>
              <h2 id="erfolge-spieler">Gesamtstufe {data.total}</h2>
              <p>Summe der Stufen all deiner Erfolge, höchstens 180.</p>
              <div
                className="erfolg-balken"
                role="progressbar"
                aria-label={`Gesamtstufe ${data.total} von 180`}
                aria-valuemin={0}
                aria-valuemax={180}
                aria-valuenow={data.total}
              >
                <span style={{ width: `${Math.round((data.total / 180) * 100)}%` }} />
              </div>
            </div>
            <div className="erfolg-vitrine">
              <h3>Vitrine · {data.showcase.length} von 3</h3>
              <ul className="plain">
                {[0, 1, 2].map((slot) => {
                  const id = data.showcase[slot];
                  const level =
                    id === "allrounder"
                      ? data.allrounder
                      : (data.categories.find((c) => c.id === id)?.level ?? 0);
                  return (
                    <li key={slot} className={id ? "erfolg-platz" : "erfolg-platz erfolg-frei"}>
                      {id ? (
                        <>
                          <BadgeView style={style} level={level} size={56} glyph={GLYPHS[id]} />
                          <span>
                            {id === "allrounder"
                              ? "Allrounder"
                              : data.categories.find((c) => c.id === id)?.name}
                          </span>
                        </>
                      ) : (
                        <span>Frei</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>

          <section aria-labelledby="erfolge-liste">
            <h2 id="erfolge-liste" className="erfolg-titel">
              Erfolge
            </h2>
            <ul className="plain erfolg-karten">
              {data.categories.map((category) => (
                <AchievementCard
                  key={category.id}
                  id={category.id}
                  category={category}
                  style={style}
                  pinned={data.showcase.includes(category.id)}
                  full={data.showcase.length >= 3}
                  onPin={() => pin(category.id)}
                />
              ))}
              <AchievementCard
                id="allrounder"
                category={allrounder}
                style={style}
                pinned={data.showcase.includes("allrounder")}
                full={data.showcase.length >= 3}
                onPin={() => pin("allrounder")}
              />
            </ul>
          </section>

          <section aria-labelledby="erfolge-kranz">
            <h2 id="erfolge-kranz" className="erfolg-titel">
              Meisterkranz <InfoTip term="tickets.meisterkranz" />
            </h2>
            <ul className="plain erfolg-kranz">
              {data.wreaths.map((done, rank) => {
                const ok = done >= 6;
                return (
                  <li key={rank} className={ok ? "erfolg-kranz-frei" : undefined}>
                    <BadgeView style={style} level={ok ? 5 * rank + 1 : 0} size={60} glyph="❂" />
                    <strong>{RANK_NAMES[style][rank]}</strong>
                    <span className="small">
                      {ok ? "Freigeschaltet" : `${done} von 6 Kategorien`}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}

function AchievementCard({
  id,
  category,
  style,
  pinned,
  full,
  onPin,
}: {
  id: ShowcaseId;
  category: CategoryState;
  style: BadgeStyle;
  pinned: boolean;
  full: boolean;
  onPin: () => void;
}) {
  const [ladder, setLadder] = useState(false);
  const reached = category.level > 0;
  const isAllrounder = id === "allrounder";
  const span = (category.next_at ?? category.current_at) - category.current_at;
  const percent =
    category.next_at === null
      ? 100
      : Math.round(((category.count - category.current_at) / Math.max(1, span)) * 100);
  return (
    <li className={pinned ? "erfolg-karte erfolg-karte-vitrine" : "erfolg-karte"}>
      <BadgeView style={style} level={category.level} size={72} glyph={GLYPHS[id]} />
      <div className="erfolg-karte-text">
        <div className="erfolg-karte-kopf">
          <h3>{category.name}</h3>
          <span>
            {reached
              ? `${levelName(style, category.level)} · ${category.level}/30`
              : "Noch nicht erreicht"}
          </span>
        </div>
        <p className="small">{WHAT_COUNTS[id]}</p>
        {!isAllrounder && (
          <>
            <div
              className="erfolg-balken"
              role="progressbar"
              aria-label={`${category.name}: ${percent} Prozent bis zur nächsten Stufe`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
            >
              <span style={{ width: `${percent}%` }} />
            </div>
            <p className="small">
              {category.next_at === null
                ? `${fmt(category.count)} · höchste Stufe erreicht`
                : `${fmt(category.count)} · noch ${fmt(category.next_at - category.count)} bis ${levelName(style, category.level + 1)}`}
            </p>
          </>
        )}
        <div className="erfolg-karte-aktionen">
          {reached && (
            <button
              type="button"
              className="row-button"
              aria-pressed={pinned}
              disabled={!pinned && full}
              onClick={onPin}
            >
              {pinned ? "Aus der Vitrine nehmen" : full ? "Vitrine voll" : "In die Vitrine"}
            </button>
          )}
          <button
            type="button"
            className="row-button"
            aria-expanded={ladder}
            onClick={() => setLadder(!ladder)}
          >
            {ladder ? "Stufen ausblenden" : "Alle 30 Stufen"}
          </button>
        </div>
        {ladder && (
          <ol className="plain erfolg-leiter" aria-label={`Stufen von ${category.name}`}>
            {Array.from({ length: 30 }, (_, k) => k + 1).map((level) => (
              <li key={level} className={level <= category.level ? "erfolg-erreicht" : undefined}>
                <BadgeView style={style} level={level} size={44} glyph={GLYPHS[id]} />
                <span className="small">{levelName(style, level)}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </li>
  );
}
