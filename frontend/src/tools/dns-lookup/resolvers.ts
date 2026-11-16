/**
 * DNS-Resolver der Werkbank: feste öffentliche Resolver, abgefragt über den Server
 * (DNS über HTTPS, RFC 8484). Eigene Resolver gibt es nicht, damit der Server nur feste Ziele
 * aufruft. Gleichzeitige Abfragen an denselben Resolver gehen gebündelt an den Server.
 */
import { fromBase64, netPost } from "../lib/net";
import type { DnsResult } from "./doh";
import { parseResponse } from "./wire";

export interface Resolver {
  id: string;
  name: string;
  /** Adresse des Resolvers, nur zur Anzeige und im Export */
  url: string;
}

export const builtInResolvers: Resolver[] = [
  { id: "cloudflare", name: "Cloudflare (1.1.1.1)", url: "https://cloudflare-dns.com/dns-query" },
  { id: "google", name: "Google (8.8.8.8)", url: "https://dns.google/dns-query" },
  { id: "quad9", name: "Quad9 (9.9.9.9)", url: "https://dns.quad9.net/dns-query" },
];

const rcodes: Record<number, string> = {
  0: "NOERROR",
  1: "FORMERR",
  2: "SERVFAIL",
  3: "NXDOMAIN",
  4: "NOTIMP",
  5: "REFUSED",
};

export interface ResolverResult extends DnsResult {
  /** Antwortzeit beim Server in Millisekunden */
  ms: number;
}

interface ServerAnswer {
  name: string;
  type: string;
  wire: string | null;
  ms: number | null;
  error: string | null;
}

/** Höchstzahl Abfragen je Anfrage an den Server */
const BATCH_MAX = 20;

interface Pending {
  name: string;
  type: string;
  resolve: (result: ResolverResult) => void;
  reject: (error: Error) => void;
}

const queues = new Map<string, Pending[]>();

function toResult(qname: string, answer: ServerAnswer): ResolverResult {
  if (answer.wire === null) {
    throw new Error(answer.error ?? "Keine Antwort");
  }
  const wire = parseResponse(fromBase64(answer.wire));
  return {
    query: qname,
    status: rcodes[wire.rcode] ?? `RCODE ${wire.rcode}`,
    authenticated: wire.authenticated,
    answers: wire.answers.map((entry) => ({ ...entry, name: entry.name.replace(/\.$/, "") })),
    ms: answer.ms ?? 0,
  };
}

function flush(resolverId: string): void {
  const pending = queues.get(resolverId) ?? [];
  queues.delete(resolverId);
  for (let start = 0; start < pending.length; start += BATCH_MAX) {
    const batch = pending.slice(start, start + BATCH_MAX);
    netPost<ServerAnswer[]>("/dns", {
      resolver: resolverId,
      queries: batch.map((entry) => ({ name: entry.name, type: entry.type })),
    }).then(
      (answers) =>
        batch.forEach((entry, index) => {
          const answer = answers[index];
          try {
            if (!answer) {
              throw new Error("Keine Antwort");
            }
            entry.resolve(toResult(entry.name, answer));
          } catch (error) {
            entry.reject(error as Error);
          }
        }),
      (error: unknown) => batch.forEach((entry) => entry.reject(error as Error)),
    );
  }
}

export function queryResolver(
  resolver: Resolver,
  name: string,
  type: string,
  signal?: AbortSignal,
): Promise<ResolverResult> {
  const qname = name.trim().replace(/\.$/, "").toLowerCase();
  if (signal?.aborted) {
    return Promise.reject(new DOMException("Abgebrochen", "AbortError"));
  }
  return new Promise<ResolverResult>((resolve, reject) => {
    const queue = queues.get(resolver.id);
    const entry: Pending = { name: qname, type: type.toUpperCase(), resolve, reject };
    if (queue) {
      queue.push(entry);
    } else {
      queues.set(resolver.id, [entry]);
      // Alles, was im selben Durchlauf angefragt wird, geht gemeinsam zum Server.
      queueMicrotask(() => flush(resolver.id));
    }
    signal?.addEventListener("abort", () => reject(new DOMException("Abgebrochen", "AbortError")), {
      once: true,
    });
  });
}
