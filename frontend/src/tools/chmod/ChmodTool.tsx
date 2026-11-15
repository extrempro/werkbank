import { useMemo, useState } from "react";
import { useToolParams } from "../params";
import { CopyButton, ErrorBox, InfoTable, ToolSection } from "../ui";
import {
  bit,
  describe,
  fromUmask,
  parseMode,
  PERMS,
  SETGID,
  SETUID,
  STICKY,
  toChmodSymbolic,
  toOctal,
  toSymbolic,
  WHO,
} from "./chmod";

const WHO_LABEL = { u: "Besitzer", g: "Gruppe", o: "Andere" } as const;
const PERM_LABEL = { r: "Lesen", w: "Schreiben", x: "Ausführen" } as const;
const SPECIAL: [number, string][] = [
  [SETUID, "SetUID"],
  [SETGID, "SetGID"],
  [STICKY, "Sticky"],
];

export default function ChmodTool() {
  const [params, setParams] = useToolParams({ rechte: "755" });
  const mode = params.rechte;
  const [umask, setUmask] = useState("022");

  const parsed = useMemo(() => {
    try {
      return { value: parseMode(mode), error: null };
    } catch (caught) {
      return { value: null, error: (caught as Error).message };
    }
  }, [mode]);
  const value = parsed.value ?? 0;
  const set = (next: number) => setParams({ rechte: toOctal(next) });
  const masked = /^[0-7]{1,4}$/.test(umask.trim()) ? fromUmask(parseInt(umask, 8)) : null;

  return (
    <div className="tool-body settings-form">
      <label className="narrow">
        Rechte (755, rwxr-xr-x oder u=rwx,g=rx,o=rx)
        <input
          type="text"
          value={mode}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setParams({ rechte: event.target.value })}
        />
      </label>
      {parsed.error && <ErrorBox>{parsed.error}</ErrorBox>}

      <div className="table-wrap" tabIndex={0} role="region" aria-label="Rechte auswählen">
        <table className="tool-grid">
          <caption className="visually-hidden">Rechte je Besitzer, Gruppe und Andere</caption>
          <thead>
            <tr>
              <td />
              {PERMS.map((perm) => (
                <th key={perm} scope="col">
                  {PERM_LABEL[perm]}
                </th>
              ))}
              <th scope="col">Oktal</th>
            </tr>
          </thead>
          <tbody>
            {WHO.map((who) => (
              <tr key={who}>
                <th scope="row">{WHO_LABEL[who]}</th>
                {PERMS.map((perm) => (
                  <td key={perm}>
                    <input
                      type="checkbox"
                      className="check"
                      aria-label={`${WHO_LABEL[who]} ${PERM_LABEL[perm]}`}
                      checked={(value & bit(who, perm)) !== 0}
                      onChange={() => set(value ^ bit(who, perm))}
                    />
                  </td>
                ))}
                <td className="mono">{(value >> (3 * (2 - WHO.indexOf(who)))) & 7}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="tool-row">
        {SPECIAL.map(([flag, label]) => (
          <label key={label} className="check-label">
            <input
              type="checkbox"
              className="check"
              checked={(value & flag) !== 0}
              onChange={() => set(value ^ flag)}
            />
            {label}
          </label>
        ))}
      </div>

      <InfoTable
        caption="Schreibweisen"
        rows={[
          { label: "Oktal", value: toOctal(value), copy: toOctal(value) },
          { label: "Symbolisch (ls -l)", value: toSymbolic(value), copy: toSymbolic(value) },
          {
            label: "chmod symbolisch",
            value: toChmodSymbolic(value),
            copy: toChmodSymbolic(value),
          },
          {
            label: "Befehl",
            value: `chmod ${toOctal(value)} datei`,
            copy: `chmod ${toOctal(value)} `,
          },
        ]}
      />
      <ul className="tool-list">
        {describe(value).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      <ToolSection title="umask">
        <div className="tool-row">
          <label className="narrow">
            umask
            <input
              type="text"
              value={umask}
              autoComplete="off"
              onChange={(event) => setUmask(event.target.value)}
            />
          </label>
          {masked && (
            <>
              <span>
                Neue Dateien: <span className="mono">{toOctal(masked.file)}</span> (
                {toSymbolic(masked.file)})
              </span>
              <span>
                Neue Ordner: <span className="mono">{toOctal(masked.dir)}</span> (
                {toSymbolic(masked.dir)})
              </span>
              <CopyButton value={`umask ${umask.trim()}`} label="umask-Befehl kopieren" />
            </>
          )}
        </div>
      </ToolSection>
    </div>
  );
}
