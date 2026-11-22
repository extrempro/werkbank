import { useEffect, useState } from "react";
import { TICKETS_MEMBER, TICKETS_SETTINGS } from "../../navigation";
import { fetchTicketAccess, type TicketAccess } from "./api";

/** Ereignis nach Änderungen an den Rollen der Bereiche: Navigation lädt die Rechte neu. */
export const TICKET_ACCESS_CHANGED = "werkbank:ticket-rechte";

/**
 * Rechte im Modul Tickets für die Navigation. Ohne Antwort (Fehler, kein Modul) keine Einträge;
 * maßgeblich bleibt die Prüfung des Servers bei jeder Anfrage.
 */
export function useTicketAccess(): TicketAccess | null | undefined {
  // undefined: wird noch geladen; null: nicht verfügbar
  const [access, setAccess] = useState<TicketAccess | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    const load = () => {
      fetchTicketAccess()
        .then((result) => {
          if (active) {
            // Unerwartete Antwort: wie „keine Rechte“
            setAccess(Array.isArray(result?.areas) ? result : null);
          }
        })
        .catch(() => {
          if (active) {
            setAccess(null);
          }
        });
    };
    load();
    window.addEventListener(TICKET_ACCESS_CHANGED, load);
    return () => {
      active = false;
      window.removeEventListener(TICKET_ACCESS_CHANGED, load);
    };
  }, []);
  return access;
}

/** Kennzeichen für die Navigation (siehe navigation.ts). */
export function ticketNavRoles(access: TicketAccess | null | undefined): string[] {
  if (!access) {
    return [];
  }
  const roles: string[] = [];
  if (access.areas.length > 0) {
    roles.push(TICKETS_MEMBER);
  }
  if (access.settings) {
    roles.push(TICKETS_SETTINGS);
  }
  return roles;
}
