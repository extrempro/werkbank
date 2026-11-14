import type { Me } from "../api";

interface StartPageProps {
  me: Me;
}

export function StartPage({ me }: StartPageProps) {
  return (
    <>
      <h1>Guten Tag, {me.display_name}</h1>
      <section className="card" aria-labelledby="aufgaben-titel">
        <h2 id="aufgaben-titel">Meine Aufgaben</h2>
        <p className="empty">Keine offenen Aufgaben.</p>
      </section>
    </>
  );
}
