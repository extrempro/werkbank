import { useMemo } from "react";
import { asSigned, bytesOf, group, parseNumber, twosComplement } from "../lib/number";
import { useToolParams } from "../params";
import { ErrorBox, InfoTable, ToolSection, type InfoRow } from "../ui";

const hex = (byte: number) => byte.toString(16).padStart(2, "0");

export default function NumberBaseTool() {
  const [params, setParams] = useToolParams({ zahl: "255" });
  const input = params.zahl;

  const result = useMemo((): { value: bigint } | { error: string } | null => {
    if (!input.trim()) {
      return null;
    }
    try {
      return { value: parseNumber(input).value };
    } catch (caught) {
      return { error: (caught as Error).message };
    }
  }, [input]);
  const value = result && "value" in result ? result.value : null;

  let rows: InfoRow[] = [];
  if (value !== null) {
    const abs = value < 0n ? -value : value;
    const sign = value < 0n ? "-" : "";
    const upper = abs.toString(16).toUpperCase();
    rows = [
      {
        label: "Dezimal",
        value: sign + group(abs.toString(10), 3, "."),
        copy: value.toString(10),
      },
      { label: "Hexadezimal", value: `${sign}0x${group(upper, 4)}`, copy: `${sign}0x${upper}` },
      { label: "Binär", value: sign + group(abs.toString(2), 4), copy: sign + abs.toString(2) },
      {
        label: "Oktal",
        value: `${sign}0o${abs.toString(8)}`,
        copy: `${sign}0o${abs.toString(8)}`,
      },
      { label: "Bits", value: String(abs.toString(2).length) },
      ...(value >= 0n
        ? [
            {
              label: "Bytes (Big Endian)",
              value: bytesOf(value)
                .map((byte) => hex(byte).toUpperCase())
                .join(" "),
              copy: bytesOf(value).map(hex).join(""),
            },
          ]
        : []),
      ...(value >= 32n && value < 127n
        ? [{ label: "ASCII-Zeichen", value: String.fromCharCode(Number(value)) }]
        : []),
    ];
  }

  return (
    <div className="tool-body settings-form">
      <label className="narrow">
        Zahl
        <input
          type="text"
          className="mono"
          value={input}
          onChange={(event) => setParams({ zahl: event.target.value })}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <p className="small">Präfix 0x, 0b, 0o oder Endung h; ohne Angabe dezimal.</p>
      {result && "error" in result && <ErrorBox>{result.error}</ErrorBox>}
      {value !== null && (
        <>
          <InfoTable caption="Darstellungen der Zahl" rows={rows} />
          <ToolSection title="Zweierkomplement (feste Breite)">
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Zweierkomplement">
              <table>
                <caption className="visually-hidden">Zweierkomplement</caption>
                <thead>
                  <tr>
                    <th scope="col">Breite</th>
                    <th scope="col">Hex</th>
                    <th scope="col">mit Vorzeichen</th>
                    <th scope="col">ohne Vorzeichen</th>
                  </tr>
                </thead>
                <tbody>
                  {[8, 16, 32, 64].map((bits) => {
                    const complement = twosComplement(value, bits);
                    return (
                      <tr key={bits}>
                        <th scope="row">{bits} Bit</th>
                        <td className="mono">
                          {complement === null
                            ? "passt nicht"
                            : `0x${complement
                                .toString(16)
                                .toUpperCase()
                                .padStart(bits / 4, "0")}`}
                        </td>
                        <td className="mono">
                          {complement === null ? "–" : String(asSigned(complement, bits))}
                        </td>
                        <td className="mono">{complement === null ? "–" : String(complement)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="small">
              Praktisch zum Beispiel für Windows-Fehlercodes: 0x80070005 ist als 32 Bit mit
              Vorzeichen −2147024891.
            </p>
          </ToolSection>
        </>
      )}
    </div>
  );
}
