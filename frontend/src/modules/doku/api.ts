import { deleteJson, getJson, postJson, putJson } from "../../api";
import { DOKU_ADMIN_PATH, DOKU_PATH } from "../../navigation";

export { DOKU_ADMIN_PATH, DOKU_PATH };

const BASE = "/api/doku";
const QUIET = { quiet: true };

export type SpaceRole = "read" | "edit" | "manage" | "none";
export type PageRole = "read" | "edit" | "none";

export const SPACE_ROLE_LABELS: Record<Exclude<SpaceRole, "none">, string> = {
  read: "Lesen",
  edit: "Bearbeiten",
  manage: "Verwalten",
};
export const PAGE_ROLE_LABELS: Record<PageRole, string> = {
  read: "Lesen",
  edit: "Bearbeiten",
  none: "Kein Zugriff",
};

/** Inhalt des Editors (ProseMirror-JSON). */
export type DocJson = Record<string, unknown>;

export interface SpaceRef {
  id: number;
  name: string;
  description: string;
  /** „none“: nicht Mitglied, nur einzelne Seiten mit eigenen Rechten */
  role: SpaceRole;
  archived: boolean;
}

export interface DokuMe {
  is_admin: boolean;
  spaces: SpaceRef[];
}

export interface TreePage {
  id: string;
  parent_id: string | null;
  title: string;
  position: number;
  own_rights: boolean;
  locked: boolean;
  can_edit: boolean;
}

export interface TreeSpace extends SpaceRef {
  pages: TreePage[];
}

export interface Crumb {
  id: string;
  title: string;
}

export interface DokuPageData {
  id: string;
  space_id: number;
  space: string;
  parent_id: string | null;
  path: Crumb[];
  title: string;
  content: DocJson;
  revision: number;
  role: "read" | "edit";
  can_manage_space: boolean;
  archived: boolean;
  locked: boolean;
  locked_by_name: string;
  locked_at: string | null;
  own_rights: boolean;
  rights_from: Crumb | null;
  created_by_name: string;
  created_at: string;
  updated_by_name: string;
  updated_at: string;
  versions: number;
}

export interface SearchHit {
  id: string;
  title: string;
  space: string;
  snippet: string;
}

export interface Version {
  id: number;
  created_at: string;
  name: string;
  authors: string;
  note: string;
}

export interface VersionDetail extends Version {
  title: string;
  content: DocJson;
}

export interface PersonRight {
  oid: string;
  name: string;
  role: string;
}

export interface Rights {
  own_rights: boolean;
  inherited_from: Crumb | null;
  entries: PersonRight[];
  space_members: PersonRight[];
  can_manage_space: boolean;
}

export interface Person {
  oid: string;
  name: string;
  upn: string;
  department: string;
}

export function pagePath(id: string): string {
  return `${DOKU_PATH}/seite/${id}`;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** Seite aus der Adresse, z. B. /doku/seite/<id>. */
export function parsePagePath(path: string): string | null {
  const match = new RegExp(`^${DOKU_PATH}/seite/(${UUID})$`).exec(path);
  return match ? (match[1] ?? null) : null;
}

export type AdminTab = "arbeitsbereiche" | "rechte" | "versionen" | "papierkorb";
export const ADMIN_TABS: readonly { id: AdminTab; label: string }[] = [
  { id: "arbeitsbereiche", label: "Arbeitsbereiche" },
  { id: "rechte", label: "Seiten mit eigenen Rechten" },
  { id: "versionen", label: "Versionen" },
  { id: "papierkorb", label: "Papierkorb" },
];

export function adminPath(tab: AdminTab): string {
  return tab === "arbeitsbereiche" ? DOKU_ADMIN_PATH : `${DOKU_ADMIN_PATH}/${tab}`;
}

export function parseAdminPath(path: string): AdminTab | null {
  if (path === DOKU_ADMIN_PATH) {
    return "arbeitsbereiche";
  }
  const tab = ADMIN_TABS.find((entry) => path === `${DOKU_ADMIN_PATH}/${entry.id}`);
  return tab ? tab.id : null;
}

/** Seitenbaum neu laden (Seitenmenü und Seite hören darauf). */
export const TREE_CHANGED = "werkbank:doku-baum";

export function notifyTreeChanged(): void {
  window.dispatchEvent(new Event(TREE_CHANGED));
}

export function fetchDokuMe(): Promise<DokuMe> {
  return getJson(`${BASE}/me`);
}

export function fetchTree(): Promise<TreeSpace[]> {
  return getJson(`${BASE}/tree`);
}

export function searchPages(q: string): Promise<SearchHit[]> {
  return getJson(`${BASE}/search?${new URLSearchParams({ q }).toString()}`);
}

export function fetchPage(id: string): Promise<DokuPageData> {
  return getJson(`${BASE}/pages/${id}`);
}

export function createPage(body: {
  space_id: number;
  parent_id: string | null;
  title: string;
}): Promise<DokuPageData> {
  return postJson(`${BASE}/pages`, body, QUIET);
}

export function savePage(
  id: string,
  body: { title: string; content: DocJson; revision: number },
): Promise<DokuPageData> {
  return putJson(`${BASE}/pages/${id}`, body, QUIET);
}

export function movePage(
  id: string,
  body: { parent_id: string | null; before_id: string | null },
): Promise<DokuPageData> {
  return postJson(`${BASE}/pages/${id}/move`, body, QUIET);
}

export function deletePage(id: string): Promise<{ ok: boolean }> {
  return deleteJson(`${BASE}/pages/${id}`, QUIET);
}

export function lockPage(id: string, locked: boolean): Promise<DokuPageData> {
  return locked
    ? postJson(`${BASE}/pages/${id}/lock`, {}, QUIET)
    : deleteJson(`${BASE}/pages/${id}/lock`, QUIET);
}

export function fetchVersions(id: string): Promise<Version[]> {
  return getJson(`${BASE}/pages/${id}/versions`);
}

export function fetchVersion(id: string, version: number): Promise<VersionDetail> {
  return getJson(`${BASE}/pages/${id}/versions/${version}`);
}

export function nameVersion(id: string, name: string): Promise<Version> {
  return postJson(`${BASE}/pages/${id}/versions`, { name }, QUIET);
}

export function restoreVersion(id: string, version: number, reason: string): Promise<DokuPageData> {
  return postJson(`${BASE}/pages/${id}/versions/${version}/restore`, { reason }, QUIET);
}

export function fetchRights(id: string): Promise<Rights> {
  return getJson(`${BASE}/pages/${id}/rights`);
}

export function saveRights(
  id: string,
  body: { own_rights: boolean; entries: PersonRight[] },
): Promise<Rights> {
  return putJson(`${BASE}/pages/${id}/rights`, body, QUIET);
}

export function saveMembers(spaceId: number, members: PersonRight[]): Promise<PersonRight[]> {
  return putJson(`${BASE}/spaces/${spaceId}/members`, { members }, QUIET);
}

export function searchPeople(q: string): Promise<Person[]> {
  return getJson(`${BASE}/people?${new URLSearchParams({ q }).toString()}`);
}

// --- Verwaltung ---------------------------------------------------------------------------

export interface AdminSpace {
  id: number;
  name: string;
  description: string;
  archived: boolean;
  people: number;
  pages: number;
  own_rights: number;
  updated_at: string;
  members: PersonRight[];
}

export interface SpaceInput {
  name: string;
  description: string;
  archived: boolean;
  members: PersonRight[];
}

export interface OwnRightsPage {
  id: string;
  title: string;
  space: string;
  summary: string;
  changed_by_name: string;
  changed_at: string | null;
}

export interface TrashItem {
  id: string;
  title: string;
  space: string;
  pages: number;
  deleted_by_name: string;
  deleted_at: string;
  purge_at: string;
}

export interface DokuSettings {
  version_minutes: 5 | 10 | 30;
  keep_auto: "1y" | "immer";
}

const ADMIN = `${BASE}/admin`;

export function fetchAdminSpaces(): Promise<AdminSpace[]> {
  return getJson(`${ADMIN}/spaces`);
}

export function createSpace(body: SpaceInput): Promise<AdminSpace> {
  return postJson(`${ADMIN}/spaces`, body, QUIET);
}

export function updateSpace(id: number, body: SpaceInput): Promise<AdminSpace> {
  return putJson(`${ADMIN}/spaces/${id}`, body, QUIET);
}

export function deleteSpace(id: number): Promise<{ ok: boolean }> {
  return deleteJson(`${ADMIN}/spaces/${id}`, QUIET);
}

export function fetchOwnRights(): Promise<OwnRightsPage[]> {
  return getJson(`${ADMIN}/own-rights`);
}

export function resetRights(id: string): Promise<{ ok: boolean }> {
  return postJson(`${ADMIN}/pages/${id}/reset-rights`, {}, QUIET);
}

export function fetchDokuSettings(): Promise<DokuSettings> {
  return getJson(`${ADMIN}/settings`);
}

export function saveDokuSettings(body: DokuSettings): Promise<DokuSettings> {
  return putJson(`${ADMIN}/settings`, body, QUIET);
}

export function fetchTrash(): Promise<TrashItem[]> {
  return getJson(`${ADMIN}/trash`);
}

export function restoreTrash(id: string): Promise<{ ok: boolean }> {
  return postJson(`${ADMIN}/trash/${id}/restore`, {}, QUIET);
}

export function purgeTrash(id: string): Promise<{ ok: boolean }> {
  return deleteJson(`${ADMIN}/trash/${id}`, QUIET);
}

/** Seiten eines Arbeitsbereichs als Baum (Kinder nach Reihenfolge). */
export interface PageNode extends TreePage {
  children: PageNode[];
}

export function buildTree(pages: TreePage[]): PageNode[] {
  const nodes = new Map<string, PageNode>(pages.map((p) => [p.id, { ...p, children: [] }]));
  const roots: PageNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parent_id ? nodes.get(node.parent_id) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  const sort = (list: PageNode[]) => {
    list.sort((a, b) => a.position - b.position || a.title.localeCompare(b.title, "de"));
    list.forEach((node) => sort(node.children));
  };
  sort(roots);
  return roots;
}
