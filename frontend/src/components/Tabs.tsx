import { useRef, type KeyboardEvent } from "react";

export interface TabItem<T extends string> {
  id: T;
  label: string;
}

/** Kennungen für Reiter und Inhalt, damit beide aufeinander verweisen. */
export function tabIds(prefix: string, id: string): { tab: string; panel: string } {
  return { tab: `${prefix}-tab-${id}`, panel: `${prefix}-panel-${id}` };
}

/**
 * Reiter in einer Ansicht (design.md): `role="tablist"`, Pfeiltasten wechseln, Pos1/Ende
 * springen; nur der gewählte Reiter ist in der Tab-Reihenfolge. Den Inhalt rendert die Seite
 * mit `role="tabpanel"` und den Kennungen aus `tabIds`.
 */
export function Tabs<T extends string>({
  label,
  prefix,
  tabs,
  value,
  onChange,
}: {
  label: string;
  prefix: string;
  tabs: readonly TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const move = (index: number) => {
    const next = tabs[(index + tabs.length) % tabs.length];
    if (!next) {
      return;
    }
    onChange(next.id);
    window.setTimeout(() => document.getElementById(tabIds(prefix, next.id).tab)?.focus(), 0);
  };
  const onKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const keys: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: tabs.length - 1,
    };
    const target = keys[event.key];
    if (target !== undefined) {
      event.preventDefault();
      move(target);
    }
  };
  return (
    <div className="tabs" role="tablist" aria-label={label} ref={list}>
      {tabs.map((tab, index) => {
        const ids = tabIds(prefix, tab.id);
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            id={ids.tab}
            type="button"
            role="tab"
            className="tab"
            aria-selected={selected}
            aria-controls={ids.panel}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => onKey(event, index)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
