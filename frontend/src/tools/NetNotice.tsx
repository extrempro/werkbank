import { useEffect, useState, type ReactNode } from "react";
import { fetchNetStatus } from "./lib/net";

/**
 * Hinweis für Tools, die über die Werkbank ins Internet fragen: Was hinausgeht, und ob die
 * Verwaltung die Abfragen ausgeschaltet hat.
 */
export function NetNotice({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    fetchNetStatus().then(
      (status) => {
        if (active) {
          setEnabled(status.enabled);
        }
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, []);
  return (
    <>
      {enabled === false && (
        <p className="hint-box hint-warn">
          Abfragen ins Internet sind für die IT-Tools in der Verwaltung ausgeschaltet. Dieses Tool
          kann deshalb nichts abfragen.
        </p>
      )}
      <p className="small">{children}</p>
    </>
  );
}
