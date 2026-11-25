import { useId } from "react";
import { DEFAULT_TONE, playTone, type SoundSettings as Sounds } from "../sounds";

/** Töne dieses Browsers: an/aus, Lautstärke, Ruhezeit, nur im Hintergrund. */
export function SoundSettings({
  sounds,
  onChange,
}: {
  sounds: Sounds;
  onChange: (next: Sounds) => void;
}) {
  const volumeId = useId();
  const off = !sounds.enabled;
  return (
    <section className="panel" aria-labelledby="benachrichtigungen-toene">
      <div className="panel-head">
        <h2 id="benachrichtigungen-toene">Töne</h2>
        <span className="small">gilt für diesen Browser</span>
      </div>
      <div className="detail-body settings-form">
        <p>
          Kommt eine neue Benachrichtigung in die Glocke, erklingt der Ton ihres Bereichs. Kommen
          mehrere auf einmal, erklingt nur ein Ton. Das geht nur, solange die Werkbank in einem Tab
          offen ist. Push am Handy spielt den Ton des Geräts.
        </p>
        <label className="check-label">
          <input
            type="checkbox"
            className="check"
            checked={sounds.enabled}
            onChange={(event) => {
              onChange({ ...sounds, enabled: event.target.checked });
              // Der Klick erlaubt dem Browser, später Töne abzuspielen.
              if (event.target.checked) {
                playTone(DEFAULT_TONE, sounds.volume);
              }
            }}
          />
          <span>Töne abspielen</span>
        </label>
        <div className="sound-volume">
          <label htmlFor={volumeId}>Lautstärke: {sounds.volume} %</label>
          <input
            id={volumeId}
            type="range"
            min={0}
            max={100}
            step={5}
            value={sounds.volume}
            disabled={off}
            onChange={(event) => onChange({ ...sounds, volume: Number(event.target.value) })}
            onPointerUp={() => playTone(DEFAULT_TONE, sounds.volume)}
            onKeyUp={() => playTone(DEFAULT_TONE, sounds.volume)}
          />
        </div>
        <label className="check-label">
          <input
            type="checkbox"
            className="check"
            checked={sounds.quiet}
            disabled={off}
            onChange={(event) => onChange({ ...sounds, quiet: event.target.checked })}
          />
          <span>Ruhezeit: von 18 bis 7 Uhr still</span>
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            className="check"
            checked={sounds.onlyHidden}
            disabled={off}
            onChange={(event) => onChange({ ...sounds, onlyHidden: event.target.checked })}
          />
          <span>Nur, wenn die Werkbank im Hintergrund ist</span>
        </label>
      </div>
    </section>
  );
}
