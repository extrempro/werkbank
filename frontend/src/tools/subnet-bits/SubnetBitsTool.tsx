import { clampInt, useToolParams } from "../params";
import { ErrorBox, InfoTable, ToolSection, type InfoRow } from "../ui";
import { subnetBits, type BitsResult } from "./bits";

const num = (value: number) => value.toLocaleString("de-DE");

function BitBar({ base, sub }: { base: number; sub: number }) {
  const label = `${base} Netz-Bits, ${sub} Subnetz-Bits, ${32 - base - sub} Host-Bits`;
  return (
    <div className="bits" role="img" aria-label={label}>
      {[0, 1, 2, 3].map((octet) => (
        <div key={octet} className="bits-row">
          {Array.from({ length: 8 }, (_, index) => {
            const position = octet * 8 + index;
            const kind = position < base ? "host" : position < base + sub ? "net" : "mixed";
            return (
              <span key={index} className={`bit bit-${kind}`}>
                {position < base ? "N" : position < base + sub ? "S" : "H"}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export default function SubnetBitsTool() {
  const [params, setParams] = useToolParams({
    netz: "192.168.10.0/24",
    subnetze: "4",
    hosts: "50",
  });
  const subnets = clampInt(params.subnetze, 1, 16_777_216, 4);
  const hosts = clampInt(params.hosts, 0, 16_777_214, 50);
  let result: BitsResult | null = null;
  let error: string | null = null;
  try {
    result = subnetBits(params.netz, subnets, hosts);
  } catch (caught) {
    error = (caught as Error).message;
  }

  const rows: InfoRow[] = result
    ? [
        {
          label: "Subnetz-Bits",
          plain: true,
          value: `2^${result.subnetBits} = ${num(result.subnets)} ≥ ${num(subnets)} Subnetze`,
        },
        ...(hosts > 0
          ? [
              {
                label: "Host-Bits nötig",
                plain: true,
                value: `2^${result.hostBitsNeeded} − 2 = ${num(2 ** result.hostBitsNeeded - 2)} ≥ ${num(hosts)} Hosts`,
              },
            ]
          : []),
        {
          label: "Neues Präfix",
          plain: true,
          value: `/${result.basePrefix} + ${result.subnetBits} = /${result.newPrefix}`,
        },
        { label: "Subnetzmaske", value: result.mask, copy: result.mask },
        {
          label: "Hosts je Subnetz",
          plain: true,
          value: `2^${Math.max(result.hostBits, 0)} − 2 = ${num(result.hostsPerSubnet)}`,
        },
        {
          label: "Schrittweite",
          plain: true,
          value: `256 − ${256 - result.blockSize} = ${result.blockSize} im ${result.octet}. Oktett`,
        },
        ...(result.fits && result.spareBits > 0
          ? [
              {
                label: "Luft",
                plain: true,
                value: `${result.spareBits} Bit übrig: Bis zu ${num(2 ** (result.subnetBits + result.spareBits))} Subnetze wären mit ${num(hosts)} Hosts möglich`,
              },
            ]
          : []),
      ]
    : [];

  return (
    <div className="tool-body settings-form">
      <div className="form-grid">
        <label>
          Ausgangsnetz
          <input
            type="text"
            value={params.netz}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setParams({ netz: event.target.value })}
          />
        </label>
        <label>
          Benötigte Subnetze
          <input
            type="number"
            min={1}
            value={subnets}
            onChange={(event) => setParams({ subnetze: event.target.value })}
          />
        </label>
        <label>
          Hosts je Subnetz (0 = egal)
          <input
            type="number"
            min={0}
            value={hosts}
            onChange={(event) => setParams({ hosts: event.target.value })}
          />
        </label>
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}
      {result && (
        <>
          {!result.fits && (
            <ErrorBox>
              Das passt nicht: {result.subnetBits} Subnetz-Bits + {result.hostBitsNeeded} Host-Bits
              = {result.subnetBits + result.hostBitsNeeded} Bits, im /{result.basePrefix} sind aber
              nur {32 - result.basePrefix} frei. Es fehlen {-result.spareBits} Bit. Wähle ein
              größeres Ausgangsnetz oder weniger Subnetze bzw. Hosts.
            </ErrorBox>
          )}
          <dl className="kpis">
            <div className="kpi">
              <dt>Für Subnetze geborgt</dt>
              <dd className="tool-kpi">{result.subnetBits} Bit</dd>
              <dd className="small">{num(result.subnets)} Subnetze</dd>
            </div>
            <div className="kpi">
              <dt>Neues Präfix</dt>
              <dd className="tool-kpi mono">/{result.newPrefix}</dd>
              <dd className="small mono">{result.mask}</dd>
            </div>
            <div className="kpi">
              <dt>Für Hosts</dt>
              <dd className="tool-kpi">{Math.max(result.hostBits, 0)} Bit</dd>
              <dd className="small">{num(result.hostsPerSubnet)} Hosts je Subnetz</dd>
            </div>
            <div className="kpi">
              <dt>Schrittweite</dt>
              <dd className="tool-kpi">{num(result.blockSize)}</dd>
              <dd className="small">im {result.octet}. Oktett</dd>
            </div>
          </dl>

          <ToolSection title="Aufteilung der 32 Bit">
            <BitBar
              base={result.basePrefix}
              sub={Math.min(result.subnetBits, 32 - result.basePrefix)}
            />
            <p className="small">
              N: {result.basePrefix} Netz-Bits (vorgegeben) · S: {result.subnetBits} Subnetz-Bits
              (geborgt) · H: {Math.max(result.hostBits, 0)} Host-Bits
            </p>
          </ToolSection>

          <ToolSection title="Rechenweg">
            <InfoTable caption="Rechenweg" rows={rows} />
          </ToolSection>

          {result.examples.length > 0 && (
            <ToolSection
              title={
                result.subnets > result.examples.length
                  ? `Die ersten ${result.examples.length} von ${num(result.subnets)} Subnetzen`
                  : "Die Subnetze"
              }
            >
              <div className="table-wrap" tabIndex={0} role="region" aria-label="Subnetze">
                <table>
                  <caption className="visually-hidden">Subnetze</caption>
                  <thead>
                    <tr>
                      <th scope="col">Nr.</th>
                      <th scope="col">Netz</th>
                      <th scope="col">Erster Host</th>
                      <th scope="col">Letzter Host</th>
                      <th scope="col">Broadcast</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.examples.map((example, index) => (
                      <tr key={example.network}>
                        <td>{index + 1}</td>
                        <td className="mono">{example.network}</td>
                        <td className="mono">{example.first}</td>
                        <td className="mono">{example.last}</td>
                        <td className="mono">{example.broadcast}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="small">
                Für unterschiedlich große Subnetze und alle Details zu einem Netz gibt es den
                Subnetz-Rechner.
              </p>
            </ToolSection>
          )}
        </>
      )}
    </div>
  );
}
