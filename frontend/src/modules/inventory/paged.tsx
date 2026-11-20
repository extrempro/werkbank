import { useEffect, useId, useRef, useState } from "react";
import { errorText } from "../../api";
import { PAGE_SIZE } from "./api";

/** Wert erst übernehmen, wenn eine Weile nichts mehr getippt wurde. */
export function useDebounced<T>(value: T, delay = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

export interface Page<T, S> {
  items: T[];
  total: number;
  /** Zusatzangaben der ersten Seite, z. B. Zähler für die Filter */
  extra: S;
}

export interface PagedList<T, S> {
  items: T[] | null;
  total: number;
  extra: S | null;
  error: string | null;
  loadingMore: boolean;
  more: () => void;
}

/**
 * Liste seitenweise laden. Ändert sich ``key`` (Filter, Suche), beginnt sie von vorn;
 * ändert sich ``reload``, lädt sie so viele Einträge neu, wie schon zu sehen waren.
 */
export function usePagedList<T, S>(
  key: string,
  reload: number,
  load: (offset: number, limit: number) => Promise<Page<T, S>>,
  failText: string,
): PagedList<T, S> {
  const [state, setState] = useState<{
    key: string;
    items: T[];
    total: number;
    extra: S;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  const shown = useRef(0);
  const lastKey = useRef(key);

  useEffect(() => {
    let active = true;
    const sameKey = lastKey.current === key;
    lastKey.current = key;
    const limit = sameKey ? Math.max(PAGE_SIZE, Math.min(shown.current, 200)) : PAGE_SIZE;
    loadRef.current(0, limit).then(
      (page) => {
        if (active) {
          setError(null);
          setState({ key, items: page.items, total: page.total, extra: page.extra });
        }
      },
      (problem: unknown) => active && setError(errorText(problem, failText)),
    );
    return () => {
      active = false;
    };
  }, [key, reload, failText]);

  useEffect(() => {
    shown.current = state ? state.items.length : 0;
  }, [state]);

  const current = state && state.key === key ? state : null;
  const more = () => {
    if (!current || loadingMore) {
      return;
    }
    setLoadingMore(true);
    loadRef.current(current.items.length, PAGE_SIZE).then(
      (page) => {
        setState((previous) => {
          if (!previous || previous.key !== key) {
            return previous;
          }
          const known = new Set(previous.items.map((item) => JSON.stringify(item)));
          const items = [
            ...previous.items,
            ...page.items.filter((item) => !known.has(JSON.stringify(item))),
          ];
          return { ...previous, items, total: page.total };
        });
        setLoadingMore(false);
      },
      (problem: unknown) => {
        setError(errorText(problem, failText));
        setLoadingMore(false);
      },
    );
  };

  return {
    items: current ? current.items : null,
    total: current ? current.total : 0,
    extra: current ? current.extra : null,
    error,
    loadingMore,
    more,
  };
}

/** Suchfeld über einer Liste; die Suche läuft auf dem Server. */
export function ListSearch({
  value,
  onChange,
  label,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
}) {
  const id = useId();
  return (
    <div className="list-search">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="search"
        value={value}
        maxLength={100}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

/** „50 von 312“ und „Mehr anzeigen“ unter einer Liste. */
export function MoreButton({
  shown,
  total,
  loading,
  onMore,
}: {
  shown: number;
  total: number;
  loading: boolean;
  onMore: () => void;
}) {
  if (total === 0) {
    return null;
  }
  return (
    <div className="list-more">
      <p className="small" role="status">
        {shown} von {total}
      </p>
      {shown < total && (
        <button
          type="button"
          className="button button-secondary"
          onClick={onMore}
          disabled={loading}
        >
          {loading ? "Wird geladen …" : "Mehr anzeigen"}
        </button>
      )}
    </div>
  );
}
