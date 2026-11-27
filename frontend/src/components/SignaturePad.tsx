import { useEffect, useRef, useState, type PointerEvent } from "react";

/**
 * Feld zum Unterschreiben mit Finger, Stift oder Maus. Meldet die Unterschrift als PNG
 * (Base64 ohne „data:“-Präfix) oder null, wenn das Feld leer ist. Für Tastatur und
 * Screenreader bietet die Seite daneben eine Alternative an (z. B. den Namen eintippen).
 */
export function SignaturePad({
  label,
  onChange,
}: {
  label: string;
  onChange: (png: string | null) => void;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const element = canvas.current;
    if (!element) {
      return;
    }
    // Schärfe auf hochauflösenden Bildschirmen, aber höchstens doppelte Größe (Dateigröße)
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    const rect = element.getBoundingClientRect();
    element.width = Math.max(1, Math.round(rect.width * scale));
    element.height = Math.max(1, Math.round(rect.height * scale));
    const context = element.getContext("2d");
    if (context) {
      context.scale(scale, scale);
      context.lineWidth = 2.5;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.strokeStyle = "#163f8f";
    }
  }, []);

  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const start = (event: PointerEvent<HTMLCanvasElement>) => {
    const context = event.currentTarget.getContext("2d");
    if (!context) {
      return;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drawing.current = true;
    const { x, y } = point(event);
    context.beginPath();
    context.moveTo(x, y);
  };

  const move = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) {
      return;
    }
    const context = event.currentTarget.getContext("2d");
    if (!context) {
      return;
    }
    const { x, y } = point(event);
    context.lineTo(x, y);
    context.stroke();
  };

  const end = () => {
    if (!drawing.current) {
      return;
    }
    drawing.current = false;
    setEmpty(false);
    const data = canvas.current?.toDataURL("image/png") ?? "";
    onChange(data.startsWith("data:image/png;base64,") ? (data.split(",", 2)[1] ?? null) : null);
  };

  const clear = () => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (element && context) {
      context.save();
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, element.width, element.height);
      context.restore();
    }
    setEmpty(true);
    onChange(null);
  };

  return (
    <div className="signature">
      <span className="field-label">{label}</span>
      <canvas
        ref={canvas}
        className="signature-pad"
        role="img"
        aria-label={empty ? `${label}: noch leer` : `${label}: unterschrieben`}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        onPointerCancel={end}
      />
      <div className="signature-foot">
        <span className="small">Mit dem Finger, Stift oder der Maus unterschreiben.</span>
        <button type="button" className="button button-secondary" onClick={clear} disabled={empty}>
          Neu beginnen
        </button>
      </div>
    </div>
  );
}
