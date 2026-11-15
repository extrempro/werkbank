import { useState } from "react";
import { InfoTable } from "../ui";
import { conversions } from "./case";

export default function CaseTool() {
  // Der Text bleibt nur auf dieser Seite.
  const [text, setText] = useState("");
  return (
    <div className="tool-body settings-form">
      <label>
        Eingabe
        <textarea
          rows={4}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Mein Server Name"
        />
      </label>
      {text && (
        <InfoTable
          caption="Schreibweisen"
          rows={conversions.map((conversion) => {
            const output = conversion.fn(text);
            return { label: conversion.label, value: output, copy: output };
          })}
        />
      )}
    </div>
  );
}
