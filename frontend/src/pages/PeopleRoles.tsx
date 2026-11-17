import { useEffect, useState } from "react";
import { Avatar } from "../components/Avatar";
import { errorText, fetchPeople, filterPeople, formatDateTime, type PersonRoles } from "../api";

/** Verwaltung › Rollen je Person: wer Zugriff hat und mit welchen Rollen (letzte Anmeldung). */
export function PeopleRoles() {
  const [people, setPeople] = useState<PersonRoles[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [withoutRole, setWithoutRole] = useState(false);

  useEffect(() => {
    let active = true;
    fetchPeople().then(
      (result) => active && setPeople(result),
      (error: unknown) =>
        active && setFailed(errorText(error, "Die Personen konnten nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, []);

  if (failed) {
    return <p role="alert">{failed}</p>;
  }
  if (!people) {
    return <p role="status">Wird geladen …</p>;
  }
  const shown = filterPeople(people, query, withoutRole);
  return (
    <>
      <div className="settings-form people-filter">
        <label className="narrow">
          Person oder Rolle suchen
          <input
            type="search"
            value={query}
            maxLength={100}
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={withoutRole}
            onChange={(event) => setWithoutRole(event.target.checked)}
          />
          Nur Personen ohne Rolle
        </label>
      </div>
      <p className="small" role="status">
        {shown.length === people.length
          ? `${people.length} ${people.length === 1 ? "Person" : "Personen"}`
          : `${shown.length} von ${people.length} Personen`}
      </p>
      {shown.length > 0 && (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Personen und Rollen">
          <table>
            <caption className="visually-hidden">Personen mit ihren Rollen</caption>
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Rollen (letzte Anmeldung)</th>
                <th scope="col">Letzte Anmeldung</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((person, index) => (
                <tr key={`${person.display_name}-${person.email ?? ""}-${index}`}>
                  <th scope="row">
                    <Avatar name={person.display_name} url={person.avatar_url} />{" "}
                    {person.display_name}
                    {person.email && <span className="small tenant-part">{person.email}</span>}
                  </th>
                  <td>
                    {person.roles.length === 0 ? (
                      <span className="empty">keine Rolle</span>
                    ) : (
                      <ul className="plain people-roles">
                        {person.roles.map((role) => (
                          <li key={role.value}>
                            <span className="pill pill-neutral" title={role.value}>
                              {role.label}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td>{formatDateTime(person.last_login_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
