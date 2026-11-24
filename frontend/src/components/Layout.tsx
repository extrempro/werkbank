import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { fetchTasks, TASKS_CHANGED, type Me, type Task } from "../api";
import {
  activeNavPath,
  allNavItems,
  areaForPath,
  type NavArea,
  ADMIN_CONNECTIONS_PATH,
  ADMIN_ZABBIX_PATH,
  ADMIN_MAIL_PATH,
  ADMIN_PATH,
  ADMIN_PERMISSIONS_PATH,
  areasFor,
  AUDIT_PATH,
  TICKETS_NEW_PATH,
  TICKETS_PATH,
  DOKU_ADMIN_PATH,
  DOKU_PATH,
  TICKETS_SETTINGS_PATH,
  TICKETS_OVERVIEW_PATH,
  BUDGET_ACCOUNTS_PATH,
  BUDGET_IMPORT_PATH,
  BUDGET_CONTRACTS_PATH,
  BUDGET_INVOICES_PATH,
  BUDGET_PLANNING_PATH,
  BUDGET_STATISTICS_PATH,
  BUDGET_ITEMS_PATH,
  BUDGET_PARTNERS_PATH,
  BUDGET_PATH,
  BUDGET_SETTINGS_PATH,
  CREDENTIALS_PATH,
  HEALTH_PATH,
  MONITORING_DNS_PATH,
  MONITORING_ZABBIX_HOSTS_PATH,
  MONITORING_ZABBIX_MAINTENANCE_PATH,
  MONITORING_ZABBIX_PATH,
  MONITORING_ZABBIX_REPORTS_PATH,
  PROJECTS_PATH,
  INVENTORY_CASES_PATH,
  INVENTORY_LOANS_PATH,
  INVENTORY_STATISTICS_PATH,
  INVENTORY_HARDWARE_PATH,
  INVENTORY_LOCATIONS_PATH,
  INVENTORY_MASTER_PATH,
  INVENTORY_POSITIONS_PATH,
  INVENTORY_WORKPLACES_PATH,
  LICENSES_PATH,
  NEWS_PATH,
  toolCategoryPath,
  TOOLS_HISTORY_PATH,
  USERS_PATH,
  USAGE_PATH,
  DEVICE_ASSOCIATION_PATH,
  TICKETS_MEMBER,
} from "../navigation";
import { AccountPage } from "../pages/AccountPage";
import { AdminPage } from "../pages/AdminPage";
import { AuditPage } from "../pages/AuditPage";
import { NewsPage } from "../pages/NewsPage";
import { NotificationsPage } from "../pages/NotificationsPage";
import { HandbookPage } from "../pages/HandbookPage";
import { DeviceAssociationPage } from "../modules/devices/DeviceAssociationPage";
import { DnsCheckPage } from "../modules/monitoring/DnsCheckPage";
import {
  ZabbixConnectionPage,
  ZabbixHostsPage,
  ZabbixMaintenancesPage,
  ZabbixOverviewPage,
} from "../modules/monitoring/zabbix/ZabbixPages";
import { ZabbixReportsPage } from "../modules/monitoring/zabbix/ZabbixReports";
import {
  parseCasePath,
  parseLoanPath,
  parseHardwarePath,
  parseLocationPath,
  parsePositionPath,
  parseWorkplacePath,
} from "../modules/inventory/api";
import { HardwareDetailPage } from "../modules/inventory/HardwareDetailPage";
import { HardwarePage } from "../modules/inventory/HardwarePage";
import { CasesPage } from "../modules/inventory/CasesPage";
import { parseTicketPath } from "../modules/tickets/api";
import { NewTicketPage } from "../modules/tickets/NewTicketPage";
import { TicketBar } from "../modules/tickets/TicketBar";
import { TicketPage } from "../modules/tickets/TicketPage";
import { parseSettingsPath, TicketSettingsPage } from "../modules/tickets/TicketSettingsPage";
import { TicketsPage } from "../modules/tickets/TicketsPage";
import { TicketsOverviewPage } from "../modules/tickets/TicketsOverviewPage";
import { ticketNavRoles, useTicketAccess } from "../modules/tickets/useTicketAccess";
import { LoansPage } from "../modules/inventory/LoansPage";
import { InventoryStatisticsPage } from "../modules/inventory/StatisticsPage";
import { LocationsPage } from "../modules/inventory/LocationsPage";
import { PositionDetailPage, PositionsPage } from "../modules/inventory/PositionsPage";
import { WorkplaceDetailPage, WorkplacesPage } from "../modules/inventory/WorkplacesPage";
import { MasterDataPage } from "../modules/inventory/MasterDataPage";
import { parseProjectPath } from "../modules/projects/api";
import { ProjectPage } from "../modules/projects/ProjectPage";
import { ProjectsPage } from "../modules/projects/ProjectsPage";
import {
  areasFor as areasForHandbook,
  findTopic,
  HANDBOOK_PATH,
  parseHandbookPath,
} from "../handbook";
import { HandbookMenu } from "./nav/HandbookMenu";
import { DokuAdminPage } from "../modules/doku/DokuAdminPage";
import { DokuMenu } from "../modules/doku/DokuMenu";
import {
  parseAdminPath as parseDokuAdminPath,
  parsePagePath as parseDokuPagePath,
} from "../modules/doku/api";
import { NOTIFICATIONS_PATH } from "../notifications";
import { useMediaQuery } from "./FilterBar";
import { HelpProvider, topicLink } from "../help/HelpContext";
import { pageTopics } from "../help/terms";
import { NotificationBell } from "./NotificationBell";
import { NotFoundPage } from "../pages/NotFoundPage";
import { SEARCH_PATH, SearchPage } from "../pages/SearchPage";
import { PlaceholderPage } from "../pages/PlaceholderPage";
import { StartPage } from "../pages/StartPage";
import { parseEvergreenPath } from "../modules/evergreen/api";
import { EntriesPage } from "../modules/evergreen/EntriesPage";
import { ChangesPage } from "../modules/m365/ChangesPage";
import { OverviewPage } from "../modules/m365/OverviewPage";
import { RecommendationsPage } from "../modules/m365/RecommendationsPage";
import { SettingsPage } from "../modules/m365/SettingsPage";
import { SnapshotsPage } from "../modules/m365/SnapshotsPage";
import { hasUnseenRelease } from "../release-notes";
import { AccountsPage } from "../modules/budget/AccountsPage";
import { BudgetOverviewPage } from "../modules/budget/BudgetOverviewPage";
import { BudgetSettingsPage } from "../modules/budget/BudgetSettingsPage";
import { ImportDetailPage } from "../modules/budget/ImportDetailPage";
import { ImportsPage } from "../modules/budget/ImportsPage";
import { ContractsPage } from "../modules/budget/ContractsPage";
import { InvoicesPage } from "../modules/budget/InvoicesPage";
import { ItemsPage as BudgetItemsPage } from "../modules/budget/ItemsPage";
import { PartnerDetailPage } from "../modules/budget/PartnerDetailPage";
import { PlanningPage } from "../modules/budget/PlanningPage";
import { StatisticsPage } from "../modules/budget/StatisticsPage";
import { PartnersPage } from "../modules/budget/PartnersPage";
import { CredentialsPage } from "../modules/tenant/CredentialsPage";
import { HealthPage } from "../modules/tenant/HealthPage";
import { LicensesPage } from "../modules/tenant/LicensesPage";
import { UsagePage } from "../modules/tenant/UsagePage";
import { UsersPage } from "../modules/tenant/UsersPage";
import { CATEGORY_LABELS, findTool, type ToolCategory } from "../tools";
import { ToolPage, TOOLS_PATH, ToolsOverviewPage } from "../tools/ToolsPage";
import { ToolsHistoryPage } from "../tools/ToolsHistoryPage";
import { navigate, usePath } from "../router";
import { headerLogo, useBranding } from "../branding";
import { BrandMark } from "./Brand";
import { Icon } from "./Icon";
import { ScrollTop } from "./ScrollTop";
import { loadNavPrefs, recordVisit } from "../navPrefs";
import { AccountMenu, ACCOUNT_PATH } from "./nav/AccountMenu";
import { AreaBar } from "./nav/AreaBar";
import { MobileNav } from "./nav/MobileNav";
import { QuickSearch } from "./nav/QuickSearch";
import { SideMenu } from "./nav/SideMenu";
import { TitlePin } from "./nav/TitlePin";
import { useStickyPanes } from "./stickyPanes";

const SETTINGS_PATH = "/m365/einstellungen";
const RECOMMENDATIONS_PATH = "/m365/empfehlungen";
/** Seitenmenü eingeklappt oder offen (in diesem Browser gemerkt). */
const NAV_KEY = "werkbank-navigation";

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(NAV_KEY) === "eingeklappt";
  } catch {
    return false;
  }
}

function saveCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(NAV_KEY, collapsed ? "eingeklappt" : "offen");
  } catch {
    // Speicher gesperrt: Die Wahl gilt dann nur bis zum Neuladen.
  }
}

/** Auf dem Mac ⌘K, sonst Strg+K. */
function shortcutLabel(): string {
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘K" : "Strg K";
}

interface LayoutProps {
  me: Me;
}

/** Breite, in der Seiten mit Liste und Ansicht das Seitenmenü einklappen (design.md). */
const LIST_VIEW_QUERY = "(min-width: 761px) and (max-width: 1199px)";

/** Seite mit dem Muster „Liste und Ansicht“: Kennung der Seite (ohne gewählten Eintrag). */
// Editor der Dokumentation (Tiptap) nur laden, wenn eine Doku-Seite offen ist
const DokuPageView = lazy(() =>
  import("../modules/doku/DokuPage").then((module) => ({ default: module.DokuPageView })),
);
const DokuStartPage = lazy(() =>
  import("../modules/doku/DokuPage").then((module) => ({ default: module.DokuStartPage })),
);

export function listViewPage(path: string): string | null {
  const evergreen = parseEvergreenPath(path);
  if (evergreen) {
    return `/evergreen/${evergreen.software}`;
  }
  return parseLoanPath(path) ? INVENTORY_LOANS_PATH : null;
}

/** Abstand, in dem die Aufgaben für die Zähler nachgeladen werden. */
const TASK_REFRESH_MS = 5 * 60 * 1000;

export function Layout({ me }: LayoutProps) {
  const path = usePath();
  // Ansichten rechts neben Listen laufen mit der Seite mit, ohne eigenen Scrollbalken.
  useStickyPanes();
  const branding = useBranding();
  const logoUrl = headerLogo(branding);
  const sideMenuId = useId();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [newsUnseen, setNewsUnseen] = useState(hasUnseenRelease);
  const [stored, setCollapsed] = useState(readCollapsed);
  // Liste und Ansicht unter 1200 px: Seitenmenü eingeklappt, bis es jemand auf dieser Seite
  // wieder aufklappt (gilt nur für diesen Besuch, nicht im Browser gemerkt).
  const midWidth = useMediaQuery(LIST_VIEW_QUERY);
  const listView = listViewPage(path);
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const collapsed = stored || (midWidth && listView !== null && openedOn !== listView);
  const [searchOpen, setSearchOpen] = useState(false);
  const closeSearch = useCallback(() => setSearchOpen(false), []);
  const onNewsSeen = useCallback(() => setNewsUnseen(false), []);
  const taskCount = (tasks ?? []).reduce((sum, task) => sum + task.count, 0);
  // Tickets: Rechte je Bereich kommen vom Server, nicht aus den App-Rollen
  const ticketAccess = useTicketAccess();
  const navRoles = useMemo(
    () => [...me.roles, ...ticketNavRoles(ticketAccess)],
    [me.roles, ticketAccess],
  );

  // Aufgaben neu laden: bei jedem Seitenwechsel, nach jeder Änderung (z. B. Rechnung gebucht),
  // wenn das Fenster wieder in den Vordergrund kommt und alle fünf Minuten. So stehen in der
  // Navigation keine Zähler mehr, deren Aufgaben schon erledigt sind.
  useEffect(() => {
    let active = true;
    let round = 0;
    const reload = () => {
      const mine = ++round;
      fetchTasks().then((result) => {
        // Nur die jüngste Antwort zählt; eine ältere kann den neuen Stand nicht überschreiben.
        if (active && mine === round) {
          setTasks(result);
        }
      });
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        reload();
      }
    };
    reload();
    window.addEventListener(TASKS_CHANGED, reload);
    document.addEventListener("visibilitychange", onVisible);
    // Installierte App am Handy: Beim Zurückkommen meldet nicht jedes Gerät „visibilitychange“.
    window.addEventListener("pageshow", reload);
    window.addEventListener("focus", reload);
    const timer = window.setInterval(reload, TASK_REFRESH_MS);
    return () => {
      active = false;
      window.removeEventListener(TASKS_CHANGED, reload);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", reload);
      window.removeEventListener("focus", reload);
      window.clearInterval(timer);
    };
  }, [path]);
  // Angeheftete und zuletzt besuchte Seiten einmal laden.
  useEffect(() => {
    void loadNavPrefs();
  }, []);
  // Strg+K / ⌘K öffnet die Schnellsuche.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Zähler in der Navigation: Aufgaben, die auf genau diese Seite führen; bei „Start“ alle.
  const badgeFor = (target: string): number =>
    target === "/"
      ? taskCount
      : (tasks ?? [])
          .filter((task) => task.link === target)
          .reduce((sum, task) => sum + task.count, 0);
  // Geprüft wird gegen alle Seiten; angezeigt werden nur die des gewählten Bereichs.
  const areas = areasFor(navRoles);
  const items = allNavItems(areas.flatMap((area) => area.groups));
  const currentArea = areaForPath(areas, path);
  // Punkt in der Bereichsleiste: Es gibt Aufgaben auf einer Seite des Bereichs (nicht bei Start).
  const hasOpen = (area: NavArea): boolean =>
    area.id !== "werkbank" && allNavItems(area.groups).some((item) => badgeFor(item.path) > 0);
  const current = items.find((item) => item.path === path);
  const pin = current && path !== "/" ? { path: current.path, label: current.label } : null;
  const helpLink = topicLink(pageTopics(path), navRoles);

  const go = (target: string) => {
    navigate(target);
    document.getElementById("inhalt")?.focus();
  };
  const onNavClick = (event: MouseEvent<HTMLAnchorElement>, target: string) => {
    event.preventDefault();
    go(target);
  };
  const setMenu = (next: boolean, target: string = path) => {
    setCollapsed(next);
    saveCollapsed(next);
    setOpenedOn(next ? null : listViewPage(target));
  };
  // Ein Bereich in der Leiste öffnet seine erste Seite; ein eingeklapptes Menü geht wieder auf.
  // Ist das Menü zu und der Bereich schon offen, klappt nur das Menü auf.
  const onArea = (event: MouseEvent<HTMLAnchorElement>, area: NavArea) => {
    event.preventDefault();
    const reopenOnly = collapsed && area.id === currentArea?.id;
    if (collapsed) {
      setMenu(false, reopenOnly ? path : area.home);
    }
    if (!reopenOnly) {
      go(area.home);
    }
  };
  const onTasks = () => {
    go("/");
    window.setTimeout(() => document.getElementById("aufgaben")?.focus(), 0);
  };

  // Besuchte Seiten der Navigation merken (Start selbst nicht).
  const visited = current && path !== "/" ? path : null;
  useEffect(() => {
    if (visited) {
      void recordVisit(visited);
    }
  }, [visited]);

  const settingMatch = /^\/m365\/einstellungen\/(\d{1,9})$/.exec(path);
  const settingId = settingMatch ? Number(settingMatch[1]) : null;

  const recommendationMatch = /^\/m365\/empfehlungen\/(\d{1,9})$/.exec(path);
  const recommendationId = recommendationMatch ? Number(recommendationMatch[1]) : null;

  const evergreenRoute = parseEvergreenPath(path);
  const evergreenAllowed =
    evergreenRoute !== null &&
    items.some((item) => item.path === `/evergreen/${evergreenRoute.software}`);

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
  const navPath = activeNavPath(items, openTool ? toolCategoryPath(openTool.category) : path);

  const partnerMatch = /^\/budget\/partner\/(\d{1,9})$/.exec(path);
  const partnerId = partnerMatch ? Number(partnerMatch[1]) : null;
  const contractMatch = /^\/budget\/vertraege\/(\d{1,9})$/.exec(path);
  const importMatch = /^\/budget\/import\/(\d{1,9})$/.exec(path);
  const importId = importMatch ? Number(importMatch[1]) : null;
  const contractId = contractMatch ? Number(contractMatch[1]) : null;
  const budgetItemMatch = /^\/budget\/posten\/(\d{1,9})$/.exec(path);
  const budgetItemId = budgetItemMatch ? Number(budgetItemMatch[1]) : null;
  const invoiceMatch = /^\/budget\/rechnungen\/(\d{1,9})$/.exec(path);
  const invoiceId = invoiceMatch ? Number(invoiceMatch[1]) : null;

  const projectRoute = parseProjectPath(path);
  const hardwareRoute = parseHardwarePath(path);
  const locationRoute = parseLocationPath(path);
  const positionRoute = parsePositionPath(path);
  const caseRoute = parseCasePath(path);
  const ticketRoute = parseTicketPath(path);
  // Leiste „Favoriten“ und „Geöffnet“ nur für Personen mit Rechten in einem Ticket-Bereich
  const ticketBarFor = (
    area: NavArea,
    variant: "side" | "sheet",
    navigateTo: (event: MouseEvent<HTMLAnchorElement>, target: string) => void,
  ) =>
    area.id === "tickets" && navRoles.includes(TICKETS_MEMBER) ? (
      <TicketBar activeNumber={ticketRoute} variant={variant} onNavigate={navigateTo} />
    ) : null;
  const settingsTab = parseSettingsPath(path);
  const zabbixHost = parseZabbixHostPath(path);
  const loanRoute = parseLoanPath(path);
  const workplaceRoute = parseWorkplacePath(path);

  const licenseMatch = /^\/m365\/lizenzen\/(\d{1,9})$/.exec(path);
  const licenseId = licenseMatch ? Number(licenseMatch[1]) : null;

  const handbookRoute = parseHandbookPath(path);
  const dokuPage = parseDokuPagePath(path);
  const dokuAdmin = parseDokuAdminPath(path);
  const dokuAllowed = items.some((item) => item.path === DOKU_PATH);
  const dokuAdminAllowed = items.some((item) => item.path === DOKU_ADMIN_PATH);
  const handbookKnown =
    handbookRoute !== null &&
    (handbookRoute.area === null ||
      (handbookRoute.topic === null
        ? areasForHandbook(navRoles).some((area) => area.id === handbookRoute.area)
        : findTopic(navRoles, handbookRoute.area, handbookRoute.topic) !== null));

  let page: ReactNode;
  if (path === "/") {
    page = <StartPage me={me} tasks={tasks} />;
  } else if (path === ACCOUNT_PATH) {
    page = <AccountPage me={me} tickets={navRoles.includes(TICKETS_MEMBER)} />;
  } else if (path === SEARCH_PATH) {
    page = <SearchPage roles={me.roles} />;
  } else if (path === NEWS_PATH) {
    page = <NewsPage onSeen={onNewsSeen} />;
  } else if (path === NOTIFICATIONS_PATH) {
    page = <NotificationsPage />;
  } else if (handbookKnown && handbookRoute) {
    page = (
      <HandbookPage
        key={path}
        roles={me.roles}
        areaId={handbookRoute.area}
        topicId={handbookRoute.topic}
      />
    );
  } else if (path === AUDIT_PATH && current) {
    page = <AuditPage />;
  } else if (path === ADMIN_PATH && current) {
    page = <AdminPage key="allgemein" section="allgemein" />;
  } else if (path === ADMIN_PERMISSIONS_PATH && current) {
    page = <AdminPage key="berechtigungen" section="berechtigungen" />;
  } else if (path === ADMIN_MAIL_PATH && current) {
    page = <AdminPage key="mail-teams" section="mail-teams" />;
  } else if (path === ADMIN_CONNECTIONS_PATH && current) {
    page = <AdminPage key="verbindungen" section="verbindungen" />;
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
  } else if (path === HEALTH_PATH && current) {
    page = <HealthPage />;
  } else if (path === USAGE_PATH && current) {
    page = <UsagePage />;
  } else if (path === DEVICE_ASSOCIATION_PATH && current) {
    page = <DeviceAssociationPage />;
  } else if (path === PROJECTS_PATH && current) {
    page = <ProjectsPage roles={me.roles} />;
  } else if (projectRoute !== null && items.some((item) => item.path === PROJECTS_PATH)) {
    page = (
      <ProjectPage
        key={projectRoute.id}
        projectId={projectRoute.id}
        tab={projectRoute.tab}
        roles={me.roles}
      />
    );
  } else if (path === INVENTORY_HARDWARE_PATH && current) {
    page = <HardwarePage roles={me.roles} />;
  } else if (
    hardwareRoute !== null &&
    items.some((item) => item.path === INVENTORY_HARDWARE_PATH)
  ) {
    page = (
      <HardwareDetailPage
        key={hardwareRoute.id}
        hardwareId={hardwareRoute.id}
        tab={hardwareRoute.tab}
        roles={me.roles}
      />
    );
  } else if (
    locationRoute !== null &&
    items.some((item) => item.path === INVENTORY_LOCATIONS_PATH)
  ) {
    page = (
      <LocationsPage
        floorId={locationRoute.floorId}
        roomId={locationRoute.roomId}
        node={locationRoute.node ?? null}
        roles={me.roles}
      />
    );
  } else if (caseRoute !== null && items.some((item) => item.path === INVENTORY_CASES_PATH)) {
    page = <CasesPage caseId={caseRoute.id} roles={me.roles} />;
  } else if (loanRoute !== null && items.some((item) => item.path === INVENTORY_LOANS_PATH)) {
    page = <LoansPage loanId={loanRoute.id} roles={me.roles} />;
  } else if (path === INVENTORY_STATISTICS_PATH && current) {
    page = <InventoryStatisticsPage />;
  } else if (path === INVENTORY_POSITIONS_PATH && current) {
    page = <PositionsPage roles={me.roles} />;
  } else if (
    positionRoute !== null &&
    items.some((item) => item.path === INVENTORY_POSITIONS_PATH)
  ) {
    page = (
      <PositionDetailPage
        key={positionRoute.id}
        positionId={positionRoute.id}
        tab={positionRoute.tab}
        roles={me.roles}
      />
    );
  } else if (path === INVENTORY_WORKPLACES_PATH && current) {
    page = <WorkplacesPage roles={me.roles} />;
  } else if (
    workplaceRoute !== null &&
    items.some((item) => item.path === INVENTORY_WORKPLACES_PATH)
  ) {
    page = (
      <WorkplaceDetailPage
        key={workplaceRoute.id}
        workplaceId={workplaceRoute.id}
        tab={workplaceRoute.tab}
        roles={me.roles}
      />
    );
  } else if (path === INVENTORY_MASTER_PATH && current) {
    page = <MasterDataPage roles={me.roles} />;
  } else if (path === MONITORING_DNS_PATH && current) {
    page = <DnsCheckPage isAdmin={me.roles.includes("Werkbank.Admin")} />;
  } else if (path === MONITORING_ZABBIX_PATH && current) {
    page = <ZabbixOverviewPage />;
  } else if (
    zabbixHost !== undefined &&
    items.some((item) => item.path === MONITORING_ZABBIX_HOSTS_PATH)
  ) {
    page = <ZabbixHostsPage hostId={zabbixHost} roles={me.roles} />;
  } else if (path === MONITORING_ZABBIX_MAINTENANCE_PATH && current) {
    page = <ZabbixMaintenancesPage />;
  } else if (path === MONITORING_ZABBIX_REPORTS_PATH && current) {
    page = <ZabbixReportsPage />;
  } else if (path === ADMIN_ZABBIX_PATH && current) {
    page = <ZabbixConnectionPage />;
  } else if (path === BUDGET_PATH && current) {
    page = <BudgetOverviewPage roles={me.roles} />;
  } else if (path === BUDGET_ACCOUNTS_PATH && current) {
    page = <AccountsPage roles={me.roles} />;
  } else if (path === BUDGET_ITEMS_PATH && current) {
    page = <BudgetItemsPage roles={me.roles} />;
  } else if (budgetItemId !== null && items.some((item) => item.path === BUDGET_ITEMS_PATH)) {
    page = <BudgetItemsPage roles={me.roles} selectedId={budgetItemId} />;
  } else if (path === BUDGET_CONTRACTS_PATH && current) {
    page = <ContractsPage roles={me.roles} />;
  } else if (contractId !== null && items.some((item) => item.path === BUDGET_CONTRACTS_PATH)) {
    page = <ContractsPage roles={me.roles} selectedId={contractId} />;
  } else if (path === BUDGET_PLANNING_PATH && current) {
    page = <PlanningPage />;
  } else if (path === BUDGET_STATISTICS_PATH && current) {
    page = <StatisticsPage roles={me.roles} />;
  } else if (path === BUDGET_INVOICES_PATH && current) {
    page = <InvoicesPage roles={me.roles} />;
  } else if (invoiceId !== null && items.some((item) => item.path === BUDGET_INVOICES_PATH)) {
    page = <InvoicesPage roles={me.roles} selectedId={invoiceId} />;
  } else if (partnerId !== null && items.some((item) => item.path === BUDGET_PARTNERS_PATH)) {
    page = <PartnerDetailPage key={partnerId} roles={me.roles} partnerId={partnerId} />;
  } else if (path === BUDGET_PARTNERS_PATH && current) {
    page = <PartnersPage roles={me.roles} />;
  } else if (path === BUDGET_IMPORT_PATH && current) {
    page = <ImportsPage />;
  } else if (importId !== null && items.some((item) => item.path === BUDGET_IMPORT_PATH)) {
    page = <ImportDetailPage key={importId} importId={importId} />;
  } else if (path === BUDGET_SETTINGS_PATH && current) {
    page = <BudgetSettingsPage />;
  } else if (path === TOOLS_HISTORY_PATH && current) {
    page = <ToolsHistoryPage />;
  } else if (toolId !== null && toolsAllowed) {
    page = <ToolPage key={toolId} id={toolId} />;
  } else if (evergreenRoute !== null && evergreenAllowed) {
    page = (
      <EntriesPage
        software={evergreenRoute.software}
        entryId={evergreenRoute.entryId}
        roles={me.roles}
      />
    );
  } else if (
    ticketAccess === undefined &&
    (path === TICKETS_PATH || path.startsWith(`${TICKETS_PATH}/`))
  ) {
    page = (
      <p className="page-message" role="status">
        Wird geladen …
      </p>
    );
  } else if (ticketRoute !== null && items.some((item) => item.path === TICKETS_PATH)) {
    page = <TicketPage key={ticketRoute} number={ticketRoute} />;
  } else if (path === TICKETS_PATH && current && ticketAccess) {
    page = <TicketsPage access={ticketAccess} />;
  } else if (path === TICKETS_NEW_PATH && current && ticketAccess) {
    page = <NewTicketPage access={ticketAccess} />;
  } else if (settingsTab !== null && items.some((item) => item.path === TICKETS_SETTINGS_PATH)) {
    page = <TicketSettingsPage key={settingsTab} tab={settingsTab} />;
  } else if (path === TICKETS_OVERVIEW_PATH && current && ticketAccess) {
    page = <TicketsOverviewPage access={ticketAccess} />;
  } else if (path === DOKU_PATH && current) {
    page = (
      <Suspense fallback={<p role="status">Wird geladen …</p>}>
        <DokuStartPage />
      </Suspense>
    );
  } else if (dokuPage !== null && dokuAllowed) {
    page = (
      <Suspense fallback={<p role="status">Wird geladen …</p>}>
        <DokuPageView key={dokuPage} pageId={dokuPage} />
      </Suspense>
    );
  } else if (dokuAdmin !== null && dokuAdminAllowed) {
    page = <DokuAdminPage tab={dokuAdmin} />;
  } else if (current) {
    page = <PlaceholderPage title={current.label} />;
  } else {
    page = <NotFoundPage />;
  }

  return (
    <HelpProvider roles={navRoles}>
      <div className={collapsed ? "app nav-collapsed" : "app"}>
        <a className="skip-link" href="#inhalt">
          Zum Inhalt springen
        </a>
        <header className="app-header">
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
          <button
            type="button"
            className="header-search"
            aria-haspopup="dialog"
            aria-expanded={searchOpen}
            aria-keyshortcuts="Control+K Meta+K"
            onClick={() => setSearchOpen(true)}
          >
            <Icon name="suche" />
            <span className="header-search-text">Seite suchen</span>
            <kbd aria-hidden="true">{shortcutLabel()}</kbd>
          </button>
          <div className="user">
            <NotificationBell path={path} />
            <a
              className="header-tasks"
              href="/"
              aria-label={taskCount > 0 ? `Meine Aufgaben: ${taskCount} offen` : "Meine Aufgaben"}
              onClick={(event) => {
                event.preventDefault();
                onTasks();
              }}
            >
              <Icon name="aufgaben" />
              {taskCount > 0 && (
                <span className="header-tasks-count" aria-hidden="true">
                  {taskCount}
                </span>
              )}
            </a>
            <AccountMenu me={me} newsUnseen={newsUnseen} onNavigate={go} />
          </div>
        </header>
        <div className="app-body">
          <div className="app-nav">
            <AreaBar
              areas={areas}
              currentId={handbookRoute ? undefined : currentArea?.id}
              hasOpen={hasOpen}
              handbookOpen={path.startsWith(HANDBOOK_PATH)}
              collapsed={collapsed}
              sideMenuId={sideMenuId}
              onArea={onArea}
              onHandbook={(event) => onNavClick(event, HANDBOOK_PATH)}
              onExpand={() => setMenu(false)}
            />
            {handbookRoute && (
              <HandbookMenu
                id={sideMenuId}
                roles={navRoles}
                areaId={handbookRoute.area}
                topicId={handbookRoute.topic}
                hidden={collapsed}
                onNavigate={onNavClick}
                onCollapse={() => setMenu(true)}
              />
            )}
            {currentArea?.id === "doku" && !handbookRoute && (
              <DokuMenu
                id={sideMenuId}
                pageId={dokuPage}
                adminOpen={dokuAdmin !== null}
                hidden={collapsed}
                onNavigate={onNavClick}
                onCollapse={() => setMenu(true)}
              />
            )}
            {currentArea && currentArea.id !== "doku" && !handbookRoute && (
              <SideMenu
                id={sideMenuId}
                area={currentArea}
                areas={areas}
                activePath={navPath}
                hidden={collapsed}
                badgeFor={badgeFor}
                onNavigate={onNavClick}
                onCollapse={() => setMenu(true)}
                extra={ticketBarFor(currentArea, "side", onNavClick)}
              />
            )}
          </div>
          <main id="inhalt" className="app-main" tabIndex={-1}>
            {page}
            {(pin || helpLink) && (
              <TitlePin containerId="inhalt" path={path} pin={pin} help={helpLink} />
            )}
          </main>
        </div>
        <MobileNav
          areas={areas}
          current={currentArea}
          activePath={navPath}
          taskCount={taskCount}
          searchOpen={searchOpen}
          hasOpen={hasOpen}
          badgeFor={badgeFor}
          onNavigate={go}
          onSearch={() => setSearchOpen(true)}
          onTasks={onTasks}
          extraFor={(area, navigateTo) => ticketBarFor(area, "sheet", navigateTo)}
        />
        {searchOpen && <QuickSearch areas={areas} onClose={closeSearch} onNavigate={go} />}
        <ScrollTop />
      </div>
    </HelpProvider>
  );
}

/** /monitoring/zabbix/hosts → null (Liste), /monitoring/zabbix/hosts/123 → "123". */
function parseZabbixHostPath(path: string): string | null | undefined {
  if (path === MONITORING_ZABBIX_HOSTS_PATH) {
    return null;
  }
  const match = /^\/monitoring\/zabbix\/hosts\/(\d{1,20})$/.exec(path);
  return match ? match[1]! : undefined;
}
