import { DataTable, NumField, Tile, Tiles, intParam, num, percent } from "../calc";
import { humanSize, parseSize } from "../data-units/units";
import { useToolParams } from "../params";
import { ErrorBox, ToolSection } from "../ui";
import { savingsFromRatio, storageNeed, type StorageYear } from "./storage";

export default function StorageNeedTool() {
  const [params, setParams] = useToolParams({
    daten: "10 TB",
    komprimierung: "2",
    dedup: "1",
    wachstum: "15",
    jahre: "5",
    reserve: "20",
  });
  const years = intParam(params.jahre, 0, 20, 5);
  const size = parseSize(params.daten);
  let rows: StorageYear[] = [];
  let error: string | null = null;
  try {
    if (!size) {
      throw new Error("Gib die Datenmenge mit Einheit an, z. B. „10 TB“ oder „500 GB“.");
    }
    const [compression, dedup, growth, reserve] = [
      num(params.komprimierung),
      num(params.dedup),
      num(params.wachstum),
      num(params.reserve),
    ];
    if ([compression, dedup, growth, reserve].some(Number.isNaN)) {
      throw new Error("Bitte füll alle Felder mit Zahlen.");
    }
    rows = storageNeed({ data: size.bits / 8, compression, dedup, growth, years, reserve });
  } catch (caught) {
    error = (caught as Error).message;
  }
  const now = rows[0];
  const last = rows[rows.length - 1];
  const totalRatio = num(params.komprimierung) * num(params.dedup);
  const span = `${years} ${years === 1 ? "Jahr" : "Jahren"}`;

  return (
    <div className="tool-body settings-form">
      <div className="tool-columns">
        <div className="tool-field">
          <label>
            Datenmenge heute (unkomprimiert)
            <input
              type="text"
              className="mono"
              autoComplete="off"
              value={params.daten}
              onChange={(event) => setParams({ daten: event.target.value })}
            />
          </label>
        </div>
        <NumField
          label="Komprimierung"
          unit="zu 1"
          value={params.komprimierung}
          onChange={(text) => setParams({ komprimierung: text })}
          hint="2 heißt 2:1, die Daten belegen die Hälfte. 1 = keine."
        />
        <NumField
          label="Deduplizierung"
          unit="zu 1"
          value={params.dedup}
          onChange={(text) => setParams({ dedup: text })}
          hint="Zusätzlich zur Komprimierung. 1 = keine."
        />
        <NumField
          label="Wachstum pro Jahr"
          unit="%"
          value={params.wachstum}
          onChange={(text) => setParams({ wachstum: text })}
        />
        <div className="tool-field">
          <label>
            Planungszeitraum (Jahre)
            <input
              type="number"
              min={0}
              max={20}
              value={params.jahre}
              onChange={(event) => setParams({ jahre: event.target.value })}
            />
          </label>
        </div>
        <NumField
          label="Reserve"
          unit="%"
          value={params.reserve}
          onChange={(text) => setParams({ reserve: text })}
          hint="Zuschlag auf den belegten Platz: volle Speicher werden langsam."
        />
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}
      {now && last && (
        <>
          <Tiles>
            <Tile
              value={humanSize(now.withReserve, "dezimal")}
              label="Bedarf heute (mit Reserve)"
            />
            <Tile
              value={humanSize(last.withReserve, "dezimal")}
              label={`Bedarf in ${span}`}
              tone="ok"
            />
            <Tile
              value={percent(savingsFromRatio(totalRatio), 0)}
              label={`Einsparung (gesamt ${totalRatio.toLocaleString("de-DE", { maximumFractionDigits: 2 })}:1)`}
            />
            <Tile value={humanSize(last.raw, "dezimal")} label={`Rohdaten in ${span}`} />
          </Tiles>
          <ToolSection title="Verlauf">
            <DataTable
              caption="Speicherbedarf je Jahr"
              head={[
                "Jahr",
                "Rohdaten",
                "nach Komprimierung und Dedup",
                "mit Reserve",
                "wie Windows anzeigt",
              ]}
              highlight={(index) => index === rows.length - 1}
              rows={rows.map((row) => [
                row.year === 0 ? "heute" : `+${row.year}`,
                humanSize(row.raw, "dezimal"),
                humanSize(row.reduced, "dezimal"),
                <strong key="reserve">{humanSize(row.withReserve, "dezimal")}</strong>,
                humanSize(row.withReserve, "binär"),
              ])}
            />
            <p className="small">
              Faustwerte: Office-Dokumente und Datenbanken 2 bis 3:1, virtuelle Maschinen 1,5 bis
              2:1 (mit Deduplizierung deutlich mehr), bereits komprimierte Daten wie Videos, Bilder,
              ZIP oder verschlüsselte Dateien etwa 1:1. Der berechnete Wert ist Nutzkapazität; der
              Verschnitt durch RAID kommt noch dazu.
            </p>
          </ToolSection>
        </>
      )}
    </div>
  );
}
