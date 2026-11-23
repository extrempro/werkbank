import { useState } from "react";

/**
 * Lange, schon geladene Listen stückweise zeigen: erst ``step`` Einträge, mit
 * „Weitere anzeigen“ jeweils ``step`` mehr. Ändert sich ``resetKey`` (Suche, Filter),
 * beginnt die Liste wieder vorn.
 */
export function useShowMore(step: number, resetKey: string) {
  const [state, setState] = useState({ key: resetKey, limit: step });
  const limit = state.key === resetKey ? state.limit : step;
  return {
    limit,
    more: () => setState({ key: resetKey, limit: limit + step }),
    all: () => setState({ key: resetKey, limit: Number.MAX_SAFE_INTEGER }),
  };
}

/** „50 von 312“ mit „Weitere anzeigen“ und „Alle anzeigen“ unter einer Liste. */
export function ShowMore({
  shown,
  total,
  onMore,
  onAll,
}: {
  shown: number;
  total: number;
  onMore: () => void;
  onAll?: () => void;
}) {
  if (shown >= total) {
    return null;
  }
  return (
    <div className="list-more">
      <p className="small" role="status">
        {shown} von {total}
      </p>
      <button type="button" className="button button-secondary" onClick={onMore}>
        Weitere anzeigen
      </button>
      {onAll && (
        <button type="button" className="button button-secondary" onClick={onAll}>
          Alle anzeigen
        </button>
      )}
    </div>
  );
}
