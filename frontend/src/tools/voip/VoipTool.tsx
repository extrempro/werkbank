import { FixedChoice } from "../../components/ListChoice";
import { NumField, Tile, Tiles, dec, intParam, num, percent } from "../calc";
import { useToolParams } from "../params";
import { rateText } from "../transfer/transfer";
import { ErrorBox, InfoTable, ToolSection } from "../ui";
import { codecs, layer2Labels, voipBandwidth, type Layer2, type VoipResult } from "./voip";

const PTIMES = ["10", "20", "30", "40", "60"];
const LAYERS = Object.keys(layer2Labels) as Layer2[];

export default function VoipTool() {
  const [params, setParams] = useToolParams({
    codec: "g711",
    intervall: "20",
    schicht2: "ethernet",
    ipv6: "0",
    srtp: "0",
    anzahl: "10",
    leitung: "10",
  });
  const codec = codecs.find((entry) => entry.id === params.codec) ?? codecs[0];
  const ptime = PTIMES.includes(params.intervall) ? params.intervall : "20";
  const layer2 = LAYERS.find((entry) => entry === params.schicht2) ?? "ethernet";
  const ipv6 = params.ipv6 === "1";
  const srtp = params.srtp === "1";
  const calls = intParam(params.anzahl, 1, 100000, 10);
  let result: VoipResult | null = null;
  let error: string | null = null;
  try {
    if (!codec) {
      throw new Error("Codec nicht gefunden.");
    }
    result = voipBandwidth({ kbps: codec.kbps, ptime: Number(ptime), ipv6, layer2, srtp, calls });
  } catch (caught) {
    error = (caught as Error).message;
  }
  const line = num(params.leitung) * 1e6;
  const maxCalls = result && line > 0 ? Math.floor(line / result.perCall) : null;

  return (
    <div className="tool-body settings-form">
      <div className="tool-columns">
        <div className="tool-field">
          <FixedChoice
            label="Codec"
            value={String(codec?.id ?? "g711")}
            options={[
              ...codecs.map((entry) => ({ value: String(entry.id), label: String(entry.name) })),
            ]}
            onChange={(value) => setParams({ codec: value })}
          />
          <p className="small">{codec?.note}</p>
        </div>
        <div className="tool-field">
          <FixedChoice
            label="Paketintervall"
            value={String(ptime)}
            options={[
              ...PTIMES.map((entry) => ({
                value: String(entry),
                label: `${entry} ms${entry === "20" ? " (Standard)" : ""}`,
              })),
            ]}
            onChange={(value) => setParams({ intervall: value })}
          />
        </div>
        <div className="tool-field">
          <label>
            Gleichzeitige Gespräche
            <input
              type="number"
              min={1}
              max={100000}
              value={params.anzahl}
              onChange={(event) => setParams({ anzahl: event.target.value })}
            />
          </label>
        </div>
        <div className="tool-field">
          <FixedChoice
            label="Übertragung"
            value={String(layer2)}
            options={[
              ...LAYERS.map((entry) => ({
                value: String(entry),
                label: String(layer2Labels[entry]),
              })),
            ]}
            onChange={(value) => setParams({ schicht2: value })}
          />
        </div>
      </div>
      <fieldset className="tool-options">
        <legend>Optionen</legend>
        <label className="check-label">
          <input
            type="checkbox"
            className="check"
            checked={ipv6}
            onChange={(event) => setParams({ ipv6: event.target.checked ? "1" : "0" })}
          />
          IPv6 (40 statt 20 Byte Header)
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            className="check"
            checked={srtp}
            onChange={(event) => setParams({ srtp: event.target.checked ? "1" : "0" })}
          />
          SRTP (verschlüsselt, 10 Byte mehr)
        </label>
      </fieldset>

      {error && <ErrorBox>{error}</ErrorBox>}
      {result && codec && (
        <>
          <Tiles>
            <Tile value={rateText(result.perCall)} label="je Gespräch und Richtung" />
            <Tile
              value={rateText(result.total)}
              label={`für ${calls} ${calls === 1 ? "Gespräch" : "Gespräche"}, je Richtung`}
              tone="ok"
            />
            <Tile
              value={`${dec(result.packetBytes, 0)} Byte`}
              label={`je Paket, ${dec(result.pps, 1)} Pakete/s`}
            />
            <Tile value={percent(result.overheadPercent, 0)} label="davon Header (Overhead)" />
          </Tiles>
          <ToolSection title="Zusammensetzung eines Pakets">
            <InfoTable
              caption="Zusammensetzung eines Pakets"
              rows={[
                {
                  label: "Sprachdaten",
                  plain: true,
                  value: `${dec(result.payloadBytes, 1)} Byte (${dec(codec.kbps, 1)} kbit/s × ${ptime} ms)`,
                },
                {
                  label: "RTP + UDP + IP",
                  plain: true,
                  value: `12 + 8 + ${ipv6 ? 40 : 20} Byte${srtp ? " + 10 Byte SRTP" : ""}`,
                },
                { label: "Schicht 2", plain: true, value: layer2Labels[layer2] },
                { label: "Header gesamt", plain: true, value: `${result.headerBytes} Byte` },
                {
                  label: "Mit 5 % für RTCP",
                  plain: true,
                  value: `${rateText(result.total * 1.05)} je Richtung`,
                },
              ]}
            />
          </ToolSection>
          <ToolSection title="Wie viele Gespräche schafft die Leitung?">
            <NumField
              label="Bandbreite (kleinere Richtung, meist Upload)"
              unit="Mbit/s"
              value={params.leitung}
              onChange={(text) => setParams({ leitung: text })}
            />
            <Tiles>
              <Tile
                value={maxCalls !== null ? `${maxCalls.toLocaleString("de-DE")} Gespräche` : "–"}
                label="rechnerisch, wenn die Leitung nur für Telefonie da ist"
                tone={maxCalls !== null && maxCalls < calls ? "bad" : "ok"}
              />
            </Tiles>
            <p className="small">
              Die Bandbreite gilt je Richtung: Ein Gespräch belegt Upload und Download gleich stark.
              Teilen sich Telefonie und Daten die Leitung, braucht es QoS, sonst leidet die
              Sprachqualität schon lange vor der rechnerischen Grenze. Mit Sprachpausenerkennung
              (VAD) sinkt der Bedarf um etwa ein Drittel; planen sollte man ohne.
            </p>
          </ToolSection>
        </>
      )}
    </div>
  );
}
