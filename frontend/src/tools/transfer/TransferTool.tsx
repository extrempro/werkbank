import { clampInt, useToolParams } from "../params";
import { humanSize, parseNumber, parseSize } from "../data-units/units";
import { duration, durationText, parseDuration, presets, rateText, requiredRate } from "./transfer";

const RATE_FACTOR = { kbit: 1e3, Mbit: 1e6, Gbit: 1e9 } as const;
type RateUnit = keyof typeof RATE_FACTOR;
const isRateUnit = (text: string): text is RateUnit => text in RATE_FACTOR;

export default function TransferTool() {
  const [params, setParams] = useToolParams({
    modus: "dauer",
    menge: "500 GB",
    rate: "100",
    einheit: "Mbit",
    fenster: "8 h",
    anteil: "90",
  });
  const wantRate = params.modus === "bandbreite";
  const rateUnit: RateUnit = isRateUnit(params.einheit) ? params.einheit : "Mbit";
  const share = clampInt(params.anteil, 50, 100, 90);
  const size = parseSize(params.menge);
  const bytes = size ? size.bits / 8 : null;
  const rateNumber = parseNumber(params.rate);
  const rate = rateNumber ? rateNumber * RATE_FACTOR[rateUnit] : null;
  const windowSeconds = parseDuration(params.fenster);
  const efficiency = share / 100;

  return (
    <div className="tool-body settings-form">
      <label className="narrow">
        Modus
        <select
          value={wantRate ? "bandbreite" : "dauer"}
          onChange={(event) => setParams({ modus: event.target.value })}
        >
          <option value="dauer">Dauer berechnen</option>
          <option value="bandbreite">Bandbreite berechnen</option>
        </select>
      </label>
      <div className="tool-columns">
        <div className="tool-field">
          <label>
            Datenmenge
            <input
              type="text"
              className="mono"
              autoComplete="off"
              value={params.menge}
              onChange={(event) => setParams({ menge: event.target.value })}
            />
          </label>
          <p className="small">
            {bytes
              ? `= ${humanSize(bytes, "dezimal")} = ${humanSize(bytes, "binär")}`
              : "Zahl mit Einheit, z. B. 500 GB, 1,5 TiB oder 800 MB."}
          </p>
        </div>
        {wantRate ? (
          <div className="tool-field">
            <label>
              Zeitfenster
              <input
                type="text"
                className="mono"
                autoComplete="off"
                value={params.fenster}
                onChange={(event) => setParams({ fenster: event.target.value })}
              />
            </label>
            <p className="small">
              {windowSeconds
                ? `= ${durationText(windowSeconds)}`
                : "Angabe nicht erkannt, z. B. 8 h, 2 Tage, 30 min oder 01:30."}
            </p>
          </div>
        ) : (
          <div className="tool-field">
            <div className="tool-row">
              <label>
                Bandbreite
                <input
                  type="text"
                  className="mono"
                  inputMode="decimal"
                  autoComplete="off"
                  value={params.rate}
                  onChange={(event) => setParams({ rate: event.target.value })}
                />
              </label>
              <label>
                Einheit
                <select
                  value={rateUnit}
                  onChange={(event) => setParams({ einheit: event.target.value })}
                >
                  <option value="kbit">kbit/s</option>
                  <option value="Mbit">Mbit/s</option>
                  <option value="Gbit">Gbit/s</option>
                </select>
              </label>
            </div>
            <div className="chips" role="group" aria-label="Übliche Bandbreiten">
              {presets.map((preset) => {
                const unit: RateUnit = preset.rate >= 1e9 ? "Gbit" : "Mbit";
                return (
                  <button
                    key={preset.label}
                    type="button"
                    className="chip"
                    onClick={() =>
                      setParams({
                        rate: String(preset.rate / RATE_FACTOR[unit]).replace(".", ","),
                        einheit: unit,
                      })
                    }
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="tool-field">
          <label>
            Nutzbarer Anteil: {share} %
            <input
              type="range"
              min={50}
              max={100}
              value={share}
              onChange={(event) => setParams({ anteil: event.target.value })}
            />
          </label>
          <p className="small">
            Overhead durch TCP/IP, VPN und Protokolle: 90 % ist realistisch, über VPN oder WLAN eher
            70 bis 80 %.
          </p>
        </div>
      </div>

      {!wantRate && bytes && rate && (
        <div className="tool-result" role="status">
          <p className="tool-result-title">{durationText(duration(bytes, rate, efficiency))}</p>
          <p className="small">
            bei effektiv {rateText(rate * efficiency)} ≈{" "}
            {humanSize((rate * efficiency) / 8, "dezimal")}/s · pro Stunde etwa{" "}
            {humanSize((rate * efficiency * 3600) / 8, "dezimal")}, pro Tag{" "}
            {humanSize((rate * efficiency * 86400) / 8, "dezimal")}
          </p>
        </div>
      )}
      {wantRate && bytes && windowSeconds && (
        <div className="tool-result" role="status">
          <p className="tool-result-title">
            {rateText(requiredRate(bytes, windowSeconds, efficiency))}
          </p>
          <p className="small">
            Leitungsbandbreite, um {humanSize(bytes, "dezimal")} in {durationText(windowSeconds)} zu
            übertragen (effektiv {humanSize(bytes / windowSeconds, "dezimal")}/s)
          </p>
        </div>
      )}
      <p className="small">
        Bandbreite wird in Bit pro Sekunde angegeben, Datenmengen in Byte: 100 Mbit/s sind höchstens
        12,5 MB/s.
      </p>
    </div>
  );
}
