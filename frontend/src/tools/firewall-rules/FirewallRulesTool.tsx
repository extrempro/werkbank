import { FixedChoice } from "../../components/ListChoice";
import { useMemo, useState } from "react";
import { ErrorBox, ToolSection } from "../ui";
import {
  findShadowed,
  matchPacket,
  parseRules,
  portsText,
  type Action,
  type Packet,
} from "./rules";

const EXAMPLE = `# Aktion  Protokoll  Quelle           Ziel          Port
erlauben  tcp   any              10.0.20.10    80,443    # Webserver in der DMZ
erlauben  udp   192.168.1.0/24   10.0.10.53    53        # DNS
verbieten ip    192.168.1.0/24   10.0.10.0/24            # Clients nicht ins Servernetz
erlauben  tcp   192.168.1.50     10.0.10.20    3389      # Admin-PC per RDP
erlauben  tcp   192.168.1.0/24   any           80,443    # Surfen
erlauben  icmp  192.168.1.0/24   any`;

function ActionPill({ action }: { action: Action }) {
  return (
    <span className={action === "allow" ? "pill pill-ok" : "pill pill-bad"}>
      {action === "allow" ? "erlauben" : "verbieten"}
    </span>
  );
}

export default function FirewallRulesTool() {
  // Das Regelwerk verrät den Aufbau eines Netzes; es bleibt auf dieser Seite.
  const [text, setText] = useState(EXAMPLE);
  const [policy, setPolicy] = useState<Action>("deny");
  const [proto, setProto] = useState<Packet["proto"]>("tcp");
  const [src, setSrc] = useState("192.168.1.50");
  const [dst, setDst] = useState("10.0.10.20");
  const [port, setPort] = useState("3389");

  const { rules, errors } = useMemo(() => parseRules(text), [text]);
  const shadows = useMemo(() => findShadowed(rules), [rules]);
  let hit: number | null = null;
  let packetError: string | null = null;
  try {
    if (rules.length || !errors.length) {
      hit = matchPacket(rules, {
        proto,
        src,
        dst,
        port: port.trim() === "" ? undefined : Number(port),
      });
    }
  } catch (caught) {
    packetError = (caught as Error).message;
  }
  const matched = hit !== null && hit >= 0 ? rules[hit] : undefined;
  const verdict: Action | null = hit === null ? null : matched ? matched.action : policy;

  return (
    <div className="tool-body settings-form">
      <label>
        Regeln (je Zeile eine: Aktion Protokoll Quelle Ziel Port)
        <textarea
          rows={9}
          value={text}
          spellCheck={false}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <p className="small">
        Aktion: erlauben/verbieten oder allow/deny (auch permit, accept, drop, reject). Protokoll:
        tcp, udp, icmp, ip/any. Quelle und Ziel: Adresse, Netz (192.168.1.0/24) oder any. Port: 443,
        80,443 oder 1024-65535; leer heißt alle. Alles nach # ist Kommentar. Das Regelwerk bleibt
        auf dieser Seite und wird nirgends gespeichert.
      </p>
      <FixedChoice
        label="Wenn keine Regel passt"
        value={policy}
        options={[
          { value: "deny", label: "alles verbieten (üblich)" },
          { value: "allow", label: "alles erlauben" },
        ]}
        onChange={(value) => setPolicy(value === "allow" ? "allow" : "deny")}
      />

      {errors.length > 0 && (
        <ErrorBox>
          {errors.map((entry) => (
            <span key={entry.line} className="tool-line">
              Zeile {entry.line}: {entry.message}
            </span>
          ))}
        </ErrorBox>
      )}

      <ToolSection title="Testpaket">
        <div className="form-grid">
          <FixedChoice
            label="Protokoll"
            value={proto}
            options={[
              { value: "tcp", label: "TCP" },
              { value: "udp", label: "UDP" },
              { value: "icmp", label: "ICMP (Ping)" },
            ]}
            onChange={(value) => setProto(value as Packet["proto"])}
          />
          <label>
            Quelle
            <input
              type="text"
              value={src}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setSrc(event.target.value)}
            />
          </label>
          <label>
            Ziel
            <input
              type="text"
              value={dst}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setDst(event.target.value)}
            />
          </label>
          {proto !== "icmp" && (
            <label>
              Zielport
              <input
                type="text"
                inputMode="numeric"
                value={port}
                autoComplete="off"
                onChange={(event) => setPort(event.target.value)}
              />
            </label>
          )}
        </div>
        {packetError && <ErrorBox>{packetError}</ErrorBox>}
        {verdict && hit !== null && (
          <div
            className={verdict === "allow" ? "hint-box tool-verdict-ok" : "hint-box hint-bad"}
            role="status"
          >
            <p className="hint-title">
              {verdict === "allow" ? "Das Paket wird durchgelassen" : "Das Paket wird verworfen"}
            </p>
            {matched ? (
              <p>
                Regel {hit + 1} passt als erste:{" "}
                <span className="mono">{matched.raw.replace(/\s+/g, " ")}</span>
                {matched.comment && ` (${matched.comment})`}
              </p>
            ) : (
              <p>Keine Regel passt, es gilt die Standardrichtlinie.</p>
            )}
          </div>
        )}
      </ToolSection>

      {rules.length > 0 && (
        <ToolSection title="Regelwerk, von oben nach unten geprüft">
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Regelwerk">
            <table>
              <caption className="visually-hidden">Regelwerk</caption>
              <thead>
                <tr>
                  {["Nr.", "Aktion", "Protokoll", "Quelle", "Ziel", "Port", "Hinweis"].map(
                    (head) => (
                      <th key={head} scope="col">
                        {head}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {rules.map((rule, index) => {
                  const shadow = shadows.find((entry) => entry.rule === index);
                  return (
                    <tr key={rule.line} className={index === hit ? "tool-hit" : undefined}>
                      <td>{index + 1}</td>
                      <td>
                        <ActionPill action={rule.action} />
                      </td>
                      <td className="mono">{rule.proto === "any" ? "alle" : rule.proto}</td>
                      <td className="mono">{rule.src.text}</td>
                      <td className="mono">{rule.dst.text}</td>
                      <td className="mono">{rule.proto === "icmp" ? "–" : portsText(rule)}</td>
                      <td>
                        {index === hit && <span className="pill pill-info">Treffer</span>}{" "}
                        {shadow && (
                          <span className="pill pill-todo">
                            {shadow.sameAction ? "überflüssig" : "greift nie"}: Regel{" "}
                            {shadow.by + 1} deckt alles ab
                          </span>
                        )}
                        {!shadow && rule.comment}
                      </td>
                    </tr>
                  );
                })}
                <tr className={hit === -1 ? "tool-hit" : undefined}>
                  <td>∗</td>
                  <td>
                    <ActionPill action={policy} />
                  </td>
                  <td colSpan={4}>alles andere (Standardrichtlinie)</td>
                  <td>{hit === -1 && <span className="pill pill-info">Treffer</span>}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {shadows.length > 0 && (
            <p className="small">
              {shadows.length === 1 ? "Eine Regel wird" : `${shadows.length} Regeln werden`} nie
              erreicht: Die Reihenfolge entscheidet. Spezielle Regeln gehören vor allgemeine, sonst
              gewinnt die allgemeine.
            </p>
          )}
          <p className="small">
            Vereinfachtes Modell eines Paketfilters: Geprüft wird nur das erste Paket einer
            Verbindung, ohne Zonen, NAT und Quellports.
          </p>
        </ToolSection>
      )}
    </div>
  );
}
