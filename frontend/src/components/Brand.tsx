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
        <rect x="3.6" y="2.4" width="16.8" height="1.4" rx="0.5" />
        <rect
          x="5.1"
          y="4.3"
          width="13.8"
          height="6.1"
          rx="0.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
        />
        <path
          d="M9.7 5.6v.7a.8.8 0 0 0 1.6 0v-.7M10.5 7.2v2"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.9"
          strokeLinecap="round"
        />
        <rect x="12.2" y="5.5" width="3.2" height="1.3" rx="0.3" />
        <rect x="13.35" y="6.6" width="0.9" height="2.7" rx="0.4" />
        <rect x="2.6" y="10.9" width="18.8" height="1.9" rx="0.6" />
        <rect x="4.2" y="12.8" width="1.5" height="8.2" />
        <rect x="18.3" y="12.8" width="1.5" height="8.2" />
        <rect
          x="6.8"
          y="14.6"
          width="4.8"
          height="3"
          rx="0.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.9"
        />
        <rect
          x="12.4"
          y="14.6"
          width="4.8"
          height="3"
          rx="0.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.9"
        />
      </svg>
    </span>
  );
}
