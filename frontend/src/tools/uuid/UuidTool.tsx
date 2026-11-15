import { useState } from "react";
import { clampInt, useToolParams } from "../params";
import { Output } from "../ui";
import { uuidV4 } from "./uuid";

const generate = (count: number) => Array.from({ length: count }, uuidV4).join("\n");

export default function UuidTool() {
  const [params, setParams] = useToolParams({ anzahl: "5" });
  const count = clampInt(params.anzahl, 1, 100, 5);
  const [uuids, setUuids] = useState(() => generate(count));

  return (
    <div className="tool-body settings-form">
      <div className="tool-row">
        <label className="narrow">
          Anzahl
          <input
            type="number"
            min={1}
            max={100}
            value={count}
            onChange={(event) => {
              const next = clampInt(event.target.value, 1, 100, 1);
              setParams({ anzahl: String(next) });
              setUuids(generate(next));
            }}
          />
        </label>
        <button
          type="button"
          className="button button-primary"
          onClick={() => setUuids(generate(count))}
        >
          Neu erzeugen
        </button>
      </div>
      <Output value={uuids} label="UUIDs" />
    </div>
  );
}
