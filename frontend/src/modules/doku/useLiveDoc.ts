import { useEffect, useState } from "react";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";

/** Farben der Cursor anderer Personen (gut lesbar auf hellem und dunklem Grund). */
export const CARET_COLORS = [
  "#1f57c3",
  "#b54708",
  "#067647",
  "#9e1f63",
  "#5b3cc4",
  "#0e7090",
  "#a15c07",
  "#c01048",
] as const;

/** Gründe, mit denen der Server trennt (backend: modules/doku/collab.py). */
const CLOSE_RELOAD = 4001;
const CLOSE_FORBIDDEN = 4403;

export type LiveStatus = "verbinden" | "live" | "getrennt" | "kein-zugriff";

export interface Presence {
  id: number;
  name: string;
  color: string;
}

export interface LiveDoc {
  doc: Y.Doc;
  provider: WebsocketProvider;
  color: string;
  /** Verbindung zu dieser Seite und diesem Neuaufbau */
  pageId: string;
  session: number;
}

function liveUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/doku/live`;
}

/**
 * Verbindung zum gemeinsamen Dokument einer Seite. `onReload` meldet, dass der Server die
 * Seite neu aufgebaut hat (Sperre, Rechte, Wiederherstellen): dann neu laden.
 */
export function useLiveDoc(
  pageId: string,
  session: number,
  onReload: () => void,
): { live: LiveDoc | null; status: LiveStatus; synced: boolean; presence: Presence[] } {
  const [live, setLive] = useState<LiveDoc | null>(null);
  const [status, setStatus] = useState<LiveStatus>("verbinden");
  const [synced, setSynced] = useState(false);
  const [presence, setPresence] = useState<Presence[]>([]);

  useEffect(() => {
    const doc = new Y.Doc();
    // Kein Abgleich über andere Tabs (BroadcastChannel): Rechte prüft nur der Server
    const provider = new WebsocketProvider(liveUrl(), pageId, doc, { disableBc: true });
    const color = CARET_COLORS[Math.floor(Math.random() * CARET_COLORS.length)] ?? "#1f57c3";
    let active = true;
    // Zustand erst nach dem Effekt setzen (nicht synchron im Effekt)
    queueMicrotask(() => {
      if (active) {
        setLive({ doc, provider, color, pageId, session });
        setStatus("verbinden");
        setSynced(false);
        setPresence([]);
      }
    });

    const onStatus = (event: { status: "connected" | "disconnected" | "connecting" }) =>
      setStatus((current) =>
        current === "kein-zugriff"
          ? current
          : event.status === "connected"
            ? "live"
            : event.status === "connecting"
              ? "verbinden"
              : "getrennt",
      );
    const onSync = (state: boolean) => setSynced(state);
    const onClose = (event: CloseEvent | null) => {
      if (event?.code === CLOSE_RELOAD) {
        provider.disconnect();
        onReload();
      } else if (event?.code === CLOSE_FORBIDDEN) {
        provider.disconnect();
        setStatus("kein-zugriff");
      }
    };
    const onAwareness = () => {
      const seen = new Map<string, Presence>();
      provider.awareness.getStates().forEach((state, id) => {
        if (id === doc.clientID) {
          return;
        }
        const user = (state as { user?: { name?: unknown; color?: unknown } }).user;
        const name = typeof user?.name === "string" ? user.name : "";
        if (name && !seen.has(name)) {
          seen.set(name, {
            id,
            name,
            color: typeof user?.color === "string" ? user.color : "",
          });
        }
      });
      setPresence([...seen.values()]);
    };
    provider.on("status", onStatus);
    provider.on("sync", onSync);
    provider.on("connection-close", onClose);
    provider.awareness.on("change", onAwareness);
    return () => {
      active = false;
      provider.awareness.off("change", onAwareness);
      provider.off("status", onStatus);
      provider.off("sync", onSync);
      provider.off("connection-close", onClose);
      provider.destroy();
      doc.destroy();
    };
    // onReload ist stabil (useCallback beim Aufrufer)
  }, [pageId, session, onReload]);

  // Bis die neue Verbindung steht, gibt es kein gültiges Dokument (die alte ist schon zu)
  const current = live && live.pageId === pageId && live.session === session ? live : null;
  return {
    live: current,
    status: current ? status : "verbinden",
    synced: current ? synced : false,
    presence: current ? presence : [],
  };
}
