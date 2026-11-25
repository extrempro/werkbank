import { FixedChoice } from "../../components/ListChoice";
import { useMemo, useState, type ReactNode } from "react";
import { clampInt, useToolParams } from "../params";
import { CopyButton, ErrorBox, InfoTable, ToolSection, type InfoRow } from "../ui";
import {
  bitsOf,
  formatIp,
  formatIpv6Full,
  parseIp,
  prefixMask,
  toBinary,
  type IpVersion,
} from "./ip";
import {
  calculateSubnet,
  cidrText,
  classify,
  contains,
  formatCount,
  formatCountShort,
  ipv4Class,
  neighbours,
  parseSubnetInput,
  plural,
  prefixForHosts,
  rangeToCidrs,
  reverseZones,
  sourceLabels,
  splitSubnet,
  type ParsedInput,
  type SubnetInfo,
} from "./subnet";

const EXAMPLES = [
  "192.168.10.0/24",
  "10.20.30.40 255.255.252.0",
  "172.16.0.0 0.0.15.255",
  "10.0.0.10 - 10.0.0.50",
  "2001:db8:abcd::/48",
];
const SPLIT_LIMIT = 256;

type Open = (version: IpVersion, network: bigint, prefix: number) => void;

function NetLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="tool-link mono" onClick={onClick}>
      {children}
    </button>
  );
}

/** Adresse bitweise: Netzanteil hervorgehoben, Hostanteil neutral (IPv6 in Hex-Ziffern). */
function BitView({ info }: { info: SubnetInfo }) {
  const groups: { text: string; kinds: string[]; caption?: string }[] = [];
  if (info.version === 4) {
    const bits = toBinary(4, info.address);
    for (let octet = 0; octet < 4; octet += 1) {
      const text = bits.slice(octet * 8, octet * 8 + 8);
      groups.push({
        text,
        kinds: text.split("").map((_, i) => (octet * 8 + i < info.prefix ? "net" : "host")),
        caption: String(Number((info.address >> BigInt(24 - octet * 8)) & 255n)),
      });
    }
  } else {
    formatIpv6Full(info.address)
      .split(":")
      .forEach((text, group) => {
        groups.push({
          text,
          kinds: text.split("").map((_, i) => {
            const start = (group * 4 + i) * 4;
            return start + 4 <= info.prefix ? "net" : start >= info.prefix ? "host" : "mixed";
          }),
        });
      });
  }
  const hostBits = info.bits - info.prefix;
  return (
    <div>
      <div className="bits" aria-hidden="true">
        {groups.map((group, index) => (
          <div key={index} className="bits-group">
            <div className="bits-row">
              {group.text.split("").map((char, i) => (
                <span key={i} className={`bit bit-${group.kinds[i]}`}>
                  {char}
                </span>
              ))}
            </div>
            {group.caption && <div className="bits-caption mono">{group.caption}</div>}
          </div>
        ))}
      </div>
      <p className="small">
        Hervorgehoben: Netzanteil ({info.prefix} Bit). Übrig: Hostanteil ({hostBits} Bit).
      </p>
    </div>
  );
}

export default function CidrTool() {
  const [params, setParams] = useToolParams({ netz: "", teilen: "", pruefen: "" });
  const cidr = params.netz;
  const [hosts, setHosts] = useState("");

  const parsed = useMemo((): { input: ParsedInput | null; error: string | null } => {
    if (!cidr.trim()) {
      return { input: null, error: null };
    }
    try {
      return { input: parseSubnetInput(cidr), error: null };
    } catch (caught) {
      return { input: null, error: (caught as Error).message };
    }
  }, [cidr]);

  const input = parsed.input;
  const version: IpVersion = input?.version ?? 4;
  const info =
    input?.kind === "network" ? calculateSubnet(input.version, input.address, input.prefix) : null;

  const open: Open = (v, network, prefix) => setParams({ netz: cidrText(v, network, prefix) });
  const setPrefix = (prefix: number) => {
    if (input?.kind === "network") {
      setParams({ netz: `${formatIp(input.version, input.address)}/${prefix}` });
    }
  };
  const onHosts = (value: string) => {
    setHosts(value);
    const prefix = prefixForHosts(Number(value));
    if (prefix !== null && input?.kind === "network" && input.version === 4) {
      setPrefix(prefix);
    }
  };
  const hostsPrefix = prefixForHosts(Number(hosts));

  return (
    <div className="tool-body settings-form">
      <div className="form-grid">
        <label>
          Netz, Adresse oder Bereich
          <input
            type="text"
            value={cidr}
            autoComplete="off"
            spellCheck={false}
            placeholder="192.168.10.0/24"
            onChange={(event) => setParams({ netz: event.target.value })}
          />
        </label>
        <FixedChoice
          label="Präfix oder Maske"
          value={input?.kind === "network" ? String(input.prefix) : ""}
          disabled={input?.kind !== "network"}
          options={Array.from({ length: bitsOf(version) + 1 }, (_, prefix) => ({
            value: String(prefix),
            label:
              version === 4 ? `/${prefix} – ${formatIp(4, prefixMask(4, prefix))}` : `/${prefix}`,
          }))}
          onChange={(value) => setPrefix(Number(value))}
        />
        <label>
          Benötigte Hosts {version === 6 && "(nur IPv4)"}
          <input
            type="number"
            min={1}
            value={hosts}
            disabled={version === 6}
            onChange={(event) => onHosts(event.target.value)}
          />
        </label>
      </div>

      {hosts && hostsPrefix !== null && version === 4 && (
        <p className="small">
          Für {formatCount(BigInt(Math.floor(Number(hosts))))} Hosts reicht ein{" "}
          <strong>/{hostsPrefix}</strong> ({formatIp(4, prefixMask(4, hostsPrefix))},{" "}
          {formatCount(2n ** BigInt(32 - hostsPrefix) - 2n)} nutzbare Hosts).
          {input?.kind !== "network" && " Gib oben eine Adresse ein, um das Netz zu berechnen."}
        </p>
      )}

      <div className="chips" role="group" aria-label="Beispiele">
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            className="chip mono"
            onClick={() => setParams({ netz: example })}
          >
            {example}
          </button>
        ))}
      </div>

      {parsed.error && <ErrorBox>{parsed.error}</ErrorBox>}
      {input?.kind === "range" && <RangeResult input={input} onOpen={open} />}
      {info && input?.kind === "network" && (
        <NetworkResult
          info={info}
          source={sourceLabels[input.source]}
          split={params.teilen}
          check={params.pruefen}
          onOpen={open}
          onSplit={(prefix) => setParams({ teilen: String(prefix) })}
          onCheck={(value) => setParams({ pruefen: value })}
        />
      )}
    </div>
  );
}

function RangeResult({
  input,
  onOpen,
}: {
  input: Extract<ParsedInput, { kind: "range" }>;
  onOpen: Open;
}) {
  const blocks = rangeToCidrs(input.version, input.start, input.end);
  const list = blocks.map((block) => cidrText(input.version, block.network, block.prefix));
  return (
    <ToolSection title="Bereich als CIDR-Blöcke">
      <p className="small">
        {formatIp(input.version, input.start)} – {formatIp(input.version, input.end)} ·{" "}
        {plural(input.end - input.start + 1n, "Adresse", "Adressen")} ·{" "}
        {blocks.length === 1 ? "genau ein Netz" : `${blocks.length} Blöcke nötig`}
      </p>
      <ul className="rows">
        {blocks.map((block, index) => (
          <li key={list[index]}>
            <span className="row-main">
              <NetLink onClick={() => onOpen(input.version, block.network, block.prefix)}>
                {list[index]}
              </NetLink>
            </span>
            <span className="small">
              {plural(1n << BigInt(bitsOf(input.version) - block.prefix), "Adresse", "Adressen")}
            </span>
          </li>
        ))}
      </ul>
      <CopyButton value={list.join("\n")} label="Alle Blöcke kopieren" />
    </ToolSection>
  );
}

function NetworkResult({
  info,
  source,
  split,
  check,
  onOpen,
  onSplit,
  onCheck,
}: {
  info: SubnetInfo;
  source: string;
  split: string;
  check: string;
  onOpen: Open;
  onSplit: (prefix: number) => void;
  onCheck: (value: string) => void;
}) {
  const v = info.version;
  const f = (value: bigint) => formatIp(v, value);
  const cidr = cidrText(v, info.network, info.prefix);
  const type = classify(v, info.network, info.prefix);
  const { previous, next } = neighbours(info);
  const zones = reverseZones(info);

  const roleText =
    info.role === "network"
      ? "ist die Netzadresse"
      : info.role === "broadcast"
        ? "ist die Broadcast-Adresse und nicht als Host nutzbar"
        : info.role === "single"
          ? "ist das ganze Netz (eine einzelne Adresse)"
          : info.offset < 10n ** 15n
            ? `ist Adresse Nr. ${formatCount(info.offset)} im Netz`
            : "liegt in diesem Netz";

  const tiles: { label: string; value: string; sub?: string }[] =
    v === 4
      ? [
          {
            label: "Nutzbare Hosts",
            value: formatCount(info.usable),
            sub: `${plural(info.size, "Adresse", "Adressen")} gesamt`,
          },
          { label: "Erster Host", value: f(info.firstHost) },
          { label: "Letzter Host", value: f(info.lastHost) },
          info.prefix <= 30
            ? { label: "Broadcast", value: f(info.last) }
            : { label: "Subnetzmaske", value: f(info.mask) },
        ]
      : [
          { label: "Adressen", value: formatCountShort(info.size) },
          { label: "Erste Adresse", value: f(info.network) },
          { label: "Letzte Adresse", value: f(info.last) },
          info.prefix <= 64
            ? {
                label: "/64-Subnetze darin",
                value: formatCountShort(1n << BigInt(64 - info.prefix)),
                sub: "Standardgröße für LANs",
              }
            : { label: "Präfix", value: `/${info.prefix}`, sub: "kleiner als /64, kein SLAAC" },
        ];

  const netRows: InfoRow[] = [
    { label: "Netz (CIDR)", value: cidr, copy: cidr },
    { label: "Netzadresse", value: f(info.network), copy: f(info.network) },
    { label: v === 4 ? "Broadcast" : "Letzte Adresse", value: f(info.last), copy: f(info.last) },
  ];
  if (v === 4) {
    netRows.push(
      { label: "Subnetzmaske", value: f(info.mask), copy: f(info.mask) },
      { label: "Wildcard-Maske", value: f(info.hostMask), copy: f(info.hostMask) },
    );
  }
  netRows.push({ label: "Präfixlänge", value: `/${info.prefix}` });
  if (v === 4) {
    const range = `${f(info.firstHost)} – ${f(info.lastHost)}`;
    netRows.push({ label: "Hostbereich", value: range, copy: range });
  }

  const detailRows: InfoRow[] = [{ label: "Adresstyp", value: type.label, plain: true }];
  if (v === 4) {
    const cls = ipv4Class(info.network);
    detailRows.push({
      label: "Historische Klasse",
      value: `${cls.name}${cls.defaultPrefix ? ` (Standard /${cls.defaultPrefix})` : ""}`,
      plain: true,
    });
  } else {
    detailRows.push({
      label: "Netzadresse ausgeschrieben",
      value: formatIpv6Full(info.network),
      copy: formatIpv6Full(info.network),
    });
  }
  detailRows.push({
    label: zones.total === 1 ? "Reverse-DNS-Zone" : `Reverse-DNS-Zonen (${zones.total})`,
    value: (
      <>
        {zones.zones.map((zone) => (
          <div key={zone}>{zone}</div>
        ))}
        {zones.total > zones.zones.length && (
          <div className="small">… und {zones.total - zones.zones.length} weitere</div>
        )}
        {zones.note && <div className="small">{zones.note}</div>}
      </>
    ),
    copy: zones.zones.join("\n"),
  });
  if (v === 4) {
    detailRows.push(
      { label: "Adresse dezimal", value: info.address.toString(), copy: info.address.toString() },
      {
        label: "Adresse hex",
        value: `0x${info.address.toString(16).toUpperCase().padStart(8, "0")}`,
      },
    );
  }

  const parent = info.prefix > 0 ? info.network & prefixMask(v, info.prefix - 1) : null;

  return (
    <>
      <div className="tool-result-head">
        <p className="tool-result-title mono">{cidr}</p>
        <CopyButton value={cidr} label="Netz kopieren" />
        <span className={type.private ? "pill pill-ok" : "pill pill-neutral"}>{type.label}</span>
        <span className="pill pill-neutral">IPv{v}</span>
      </div>
      <p className="small" role="status">
        Erkannt als {source}.
        {info.address !== info.network && (
          <>
            {" "}
            Die eingegebene Adresse <span className="mono">{f(info.address)}</span> {roleText}.
          </>
        )}
      </p>
      <dl className="kpis">
        {tiles.map((tile) => (
          <div className="kpi" key={tile.label}>
            <dt>{tile.label}</dt>
            <dd className="mono tool-kpi">{tile.value}</dd>
            {tile.sub && <dd className="small">{tile.sub}</dd>}
          </div>
        ))}
      </dl>

      <ToolSection title="Adresse in Bits">
        <BitView info={info} />
      </ToolSection>

      <ToolSection title="Netz">
        <InfoTable caption="Netz" rows={netRows} />
      </ToolSection>
      <ToolSection title="Details">
        <InfoTable caption="Details" rows={detailRows} />
      </ToolSection>

      <ToolSection title="Umliegende Netze">
        <div className="tool-row">
          <button
            type="button"
            className="button button-secondary"
            disabled={previous === null}
            onClick={() => previous !== null && onOpen(v, previous, info.prefix)}
          >
            Vorheriges: {previous !== null ? cidrText(v, previous, info.prefix) : "keines"}
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={next === null}
            onClick={() => next !== null && onOpen(v, next, info.prefix)}
          >
            Nächstes: {next !== null ? cidrText(v, next, info.prefix) : "keines"}
          </button>
          {parent !== null && (
            <button
              type="button"
              className="button button-secondary"
              onClick={() => onOpen(v, parent, info.prefix - 1)}
            >
              Übergeordnet: {cidrText(v, parent, info.prefix - 1)}
            </button>
          )}
        </div>
      </ToolSection>

      <CheckAddress info={info} value={check} onChange={onCheck} />
      {info.prefix < info.bits && (
        <SplitSection info={info} split={split} onSplit={onSplit} onOpen={onOpen} />
      )}
    </>
  );
}

function CheckAddress({
  info,
  value,
  onChange,
}: {
  info: SubnetInfo;
  value: string;
  onChange: (value: string) => void;
}) {
  let result: ReactNode = null;
  if (value.trim()) {
    const ip = parseIp(value);
    if (!ip) {
      result = <span className="pill pill-bad">keine gültige Adresse</span>;
    } else if (ip.version !== info.version) {
      result = <span className="pill pill-todo">andere IP-Version</span>;
    } else if (!contains(info, ip.value)) {
      result = (
        <span className="pill pill-bad">
          liegt nicht in {cidrText(info.version, info.network, info.prefix)}
        </span>
      );
    } else {
      const inner = calculateSubnet(info.version, ip.value, info.prefix);
      const special = inner.role === "network" || inner.role === "broadcast";
      const extra =
        inner.role === "network"
          ? ", Netzadresse"
          : inner.role === "broadcast"
            ? ", Broadcast-Adresse"
            : `, Adresse Nr. ${formatCount(inner.offset)}`;
      result = (
        <span className={special ? "pill pill-todo" : "pill pill-ok"}>liegt im Netz{extra}</span>
      );
    }
  }
  return (
    <ToolSection title="Adresse prüfen">
      <div className="tool-row">
        <label className="narrow">
          Adresse
          <input
            type="text"
            value={value}
            autoComplete="off"
            spellCheck={false}
            placeholder={info.version === 4 ? "192.168.10.200" : "2001:db8::42"}
            onChange={(event) => onChange(event.target.value)}
          />
        </label>
        <span role="status">{result}</span>
      </div>
    </ToolSection>
  );
}

function SplitSection({
  info,
  split,
  onSplit,
  onOpen,
}: {
  info: SubnetInfo;
  split: string;
  onSplit: (prefix: number) => void;
  onOpen: Open;
}) {
  const v = info.version;
  const maxTarget = Math.min(info.bits, info.prefix + 16);
  const fallback = Math.min(info.bits, info.prefix + (v === 4 ? 1 : 4));
  const wanted = clampInt(split, 1, 128, fallback);
  const target = wanted > info.prefix && wanted <= maxTarget ? wanted : fallback;
  const result = splitSubnet(info, target, SPLIT_LIMIT);
  const f = (value: bigint) => formatIp(v, value);
  const perNet = calculateSubnet(v, info.network, target);
  const list = result.items.map((item) => cidrText(v, item.network, item.prefix));

  return (
    <ToolSection title="Aufteilen">
      <div className="tool-row">
        <FixedChoice
          label="In Netze der Größe"
          value={String(target)}
          options={Array.from(
            { length: maxTarget - info.prefix },
            (_, i) => info.prefix + i + 1,
          ).map((prefix) => ({
            value: String(prefix),
            label: `/${prefix} – ${formatCountShort(1n << BigInt(prefix - info.prefix))} Netze`,
          }))}
          onChange={(value) => onSplit(Number(value))}
        />
        <span className="small">
          {formatCountShort(result.total)} Netze mit je{" "}
          {v === 4
            ? plural(perNet.usable, "nutzbarem Host", "nutzbaren Hosts")
            : plural(perNet.size, "Adresse", "Adressen")}
          {result.total > BigInt(result.items.length) && ` (angezeigt: die ersten ${SPLIT_LIMIT})`}
        </span>
        <CopyButton value={list.join("\n")} label="Liste kopieren" />
      </div>
      <div className="table-wrap tool-scroll" tabIndex={0} role="region" aria-label="Teilnetze">
        <table>
          <caption className="visually-hidden">Teilnetze</caption>
          <thead>
            <tr>
              <th scope="col">Nr.</th>
              <th scope="col">Netz</th>
              <th scope="col">{v === 4 ? "Erster Host" : "Erste Adresse"}</th>
              <th scope="col">{v === 4 ? "Letzter Host" : "Letzte Adresse"}</th>
              {v === 4 && <th scope="col">Broadcast</th>}
            </tr>
          </thead>
          <tbody>
            {result.items.map((item, index) => (
              <tr key={list[index]}>
                <td>{index + 1}</td>
                <td>
                  <NetLink onClick={() => onOpen(v, item.network, item.prefix)}>
                    {list[index]}
                  </NetLink>
                </td>
                <td className="mono">{f(item.firstHost)}</td>
                <td className="mono">{f(item.lastHost)}</td>
                {v === 4 && <td className="mono">{f(item.last)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ToolSection>
  );
}
