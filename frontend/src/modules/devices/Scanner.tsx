// Kamera-Scanner nach der Vorlage AutopilotQR
// (https://github.com/Simsen/AutopilotQR, MIT-Lizenz, Copyright (c) 2026 Simon Eriksen).
// Lizenztext: THIRD_PARTY_NOTICES.md.
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Icon } from "../../components/Icon";
import { looksLikeDeviceLink } from "./api";
import { decodeQr } from "./decode";

type Camera = "startet" | "laeuft" | "verweigert" | "keine";

interface ScannerProps {
  /** Ein QR-Code aus der Windows-Einrichtung wurde erkannt. */
  onCode: (text: string) => void;
}

/**
 * Laufender Scan mit der Rückkamera, dazu „Foto auswählen“ als Ausweg (z. B. ohne
 * Kamerafreigabe). Der QR-Code der Einrichtung ist dicht, daher hohe Auflösung und ein
 * quadratischer Ausschnitt aus der Bildmitte. Fremde QR-Codes übergeht der Scanner still.
 */
export function Scanner({ onCode }: ScannerProps) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [camera, setCamera] = useState<Camera>("startet");
  const [busy, setBusy] = useState(false);
  const [photoHint, setPhotoHint] = useState("");
  const done = useRef(false);
  const onCodeRef = useRef(onCode);
  useEffect(() => {
    onCodeRef.current = onCode;
  }, [onCode]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: number | undefined;

    const found = (text: string) => {
      if (!done.current && looksLikeDeviceLink(text)) {
        done.current = true;
        onCodeRef.current(text.trim());
      }
    };

    const loop = async () => {
      if (stopped || done.current) {
        return;
      }
      const view = video.current;
      const area = canvas.current;
      if (view && area && view.videoWidth > 0) {
        const side = Math.min(view.videoWidth, view.videoHeight);
        area.width = side;
        area.height = side;
        const context = area.getContext("2d", { willReadFrequently: true });
        if (context) {
          context.drawImage(
            view,
            (view.videoWidth - side) / 2,
            (view.videoHeight - side) / 2,
            side,
            side,
            0,
            0,
            side,
            side,
          );
          try {
            const text = await decodeQr(context.getImageData(0, 0, side, side));
            if (text) {
              found(text);
            }
          } catch {
            // Aussetzer im Decoder: weiter scannen
          }
        }
      }
      timer = window.setTimeout(() => void loop(), 200);
    };

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCamera("keine");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });
      } catch (error) {
        setCamera(
          error instanceof DOMException && error.name === "NotAllowedError"
            ? "verweigert"
            : "keine",
        );
        return;
      }
      if (stopped || !video.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      video.current.srcObject = stream;
      await video.current.play().catch(() => undefined);
      setCamera("laeuft");
      void loop();
    };

    void start();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const onPhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    setBusy(true);
    setPhotoHint("");
    try {
      const text = await decodeQr(file);
      if (text && looksLikeDeviceLink(text)) {
        done.current = true;
        onCode(text.trim());
      } else {
        setPhotoHint(
          "Auf dem Foto ist kein QR-Code aus der Einrichtung zu erkennen. Bitte näher heran und ohne Spiegelung.",
        );
      }
    } catch {
      setPhotoHint("Das Foto ließ sich nicht lesen.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dev-scanner">
      <div className="dev-viewport">
        <video ref={video} playsInline muted aria-label="Kamerabild" />
        <div className="dev-guide" aria-hidden="true" />
        {camera !== "laeuft" && (
          <p className="dev-overlay" role="status">
            {camera === "startet" && "Kamera wird gestartet …"}
            {camera === "verweigert" &&
              "Die Kamera ist nicht freigegeben. Erlaube sie in den Einstellungen des Browsers oder wähle ein Foto aus."}
            {camera === "keine" && "Keine Kamera verfügbar. Wähle ein Foto des QR-Codes aus."}
          </p>
        )}
      </div>
      <canvas ref={canvas} hidden />
      <p className="small dev-scan-hint">
        <Icon name="info" /> Am neuen Gerät in der Einrichtung (Regionsauswahl) fünfmal die
        Windows-Taste drücken und „Scan QR code“ wählen. QR-Code ins Feld halten, ohne Spiegelung.
      </p>
      <label className="button button-secondary dev-photo">
        <Icon name="kamera" /> {busy ? "Foto wird gelesen …" : "Foto auswählen"}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="visually-hidden"
          onChange={(event) => void onPhoto(event)}
          disabled={busy}
        />
      </label>
      {photoHint && (
        <p role="alert" className="hint-box hint-warn">
          {photoHint}
        </p>
      )}
    </div>
  );
}
