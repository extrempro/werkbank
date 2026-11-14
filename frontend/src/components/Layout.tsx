import { useCallback, useEffect, useId, useState, type MouseEvent, type ReactNode } from "react";
import { fetchTasks, type Me, type Task } from "../api";
import { allNavItems, navigationFor, NEWS_PATH } from "../navigation";
import { AdminPage } from "../pages/AdminPage";
import { AuditPage } from "../pages/AuditPage";
import { NewsPage } from "../pages/NewsPage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { PlaceholderPage } from "../pages/PlaceholderPage";
import { StartPage } from "../pages/StartPage";
import { InboxPage } from "../modules/evergreen/InboxPage";
import { ItemDetailPage } from "../modules/evergreen/ItemDetailPage";
import { ItemsPage } from "../modules/evergreen/ItemsPage";
import { ChangesPage } from "../modules/m365/ChangesPage";
import { OverviewPage } from "../modules/m365/OverviewPage";
import { SettingDetailPage } from "../modules/m365/SettingDetailPage";
import { SettingsPage } from "../modules/m365/SettingsPage";
import { SnapshotsPage } from "../modules/m365/SnapshotsPage";
import { hasUnseenRelease } from "../release-notes";
import { navigate, usePath } from "../router";
import { ThemeSwitch } from "./ThemeSwitch";
import { initials, roleLabel } from "../user";

const SETTINGS_PATH = "/m365/einstellungen";

interface LayoutProps {
  me: Me;
}

export function Layout({ me }: LayoutProps) {
  const path = usePath();
  const [menuOpen, setMenuOpen] = useState(false);
  const navId = useId();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [newsUnseen, setNewsUnseen] = useState(hasUnseenRelease);
  const onNewsSeen = useCallback(() => setNewsUnseen(false), []);
  const taskCount = (tasks ?? []).reduce((sum, task) => sum + task.count, 0);

  // Aufgaben bei jedem Seitenwechsel neu laden, damit Zähler und Startseite aktuell sind.
  useEffect(() => {
    let active = true;
    fetchTasks().then((result) => {
      if (active) {
        setTasks(result);
      }
    });
    return () => {
      active = false;
    };
  }, [path]);
  const role = roleLabel(me.roles);
  // Zähler in der Navigation: Aufgaben, die auf genau diese Seite führen; bei „Start“ alle.
  const badgeFor = (target: string): number =>
    target === "/"
      ? taskCount
      : (tasks ?? [])
          .filter((task) => task.link === target)
          .reduce((sum, task) => sum + task.count, 0);
  const groups = navigationFor(me.roles);
  const items = allNavItems(groups);
  const current = items.find((item) => item.path === path);

  const onNavClick = (event: MouseEvent<HTMLAnchorElement>, target: string) => {
    event.preventDefault();
    setMenuOpen(false);
    navigate(target);
    document.getElementById("inhalt")?.focus();
  };

  const settingMatch = /^\/m365\/einstellungen\/(\d{1,9})$/.exec(path);
  const settingId = settingMatch ? Number(settingMatch[1]) : null;

  const itemMatch = /^\/evergreen\/(\d{1,9})$/.exec(path);
  const itemId = itemMatch ? Number(itemMatch[1]) : null;

  let page: ReactNode;
  if (path === "/") {
    page = <StartPage me={me} tasks={tasks} />;
  } else if (path === NEWS_PATH) {
    page = <NewsPage onSeen={onNewsSeen} />;
  } else if (path === "/audit" && current) {
    page = <AuditPage />;
  } else if (path === "/verwaltung" && current) {
    page = <AdminPage />;
  } else if (path === "/m365" && current) {
    page = <OverviewPage me={me} />;
  } else if (path === "/m365/aenderungen" && current) {
    page = <ChangesPage me={me} />;
  } else if (path === "/m365/einstellungen" && current) {
    page = <SettingsPage />;
  } else if (path === "/m365/snapshots" && current) {
    page = <SnapshotsPage />;
  } else if (settingId !== null && items.some((item) => item.path === SETTINGS_PATH)) {
    page = <SettingDetailPage id={settingId} me={me} />;
  } else if (path === "/evergreen" && current) {
    page = <ItemsPage />;
  } else if (path === "/evergreen/eingang" && current) {
    page = <InboxPage />;
  } else if (itemId !== null && items.some((item) => item.path === "/evergreen")) {
    page = <ItemDetailPage id={itemId} />;
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
          <span className="brand-mark" aria-hidden="true">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z" />
            </svg>
          </span>
          <span className="brand-text">
            <span className="brand-name">Werkbank</span>
            <span className="brand-sub">IT-Plattform</span>
          </span>
        </a>
        <div className="user">
          <a
            className="header-tasks"
            href="/"
            aria-label={taskCount > 0 ? `Meine Aufgaben: ${taskCount} offen` : "Meine Aufgaben"}
            onClick={(event) => onNavClick(event, "/")}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M22 12h-6l-2 3h-4l-2-3H2" />
              <path d="M5.5 5h13l3.5 7v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z" />
            </svg>
            {taskCount > 0 && (
              <span className="header-tasks-count" aria-hidden="true">
                {taskCount}
              </span>
            )}
          </a>
          <div className="user-pill">
            <span className="user-avatar" aria-hidden="true">
              {initials(me.display_name)}
            </span>
            <span className="user-text">
              <span className="user-name">{me.display_name}</span>
              {role && <span className="user-role">{role}</span>}
            </span>
          </div>
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
                      <span>{item.label}</span>
                      {badgeFor(item.path) > 0 && (
                        <span className="nav-count">
                          {badgeFor(item.path)}
                          <span className="visually-hidden">
                            {item.path === "/" ? " offene Aufgaben" : " offen"}
                          </span>
                        </span>
                      )}
                      {item.path === NEWS_PATH && newsUnseen && (
                        <span className="nav-new">neu</span>
                      )}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <ThemeSwitch />
        </nav>
        <main id="inhalt" className="app-main" tabIndex={-1}>
          {page}
        </main>
      </div>
    </div>
  );
}
