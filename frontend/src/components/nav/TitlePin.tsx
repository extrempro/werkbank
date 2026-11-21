import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../Icon";
import { Link } from "../Link";
import { PinButton } from "./PinButton";

interface TitlePinProps {
  /** Inhalt der Seite, in dem die Überschrift (h1) gesucht wird. */
  containerId: string;
  /** Die aktuelle Seite; ein neuer Pfad setzt den Platz neu. */
  path: string;
  /** Stern zum Anheften (nur für Seiten aus dem Menü). */
  pin: { path: string; label: string } | null;
  /** „Hilfe“: Thema im Handbuch zu dieser Seite. */
  help: string | null;
}

/**
 * Stern und „Hilfe“ am Seitentitel: stehen hinter der ersten Überschrift (h1) im Inhalt. Die
 * Seiten selbst müssen dafür nichts wissen; lädt eine Seite ihre Überschrift später, folgen sie.
 */
export function TitlePin({ containerId, path, pin, help }: TitlePinProps) {
  const [host, setHost] = useState<{ path: string; slot: HTMLElement } | null>(null);

  useEffect(() => {
    const container = document.getElementById(containerId);
    if (!container) {
      return;
    }
    let slot: HTMLSpanElement | null = null;
    let heading: HTMLHeadingElement | null = null;
    const detach = () => {
      slot?.remove();
      heading?.classList.remove("has-pin");
      slot = null;
      heading = null;
    };
    // Der Stern steht gleich hinter der Überschrift, nicht in ihr: So bleibt ihr Name unverändert.
    const attach = () => {
      const found = container.querySelector("h1");
      if (found && found === heading && slot && found.nextElementSibling === slot) {
        return;
      }
      detach();
      if (!found) {
        return;
      }
      heading = found;
      slot = document.createElement("span");
      slot.className = "title-pin";
      heading.classList.add("has-pin");
      heading.after(slot);
      setHost({ path, slot });
    };
    const frame = window.requestAnimationFrame(attach);
    const observer = new MutationObserver(attach);
    observer.observe(container, { childList: true, subtree: true });
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      detach();
    };
  }, [containerId, path]);

  // Nur der Platz zur aktuellen Seite zählt; ein alter ist schon entfernt.
  return host?.path === path
    ? createPortal(
        <>
          {pin && <PinButton path={pin.path} label={pin.label} />}
          {help && (
            <Link to={help} className="title-help">
              <Icon name="hilfe" />
              <span>Hilfe</span>
              <span className="visually-hidden"> zu dieser Seite im Handbuch</span>
            </Link>
          )}
        </>,
        host.slot,
      )
    : null;
}
