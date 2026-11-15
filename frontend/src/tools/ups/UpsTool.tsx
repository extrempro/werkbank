import { NumField, Tile, Tiles, dec, intParam, num } from "../calc";
import { useToolParams } from "../params";
import { durationText } from "../transfer/transfer";
import { ErrorBox, InfoTable, ToolSection } from "../ui";
import { energyWh, requiredAh, runtime, sizing } from "./ups";

export default function UpsTool() {
  const [params, setParams] = useToolParams({
    watt: "800",
    faktor: "0,9",
    last: "80",
    spannung: "12",
    ah: "9",
    anzahl: "4",
    wirkungsgrad: "90",
    nutzbar: "80",
    laufzeit: "15",
  });
  const watts = num(params.watt);
  const count = intParam(params.anzahl, 1, 400, 4);
  const battery = {
    voltage: num(params.spannung),
    ah: num(params.ah),
    count,
    efficiency: num(params.wirkungsgrad),
    usable: num(params.nutzbar),
  };
  let size: ReturnType<typeof sizing> | null = null;
  let error: string | null = null;
  try {
    size = sizing({ watts, powerFactor: num(params.faktor), maxLoad: num(params.last) });
  } catch (caught) {
    error = (caught as Error).message;
  }
  const batteryOk =
    [battery.voltage, battery.ah, battery.efficiency, battery.usable].every((x) => x > 0) &&
    battery.efficiency <= 100 &&
    battery.usable <= 100;
  const seconds = batteryOk && watts > 0 ? runtime(battery, watts) : null;
  const wanted = num(params.laufzeit);
  const neededAh =
    batteryOk && watts > 0 && wanted > 0 ? requiredAh(battery, watts, wanted * 60) : null;

  return (
    <div className="tool-body settings-form">
      <ToolSection title="Verbraucher">
        <div className="tool-columns">
          <NumField
            label="Leistung aller Geräte"
            unit="W"
            value={params.watt}
            onChange={(text) => setParams({ watt: text })}
            hint="Werte vom Typenschild sind Höchstwerte; gemessene Werte sind besser."
          />
          <NumField
            label="Leistungsfaktor (cos φ)"
            value={params.faktor}
            onChange={(text) => setParams({ faktor: text })}
            hint="Server-Netzteile mit PFC: 0,9 bis 1. Ältere Geräte: 0,6 bis 0,7."
          />
          <NumField
            label="USV höchstens auslasten zu"
            unit="%"
            value={params.last}
            onChange={(text) => setParams({ last: text })}
            hint="Üblich sind 70 bis 80 %: Reserve für Erweiterungen und Einschaltströme."
          />
        </div>
        {error && <ErrorBox>{error}</ErrorBox>}
        {size && (
          <>
            <Tiles>
              <Tile value={`${dec(size.va, 0)} VA`} label="Scheinleistung der Last" />
              <Tile
                value={`${dec(size.recommendedVa, 0)} VA`}
                label="USV mindestens (Scheinleistung)"
                tone="ok"
              />
              <Tile
                value={`${dec(size.recommendedWatts, 0)} W`}
                label="USV mindestens (Wirkleistung)"
                tone="ok"
              />
              <Tile
                value={seconds !== null ? durationText(seconds) : "–"}
                label="Überbrückungszeit (geschätzt)"
              />
            </Tiles>
            <p className="small">
              Eine USV hat zwei Grenzen: VA und Watt. Beide müssen über den berechneten Werten
              liegen; eine „1500-VA-USV“ liefert oft nur 900 bis 1350 W.
            </p>
          </>
        )}
      </ToolSection>

      <ToolSection title="Batterien und Laufzeit">
        <div className="tool-columns">
          <NumField
            label="Spannung je Batterie"
            unit="V"
            value={params.spannung}
            onChange={(text) => setParams({ spannung: text })}
          />
          <NumField
            label="Kapazität je Batterie"
            unit="Ah"
            value={params.ah}
            onChange={(text) => setParams({ ah: text })}
          />
          <div className="tool-field">
            <label>
              Anzahl Batterien
              <input
                type="number"
                min={1}
                max={400}
                value={params.anzahl}
                onChange={(event) => setParams({ anzahl: event.target.value })}
              />
            </label>
          </div>
          <NumField
            label="Wirkungsgrad des Wechselrichters"
            unit="%"
            value={params.wirkungsgrad}
            onChange={(text) => setParams({ wirkungsgrad: text })}
          />
          <NumField
            label="Nutzbare Kapazität"
            unit="%"
            value={params.nutzbar}
            onChange={(text) => setParams({ nutzbar: text })}
            hint="Alterung und Entladetiefe: neu etwa 80 %, nach einigen Jahren 50 bis 60 %."
          />
          <NumField
            label="Gewünschte Laufzeit"
            unit="min"
            value={params.laufzeit}
            onChange={(text) => setParams({ laufzeit: text })}
          />
        </div>
        {!batteryOk && (
          <ErrorBox>
            Batteriedaten prüfen: Spannung, Kapazität und Prozentwerte (1 bis 100) als Zahl angeben.
          </ErrorBox>
        )}
        {batteryOk && seconds !== null && (
          <InfoTable
            caption="Batterien und Laufzeit"
            rows={[
              { label: "Nutzbare Energie", plain: true, value: `${dec(energyWh(battery), 0)} Wh` },
              { label: "Laufzeit bei dieser Last", plain: true, value: durationText(seconds) },
              {
                label: "Laufzeit bei halber Last",
                plain: true,
                value: `mindestens ${durationText(seconds * 2)}`,
              },
              ...(neededAh !== null
                ? [
                    {
                      label: `Für ${params.laufzeit} min nötig`,
                      plain: true,
                      value: `${dec(neededAh, 1)} Ah je Batterie (bei ${count} × ${params.spannung} V)`,
                    },
                  ]
                : []),
            ]}
          />
        )}
        <p className="small">
          Die Laufzeit ist eine Abschätzung aus der gespeicherten Energie. Bleiakkus liefern bei
          hoher Last weniger als ihre Nennkapazität (Peukert-Effekt); verbindlich sind die
          Laufzeit-Tabellen des Herstellers. Die Zeit muss mindestens für das geordnete
          Herunterfahren reichen.
        </p>
      </ToolSection>
    </div>
  );
}
