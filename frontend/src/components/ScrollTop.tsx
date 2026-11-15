import { useEffect, useState } from "react";

/** Ab so vielen Pixeln nach unten erscheint der Knopf. */
const THRESHOLD = 400;

/** Knopf unten rechts, der zum Seitenanfang führt. Erscheint erst nach etwas Scrollen. */
export function ScrollTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const update = () => setVisible(window.scrollY > THRESHOLD);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  if (!visible) {
    return null;
  }

  const onClick = () => {
    const calm =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: calm ? "auto" : "smooth" });
    // Der Fokus geht mit nach oben, damit die Tastatur dort weitermacht.
    document.getElementById("inhalt")?.focus({ preventScroll: true });
  };

  return (
    <button type="button" className="scroll-top" onClick={onClick}>
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M12 19V5" />
        <path d="M6 11l6-6 6 6" />
      </svg>
      <span className="visually-hidden">Nach oben</span>
    </button>
  );
}
