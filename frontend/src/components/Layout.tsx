import {
  useCallback,
  useEffect,
  useId,
  useState,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { fetchTasks, type Me, type Task } from "../api";
import {
  allNavItems,
  areaForPath,
  areasFor,
  BUDGET_ACCOUNTS_PATH,
  BUDGET_PATH,
  BUDGET_SETTINGS_PATH,
  CREDENTIALS_PATH,
  LICENSES_PATH,
  NEWS_PATH,
  toolCategoryPath,
  USERS_PATH,
} from "../navigation";
import { AccountPage } from "../pages/AccountPage";
import { AdminPage } from "../pages/AdminPage";
import { AuditPage } from "../pages/AuditPage";
import { NewsPage } from "../pages/NewsPage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { SEARCH_PATH, SearchPage, searchUrl } from "../pages/SearchPage";
import { PlaceholderPage } from "../pages/PlaceholderPage";
import { StartPage } from "../pages/StartPage";
import { InboxPage } from "../modules/evergreen/InboxPage";
import { ItemsPage } from "../modules/evergreen/ItemsPage";
import { ChangesPage } from "../modules/m365/ChangesPage";
import { OverviewPage } from "../modules/m365/OverviewPage";
import { RecommendationsPage } from "../modules/m365/RecommendationsPage";
import { SettingsPage } from "../modules/m365/SettingsPage";
import { SnapshotsPage } from "../modules/m365/SnapshotsPage";
import { hasUnseenRelease } from "../release-notes";
import { AccountsPage } from "../modules/budget/AccountsPage";
import { BudgetOverviewPage } from "../modules/budget/BudgetOverviewPage";
import { BudgetSettingsPage } from "../modules/budget/BudgetSettingsPage";
import { CredentialsPage } from "../modules/tenant/CredentialsPage";
import { LicensesPage } from "../modules/tenant/LicensesPage";
import { UsersPage } from "../modules/tenant/UsersPage";
import { CATEGORY_LABELS, findTool, type ToolCategory } from "../tools";
import { ToolPage, TOOLS_PATH, ToolsOverviewPage } from "../tools/ToolsPage";
import { currentTheme, saveTheme } from "../theme";
import { navigate, usePath } from "../router";
import { headerLogo, useBranding } from "../branding";
import { Avatar } from "./Avatar";
import { BrandMark } from "./Brand";
import { Icon } from "./Icon";
import { ScrollTop } from "./ScrollTop";
import { roleLabel } from "../user";

const SETTINGS_PATH = "/m365/einstellungen";
const RECOMMENDATIONS_PATH = "/m365/empfehlungen";
const NAV_KEY = "werkbank-navigation";

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(NAV_KEY) === "eingeklappt";
  } catch {
    return false;
  }
}
const ACCOUNT_PATH = "/konto";

interface LayoutProps {
  me: Me;
}

export function Layout({ me }: LayoutProps) {
  const path = usePath();
  const branding = useBranding();
  const logoUrl = headerLogo(branding);
  const [menuOpen, setMenuOpen] = useState(false);
  const navId = useId();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [newsUnseen, setNewsUnseen] = useState(hasUnseenRelease);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [theme, setTheme] = useState(currentTheme);
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
  // Die Darstellung kann auch auf der Seite „Konto“ oder am Gerät wechseln.
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(currentTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  const role = roleLabel(me.roles);
  const navClass = ["app-nav", menuOpen ? "open" : "", collapsed ? "collapsed" : ""]
    .filter(Boolean)
    .join(" ");
  const onToggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      window.localStorage.setItem(NAV_KEY, next ? "eingeklappt" : "offen");
    } catch {
      // Speicher gesperrt: Die Wahl gilt dann nur bis zum Neuladen.
    }
  };
  const onToggleTheme = () => {
    const next = currentTheme() === "dunkel" ? "hell" : "dunkel";
    saveTheme(next);
    setTheme(next);
  };
  const onSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const field = event.currentTarget.elements.namedItem("q");
    const query = field instanceof HTMLInputElement ? field.value.trim() : "";
    if (query.length >= 2) {
      navigate(searchUrl(query));
      if (field instanceof HTMLInputElement) {
        field.value = "";
      }
    }
  };
  // Zähler in der Navigation: Aufgaben, die auf genau diese Seite führen; bei „Start“ alle.
  const badgeFor = (target: string): number =>
    target === "/"
      ? taskCount
      : (tasks ?? [])
          .filter((task) => task.link === target)
          .reduce((sum, task) => sum + task.count, 0);
  // Geprüft wird gegen alle Seiten; angezeigt werden nur die des gewählten Bereichs.
  const areas = areasFor(me.roles);
  const items = allNavItems(areas.flatMap((area) => area.groups));
  const currentArea = areaForPath(areas, path);
  const groups = currentArea?.groups ?? [];
  const areaBadge = (areaId: string): number =>
    areaId === "werkbank"
      ? 0
      : allNavItems(areas.find((area) => area.id === areaId)?.groups ?? []).reduce(
          (sum, item) => sum + badgeFor(item.path),
          0,
        );
  const current = items.find((item) => item.path === path);

  const onNavClick = (event: MouseEvent<HTMLAnchorElement>, target: string) => {
    event.preventDefault();
    setMenuOpen(false);
    navigate(target);
    document.getElementById("inhalt")?.focus();
  };

  const settingMatch = /^\/m365\/einstellungen\/(\d{1,9})$/.exec(path);
  const settingId = settingMatch ? Number(settingMatch[1]) : null;

  const recommendationMatch = /^\/m365\/empfehlungen\/(\d{1,9})$/.exec(path);
  const recommendationId = recommendationMatch ? Number(recommendationMatch[1]) : null;

  const itemMatch = /^\/evergreen\/(\d{1,9})$/.exec(path);
  const itemId = itemMatch ? Number(itemMatch[1]) : null;

  const toolMatch = /^\/it-tools\/([a-z0-9-]{1,40})$/.exec(path);
  const toolId = toolMatch ? (toolMatch[1] ?? null) : null;
  const toolsAllowed = items.some((item) => item.path === TOOLS_PATH);
  const categoryMatch = /^\/it-tools\/kategorie\/([a-z]{1,20})$/.exec(path);
  const toolCategory =
    categoryMatch && categoryMatch[1] && categoryMatch[1] in CATEGORY_LABELS
      ? (categoryMatch[1] as ToolCategory)
      : null;
  // Auf der Seite eines Tools ist in der Navigation seine Kategorie hervorgehoben.
  const openTool = toolId !== null ? findTool(toolId) : undefined;
  const navPath = openTool ? toolCategoryPath(openTool.category) : path;

  const licenseMatch = /^\/m365\/lizenzen\/(\d{1,9})$/.exec(path);
  const licenseId = licenseMatch ? Number(licenseMatch[1]) : null;

  let page: ReactNode;
  if (path === "/") {
    page = <StartPage me={me} tasks={tasks} />;
  } else if (path === ACCOUNT_PATH) {
    page = <AccountPage me={me} />;
  } else if (path === SEARCH_PATH) {
    page = <SearchPage roles={me.roles} />;
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
    page = <SettingsPage me={me} />;
  } else if (path === RECOMMENDATIONS_PATH && current) {
    page = <RecommendationsPage me={me} />;
  } else if (
    recommendationId !== null &&
    items.some((item) => item.path === RECOMMENDATIONS_PATH)
  ) {
    page = <RecommendationsPage me={me} selectedId={recommendationId} />;
  } else if (path === "/m365/snapshots" && current) {
    page = <SnapshotsPage />;
  } else if (settingId !== null && items.some((item) => item.path === SETTINGS_PATH)) {
    page = <SettingsPage me={me} selectedId={settingId} />;
  } else if (path === TOOLS_PATH && current) {
    page = <ToolsOverviewPage />;
  } else if (toolCategory !== null && current) {
    page = <ToolsOverviewPage key={toolCategory} category={toolCategory} />;
  } else if (path === LICENSES_PATH && current) {
    page = <LicensesPage />;
  } else if (licenseId !== null && items.some((item) => item.path === LICENSES_PATH)) {
    page = <LicensesPage selectedId={licenseId} />;
  } else if (path === USERS_PATH && current) {
    page = <UsersPage />;
  } else if (path === CREDENTIALS_PATH && current) {
    page = <CredentialsPage />;
  } else if (path === BUDGET_PATH && current) {
    page = <BudgetOverviewPage roles={me.roles} />;
  } else if (path === BUDGET_ACCOUNTS_PATH && current) {
    page = <AccountsPage roles={me.roles} />;
  } else if (path === BUDGET_SETTINGS_PATH && current) {
    page = <BudgetSettingsPage />;
  } else if (toolId !== null && toolsAllowed) {
    page = <ToolPage key={toolId} id={toolId} />;
  } else if (path === "/evergreen" && current) {
    page = <ItemsPage />;
  } else if (path === "/evergreen/eingang" && current) {
    page = <InboxPage />;
  } else if (itemId !== null && items.some((item) => item.path === "/evergreen")) {
    page = <ItemsPage selectedId={itemId} />;
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
          <BrandMark logoUrl={logoUrl} />
          {logoUrl && !branding.show_name ? (
            <span className="visually-hidden">{branding.app_name}</span>
          ) : (
            <span className="brand-text">
              <span className="brand-name">{branding.app_name}</span>
              <span className="brand-sub">IT-Plattform</span>
            </span>
          )}
        </a>
        <form className="header-search" role="search" onSubmit={onSearch}>
          <label htmlFor="kopf-suche" className="visually-hidden">
            Suchen
          </label>
          <input
            id="kopf-suche"
            type="search"
            name="q"
            maxLength={100}
            autoComplete="off"
            placeholder="Suchen in Einstellungen, Vorgängen, Änderungen …"
          />
        </form>
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
          <a
            className="user-pill"
            href={ACCOUNT_PATH}
            aria-current={path === ACCOUNT_PATH ? "page" : undefined}
            onClick={(event) => onNavClick(event, ACCOUNT_PATH)}
          >
            <Avatar name={me.display_name} url={me.avatar_url} />
            <span className="user-text">
              <span className="user-name">{me.display_name}</span>
              {role && <span className="user-role">{role}</span>}
            </span>
            <span className="visually-hidden"> – Konto öffnen</span>
          </a>
          <form method="post" action="/auth/logout">
            <button type="submit" className="button button-quiet">
              Abmelden
            </button>
          </form>
        </div>
      </header>
      <div className="app-body">
        <nav id={navId} className={navClass} aria-label="Hauptnavigation">
          {areas.length > 1 && (
            <ul className="nav-areas" aria-label="Bereiche">
              {areas.map((area) => (
                <li key={area.id}>
                  <a
                    href={area.home}
                    title={collapsed ? area.label : undefined}
                    aria-current={area.id === currentArea?.id ? "true" : undefined}
                    onClick={(event) => onNavClick(event, area.home)}
                  >
                    <Icon name={area.icon} />
                    <span className="nav-label">{area.label}</span>
                    {area.id !== currentArea?.id && areaBadge(area.id) > 0 && (
                      <span className="nav-count">
                        {areaBadge(area.id)}
                        <span className="visually-hidden"> offen</span>
                      </span>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          )}
          <div className="nav-items">
            {groups.map((group) => (
              <div className="nav-group" key={group.title ?? group.items[0]?.path ?? "start"}>
                {group.title && <p className="nav-title">{group.title}</p>}
                <ul>
                  {group.items.map((item) => (
                    <li key={item.path}>
                      <a
                        href={item.path}
                        title={collapsed ? item.label : undefined}
                        aria-current={item.path === navPath ? "page" : undefined}
                        onClick={(event) => onNavClick(event, item.path)}
                      >
                        <Icon name={item.icon} />
                        <span className="nav-label">{item.label}</span>
                        {badgeFor(item.path) > 0 && (
                          <span className="nav-count">
                            {badgeFor(item.path)}
                            <span className="visually-hidden">
                              {item.path === "/" ? " offene Aufgaben" : " offen"}
                            </span>
                          </span>
                        )}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="nav-foot">
            <a
              className="nav-tool"
              href={NEWS_PATH}
              title="Neuigkeiten"
              aria-current={path === NEWS_PATH ? "page" : undefined}
              onClick={(event) => onNavClick(event, NEWS_PATH)}
            >
              <Icon name="neuigkeiten" />
              <span className="visually-hidden">Neuigkeiten</span>
              {newsUnseen && (
                <span className="nav-dot">
                  <span className="visually-hidden"> – neue Version</span>
                </span>
              )}
            </a>
            <button
              type="button"
              className="nav-tool"
              title={theme === "dunkel" ? "Helle Darstellung" : "Dunkle Darstellung"}
              onClick={onToggleTheme}
            >
              <Icon name={theme === "dunkel" ? "hell" : "dunkel"} />
              <span className="visually-hidden">
                {theme === "dunkel"
                  ? "Helle Darstellung einschalten"
                  : "Dunkle Darstellung einschalten"}
              </span>
            </button>
            <button
              type="button"
              className="nav-tool nav-collapse"
              title={collapsed ? "Navigation ausklappen" : "Navigation einklappen"}
              aria-expanded={!collapsed}
              aria-controls={navId}
              onClick={onToggleCollapsed}
            >
              <Icon name={collapsed ? "ausklappen" : "einklappen"} />
              <span className="visually-hidden">
                {collapsed ? "Navigation ausklappen" : "Navigation einklappen"}
              </span>
            </button>
          </div>
        </nav>
        <main id="inhalt" className="app-main" tabIndex={-1}>
          {page}
        </main>
      </div>
      <ScrollTop />
    </div>
  );
}
