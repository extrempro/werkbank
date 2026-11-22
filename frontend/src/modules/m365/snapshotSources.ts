import type { Snapshot } from "./api";

/** Fehler mehrerer Ressourcentypen mit derselben Ursache. */
export interface SourceErrorGroup {
  /** Fehlende Berechtigungen laut Microsoft (eine davon genügt); leer, wenn unbekannt. */
  scopes: string[];
  /** Fehlertext, wenn keine fehlende Berechtigung erkannt wurde. */
  message: string | null;
  sources: string[];
}

export interface SourceSummary {
  complete: string[];
  failed: number;
  groups: SourceErrorGroup[];
}

const SCOPES = /must have one of the following scopes:\s*([A-Za-z0-9., ]+?)\s*(?:-|"|$)/;

/** Liest aus dem Fehlertext von UTCM, welche Berechtigung fehlt. */
export function missingScopes(message: string): string[] {
  const match = SCOPES.exec(message);
  if (!match) {
    return [];
  }
  return (match[1] ?? "")
    .split(",")
    .map((scope) => scope.trim())
    .filter((scope) => /^[A-Za-z][A-Za-z0-9.]*$/.test(scope));
}

/** Quellen eines Abrufs: vollständige und Fehler, gruppiert nach fehlender Berechtigung. */
export function summarizeSources(snapshot: Snapshot): SourceSummary {
  const complete: string[] = [];
  const groups = new Map<string, SourceErrorGroup>();
  let failed = 0;
  for (const [source, ok] of Object.entries(snapshot.source_status)) {
    if (ok) {
      complete.push(source);
      continue;
    }
    failed += 1;
    const raw = snapshot.source_errors?.[source];
    const message = typeof raw === "string" ? raw : "";
    const scopes = missingScopes(message);
    const key = scopes.length > 0 ? `scopes:${scopes.join(",")}` : `text:${message}`;
    const group = groups.get(key) ?? {
      scopes,
      message: scopes.length > 0 ? null : message || null,
      sources: [],
    };
    group.sources.push(source);
    groups.set(key, group);
  }
  return {
    complete: complete.sort(),
    failed,
    groups: [...groups.values()]
      .map((group) => ({ ...group, sources: group.sources.sort() }))
      .sort((a, b) => b.sources.length - a.sources.length),
  };
}
