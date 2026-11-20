import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import type { Me } from "../../api";
import { NEWS_PATH } from "../../navigation";
import { clearRecent } from "../../navPrefs";
import { saveTheme, storedTheme, type ThemeChoice } from "../../theme";
import { roleLabel } from "../../user";
import { Avatar } from "../Avatar";
import { Icon, type IconName } from "../Icon";

export const ACCOUNT_PATH = "/konto";

const THEMES: { value: ThemeChoice; label: string; icon: IconName }[] = [
  { value: "hell", label: "Hell", icon: "hell" },
  { value: "dunkel", label: "Dunkel", icon: "dunkel" },
  { value: "auto", label: "Automatisch", icon: "auto" },
];

interface AccountMenuProps {
  me: Me;
  newsUnseen: boolean;
  onNavigate: (path: string) => void;
}

/**
 * Kontomenü oben rechts: Konto, Neuigkeiten, Darstellung, „Zuletzt besucht leeren“, Abmelden.
 * Bedienbar mit Tastatur (Pfeiltasten, Pos1/Ende, Esc schließt und gibt den Fokus zurück).
 */
export function AccountMenu({ me, newsUnseen, onNavigate }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState(storedTheme);
  const [cleared, setCleared] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const role = roleLabel(me.roles);

  const items = (): HTMLElement[] =>
    Array.from(menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);
  const show = () => {
    // Die Darstellung kann sich auch auf der Seite „Konto“ geändert haben.
    setTheme(storedTheme());
    setOpen(true);
  };
  const close = (refocus: boolean) => {
    setOpen(false);
    setCleared(false);
    if (refocus) {
      button.current?.focus();
    }
  };

  // Beim Öffnen steht der Fokus auf dem ersten Eintrag; ein Klick daneben schließt.
  useEffect(() => {
    if (!open) {
      return;
    }
    menu.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !wrap.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const index = list.findIndex((item) => item === document.activeElement);
    const move = (to: number) => {
      event.preventDefault();
      list[(to + list.length) % list.length]?.focus();
    };
    if (event.key === "ArrowDown") {
      move(index + 1);
    } else if (event.key === "ArrowUp") {
      move(index - 1);
    } else if (event.key === "Home") {
      move(0);
    } else if (event.key === "End") {
      move(list.length - 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "Tab") {
      close(false);
    }
  };
  const onButtonKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" && !open) {
      event.preventDefault();
      show();
    }
  };
  const go = (event: MouseEvent<HTMLAnchorElement>, path: string) => {
    event.preventDefault();
    close(false);
    onNavigate(path);
  };
  const choose = (value: ThemeChoice) => {
    saveTheme(value);
    setTheme(value);
  };

  return (
    <div className="account" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="account-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : show())}
        onKeyDown={onButtonKey}
      >
        <Avatar name={me.display_name} url={me.avatar_url} />
        <span className="visually-hidden">
          Konto und Einstellungen: {me.display_name}
          {newsUnseen ? ", neue Version" : ""}
        </span>
        {newsUnseen && <span className="account-dot" aria-hidden="true" />}
      </button>
      {open && (
        <div className="account-popup">
          <div className="account-head">
            <Avatar name={me.display_name} url={me.avatar_url} />
            <span className="account-who">
              <span className="account-name">{me.display_name}</span>
              {role && <span className="small">{role}</span>}
            </span>
          </div>
          <div
            ref={menu}
            id={menuId}
            role="menu"
            aria-label="Konto"
            className="account-menu"
            onKeyDown={onMenuKey}
          >
            <a
              role="menuitem"
              tabIndex={-1}
              href={ACCOUNT_PATH}
              onClick={(e) => go(e, ACCOUNT_PATH)}
            >
              <Icon name="konto" />
              <span>Konto</span>
            </a>
            <a role="menuitem" tabIndex={-1} href={NEWS_PATH} onClick={(e) => go(e, NEWS_PATH)}>
              <Icon name="neuigkeiten" />
              <span>Release Notes</span>
              {newsUnseen && " "}
              {newsUnseen && <span className="account-new">neu</span>}
            </a>
            <div role="separator" className="account-sep" />
            <div role="group" aria-label="Darstellung" className="account-themes">
              {THEMES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  tabIndex={-1}
                  aria-checked={theme === option.value}
                  onClick={() => choose(option.value)}
                >
                  <Icon name={option.icon} />
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
            <div role="separator" className="account-sep" />
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                void clearRecent();
                setCleared(true);
              }}
            >
              <Icon name="loeschen" />
              <span>{cleared ? "Zuletzt besucht geleert" : "Zuletzt besucht leeren"}</span>
            </button>
            <button type="submit" role="menuitem" tabIndex={-1} form="abmelden">
              <Icon name="abmelden" />
              <span>Abmelden</span>
            </button>
          </div>
        </div>
      )}
      <form id="abmelden" method="post" action="/auth/logout" hidden />
    </div>
  );
}
