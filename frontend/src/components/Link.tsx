import type { MouseEvent, ReactNode } from "react";
import { navigate } from "../router";

interface LinkProps {
  to: string;
  children: ReactNode;
  className?: string;
  "aria-current"?: "page";
  /** Tooltip, z. B. der ganze Name, wenn er gekürzt angezeigt wird */
  title?: string;
}

/** Verweis innerhalb der Werkbank ohne Neuladen der Seite. */
export function Link({ to, children, className, title, "aria-current": ariaCurrent }: LinkProps) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
    if (event.defaultPrevented || event.button !== 0 || modified) {
      return;
    }
    event.preventDefault();
    navigate(to);
    document.getElementById("inhalt")?.focus();
  };
  return (
    <a href={to} className={className} title={title} aria-current={ariaCurrent} onClick={onClick}>
      {children}
    </a>
  );
}
