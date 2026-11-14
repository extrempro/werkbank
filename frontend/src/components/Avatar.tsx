import { useState } from "react";
import { initials } from "../user";

interface AvatarProps {
  name: string;
  /** Adresse des Profilbilds; ohne Bild erscheinen die Initialen. */
  url?: string | null;
  size?: "small" | "large";
}

/** Profilbild einer Person, sonst ihre Initialen. Rein schmückend: Der Name steht daneben. */
export function Avatar({ name, url, size = "small" }: AvatarProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const className = size === "large" ? "avatar avatar-large" : "avatar";
  if (url && failedUrl !== url) {
    return (
      <img
        className={className}
        src={url}
        alt=""
        decoding="async"
        onError={() => setFailedUrl(url)}
      />
    );
  }
  return (
    <span className={className} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
