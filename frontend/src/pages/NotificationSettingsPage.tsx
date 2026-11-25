import { useEffect, useState } from "react";
import { Link } from "../components/Link";
import { NotificationPreferences } from "../components/NotificationPreferences";
import { SoundSettings } from "../components/SoundSettings";
import { ACCOUNT_PATH } from "../components/nav/AccountMenu";
import { NOTIFICATIONS_PATH } from "../notifications";
import { saveSounds, SOUND_KEY, storedSounds, type SoundSettings as Sounds } from "../sounds";

/** Konto › Benachrichtigungen: Arten und Wege (mit Push-Geräten und Ton je Bereich) und Töne. */
export function NotificationSettingsPage() {
  const [sounds, setSounds] = useState<Sounds>(storedSounds);

  // Änderungen aus einem anderen Tab übernehmen
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === SOUND_KEY) {
        setSounds(storedSounds());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const change = (next: Sounds) => {
    setSounds(next);
    saveSounds(next);
  };

  return (
    <div className="page">
      <header className="page-head">
        <p className="small">
          <Link to={ACCOUNT_PATH}>Konto</Link> › Benachrichtigungen
        </p>
        <h1>Benachrichtigungen</h1>
        <p className="page-sub">
          Was du in der Glocke, per Mail, in Teams und als Push bekommst, und welcher Ton dazu
          erklingt. <Link to={NOTIFICATIONS_PATH}>Alle Benachrichtigungen ansehen</Link>
        </p>
      </header>

      <NotificationPreferences
        sounds={sounds}
        onTone={(module, tone) => change({ ...sounds, tones: { ...sounds.tones, [module]: tone } })}
      />
      <SoundSettings sounds={sounds} onChange={change} />
    </div>
  );
}
