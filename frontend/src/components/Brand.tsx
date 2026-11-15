import { useState } from "react";

interface BrandMarkProps {
  /** Adresse des eigenen Logos; ohne Logo erscheint das Zeichen der Werkbank. */
  logoUrl: string | null;
  size?: "small" | "large";
}

/** Logo aus der Verwaltung, sonst das Zeichen der Werkbank. Rein schmückend: Der Name steht daneben. */
export function BrandMark({ logoUrl, size = "small" }: BrandMarkProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const large = size === "large";
  if (logoUrl && failedUrl !== logoUrl) {
    return (
      <img
        className={large ? "brand-logo brand-logo-large" : "brand-logo"}
        src={logoUrl}
        alt=""
        onError={() => setFailedUrl(logoUrl)}
      />
    );
  }
  return (
    <span className={large ? "brand-mark brand-mark-large" : "brand-mark"} aria-hidden="true">
      <svg width={large ? 30 : 22} height={large ? 30 : 22} viewBox="0 0 24 24" fill="currentColor">
        <rect x="2" y="9.5" width="20" height="3.4" rx="1" />
        <rect x="4.4" y="12.9" width="2.8" height="8.1" rx="0.6" />
        <rect x="16.8" y="12.9" width="2.8" height="8.1" rx="0.6" />
        <rect x="7.2" y="16" width="9.6" height="2.2" />
        <rect x="13.2" y="4" width="2.4" height="5.5" rx="0.6" />
        <rect x="17.2" y="4" width="2.4" height="5.5" rx="0.6" />
        <rect x="19.6" y="5.6" width="2.6" height="1.6" rx="0.5" />
      </svg>
    </span>
  );
}
