import { useId, useState, type MouseEvent, type ReactNode } from "react";
import type { Me } from "../api";
import { allNavItems, navigationFor } from "../navigation";
import { AdminPage } from "../pages/AdminPage";
import { AuditPage } from "../pages/AuditPage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { PlaceholderPage } from "../pages/PlaceholderPage";
import { StartPage } from "../pages/StartPage";
import { navigate, usePath } from "../router";

interface LayoutProps {
  me: Me;
}

export function Layout({ me }: LayoutProps) {
  const path = usePath();
  const [menuOpen, setMenuOpen] = useState(false);
  const navId = useId();
  const groups = navigationFor(me.roles);
  const items = allNavItems(groups);
  const current = items.find((item) => item.path === path);

  const onNavClick = (event: MouseEvent<HTMLAnchorElement>, target: string) => {
    event.preventDefault();
    setMenuOpen(false);
    navigate(target);
    document.getElementById("inhalt")?.focus();
  };

  let page: ReactNode;
  if (path === "/") {
    page = <StartPage me={me} />;
  } else if (path === "/audit" && current) {
    page = <AuditPage />;
  } else if (path === "/verwaltung" && current) {
    page = <AdminPage />;
  } else if (current) {
    page = <PlaceholderPage title={current.label} />;
  } else {
    page = <NotFoundPage />;
  }

  return (
    <div className="app">
      <a className="skip-link" href="#inhalt">
        Zum Inhalt springen
      </a>
      <header className="app-header">
        <button
          type="button"
          className="menu-toggle"
          aria-expanded={menuOpen}
          aria-controls={navId}
          onClick={() => setMenuOpen((open) => !open)}
        >
          Menü
        </button>
        <a className="brand" href="/" onClick={(event) => onNavClick(event, "/")}>
          <span className="brand-mark" aria-hidden="true" />
          Werkbank
        </a>
        <div className="user">
          <span className="user-name">{me.display_name}</span>
          <form method="post" action="/auth/logout">
            <button type="submit" className="button button-quiet">
              Abmelden
            </button>
          </form>
        </div>
      </header>
      <div className="app-body">
        <nav
          id={navId}
          className={menuOpen ? "app-nav open" : "app-nav"}
          aria-label="Hauptnavigation"
        >
          {groups.map((group) => (
            <div className="nav-group" key={group.title ?? "start"}>
              {group.title && <p className="nav-title">{group.title}</p>}
              <ul>
                {group.items.map((item) => (
                  <li key={item.path}>
                    <a
                      href={item.path}
                      aria-current={item.path === path ? "page" : undefined}
                      onClick={(event) => onNavClick(event, item.path)}
                    >
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <main id="inhalt" className="app-main" tabIndex={-1}>
          {page}
        </main>
      </div>
    </div>
  );
}
