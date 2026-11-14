import type { MouseEvent, ReactNode } from "react";
import { navigate } from "../router";

interface LinkProps {
  to: string;
  children: ReactNode;
  className?: string;
}

/** Verweis innerhalb der Werkbank ohne Neuladen der Seite. */
export function Link({ to, children, className }: LinkProps) {
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
    <a href={to} className={className} onClick={onClick}>
      {children}
    </a>
  );
}
