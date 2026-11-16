import { useState, type FormEvent } from "react";
import { NetNotice } from "../NetNotice";
import { CopyButton, ErrorBox, InfoTable, Output, ToolSection, type InfoRow } from "../ui";
import {
  contacts,
  dateText,
  detectQuery,
  eventLabels,
  ipRangeText,
  rdapLookup,
  roleLabels,
  statusLabels,
  type QueryKind,
  type RdapObject,
} from "./rdap";

interface Found {
  url: string;
  data: RdapObject;
  kind: QueryKind;
}

const DAY = 86_400_000;

export default function RdapTool() {
  // Die Abfrage steht nicht in der Adresszeile.
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<Found | null>(null);
  const query = detectQuery(input);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!query) {
      setError(`„${input.trim()}“ ist weder Domain noch IP-Adresse noch AS-Nummer.`);
      setFound(null);
      return;
    }
    setBusy(true);
    setError(null);
    setFound(null);
    rdapLookup(query).then(
      (result) => {
        setFound({ ...result, kind: query.kind });
        setBusy(false);
      },
      (caught: unknown) => {
        setError((caught as Error).message);
        setBusy(false);
      },
    );
  };

  return (
    <div className="tool-body settings-form">
      <form className="tool-row" onSubmit={onSubmit}>
        <label>
          Domain, IP-Adresse oder Netz, AS-Nummer
          <input
            type="text"
            value={input}
            spellCheck={false}
            placeholder="example.com · 192.0.2.1 · 2001:db8::/32 · AS64500"
            onChange={(event) => setInput(event.target.value)}
          />
        </label>
        <button type="submit" className="button button-primary" disabled={busy || !input.trim()}>
          {busy ? "Frage …" : "Abfragen"}
        </button>
      </form>
      {busy && (
        <p className="small" role="status">
          Frage den zuständigen RDAP-Server …
        </p>
      )}
      {error && <ErrorBox>{error}</ErrorBox>}
      {found && <Result {...found} />}
      <NetNotice>
        Die Werkbank sucht im Verzeichnis der IANA die zuständige Registry und fragt sie. Daten von
        Domaininhabern sind wegen der DSGVO meist geschwärzt; manche Registrys geben nur Status und
        Nameserver heraus.
      </NetNotice>
    </div>
  );
}

function Result({ data, url, kind }: Found) {
  const rows: InfoRow[] = [];
  if (kind === "domain") {
    rows.push({
      label: "Domain",
      value:
        data.unicodeName && data.unicodeName !== data.ldhName
          ? `${data.unicodeName} (${data.ldhName})`
          : (data.ldhName ?? "–"),
      copy: data.ldhName,
    });
  } else if (kind === "ip") {
    const range = ipRangeText(data);
    rows.push({ label: "Bereich", value: range ?? "–", copy: range });
    if (data.name) {
      rows.push({ label: "Netzname", value: data.name, copy: data.name });
    }
    if (data.type) {
      rows.push({ label: "Art", value: data.type, plain: true });
    }
    if (data.parentHandle) {
      rows.push({ label: "Übergeordnet", value: data.parentHandle });
    }
  } else {
    rows.push({
      label: "AS",
      value:
        data.startAutnum === data.endAutnum || !data.endAutnum
          ? `AS${data.startAutnum}`
          : `AS${data.startAutnum} bis AS${data.endAutnum}`,
    });
    if (data.name) {
      rows.push({ label: "Name", value: data.name, copy: data.name });
    }
  }
  if (data.handle) {
    rows.push({ label: "Handle", value: data.handle, copy: data.handle });
  }
  if (data.country) {
    rows.push({ label: "Land", value: data.country });
  }
  for (const event of data.events ?? []) {
    rows.push({
      label: eventLabels[event.eventAction] ?? event.eventAction,
      value: dateText(event.eventDate),
      plain: true,
    });
  }
  if (data.secureDNS) {
    rows.push({
      label: "DNSSEC",
      value: data.secureDNS.delegationSigned ? (
        <span className="pill pill-ok">signiert</span>
      ) : (
        <span className="pill pill-neutral">nicht signiert</span>
      ),
    });
  }

  const people = contacts(data).filter(
    (entry) => entry.name || entry.org || entry.email || entry.phone || entry.handle,
  );
  const expiry = data.events?.find((event) => event.eventAction === "expiration");
  const daysLeft = expiry
    ? Math.floor((new Date(expiry.eventDate).getTime() - new Date().getTime()) / DAY)
    : null;

  return (
    <>
      {daysLeft !== null && daysLeft < 30 && (
        <p className="hint-box hint-warn">Läuft in {daysLeft} Tagen ab.</p>
      )}
      <InfoTable rows={rows} caption="Ergebnis der RDAP-Abfrage" />
      {data.status && data.status.length > 0 && (
        <ToolSection title="Status">
          <p className="tool-row">
            {data.status.map((entry) => (
              <span
                key={entry}
                className={
                  /hold|pending delete|redemption/.test(entry) ? "pill pill-bad" : "pill pill-neutral"
                }
              >
                {statusLabels[entry] ?? entry}
              </span>
            ))}
          </p>
        </ToolSection>
      )}
      {data.nameservers && data.nameservers.length > 0 && (
        <ToolSection title="Nameserver">
          <ul className="tool-list mono">
            {data.nameservers.map((server) => (
              <li key={server.ldhName ?? server.unicodeName}>
                {(server.ldhName ?? server.unicodeName ?? "").toLowerCase()}
                {server.ipAddresses && (
                  <span className="small">
                    {" "}
                    {[...(server.ipAddresses.v4 ?? []), ...(server.ipAddresses.v6 ?? [])].join(
                      ", ",
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </ToolSection>
      )}
      {people.length > 0 && (
        <ToolSection title="Kontakte">
          <ul className="tool-cards">
            {people.map((person, index) => (
              <li key={index} className="tool-card">
                <p className="tool-row">
                  {person.roles.map((role) => (
                    <span
                      key={role}
                      className={role === "abuse" ? "pill pill-todo" : "pill pill-neutral"}
                    >
                      {roleLabels[role] ?? role}
                    </span>
                  ))}
                  {person.redacted && <span className="pill pill-neutral">geschwärzt</span>}
                </p>
                {(person.org || person.name) && <strong>{person.org ?? person.name}</strong>}
                {person.org && person.name && person.name !== person.org && <p>{person.name}</p>}
                {person.ianaId && <p className="small">IANA-ID {person.ianaId}</p>}
                {person.handle && <p className="small">{person.handle}</p>}
                {person.address && <p>{person.address}</p>}
                {person.email && (
                  <p className="tool-row">
                    <span className="tool-break">{person.email}</span>
                    <CopyButton value={person.email} label="E-Mail kopieren" />
                  </p>
                )}
                {person.phone && <p>{person.phone}</p>}
              </li>
            ))}
          </ul>
        </ToolSection>
      )}
      <details className="budget-more">
        <summary>Rohdaten (JSON)</summary>
        <div className="budget-more-body">
          <p className="small tool-break">{url}</p>
          <Output value={JSON.stringify(data, null, 2)} label="JSON" />
        </div>
      </details>
    </>
  );
}
