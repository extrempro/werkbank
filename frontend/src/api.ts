export interface Me {
  display_name: string;
  email: string | null;
  roles: string[];
  authenticated_at: string;
}

/** Angemeldete Person laden. `null` bedeutet: nicht angemeldet. */
export async function fetchMe(): Promise<Me | null> {
  const response = await fetch("/api/me", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (response.status === 401) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Unerwartete Antwort: ${response.status}`);
  }
  return (await response.json()) as Me;
}
