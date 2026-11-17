import { ApiError, deleteJson, getJson, postJson, putJson } from "../../api";
import { PROJECTS_PATH } from "../../navigation";

export type ProjectStatus = "geplant" | "aktiv" | "pausiert" | "abgeschlossen";
export type PersonKind = "intern" | "extern";

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  geplant: "geplant",
  aktiv: "aktiv",
  pausiert: "pausiert",
  abgeschlossen: "abgeschlossen",
};

export const STATUS_PILLS: Record<ProjectStatus, string> = {
  geplant: "pill pill-todo",
  aktiv: "pill pill-ok",
  pausiert: "pill pill-neutral",
  abgeschlossen: "pill pill-neutral",
};

export const PROJECT_EDITOR_ROLE = "Projekte.Editor";

/** Die Reiter eines Projekts; der erste hat keinen eigenen Pfadteil. */
export type ProjectTab = "uebersicht" | "budget" | "jour-fixe" | "aufgaben" | "einstellungen";

export const TABS: { id: ProjectTab; label: string }[] = [
  { id: "uebersicht", label: "Übersicht" },
  { id: "budget", label: "Budget" },
  { id: "jour-fixe", label: "Jour Fixe" },
  { id: "aufgaben", label: "Aufgaben" },
  { id: "einstellungen", label: "Einstellungen" },
];

export function projectPath(id: number, tab: ProjectTab = "uebersicht"): string {
  return tab === "uebersicht" ? `${PROJECTS_PATH}/${id}` : `${PROJECTS_PATH}/${id}/${tab}`;
}

/** Projekt und Reiter aus dem Pfad, z. B. „/projekte/12/budget“; sonst null. */
export function parseProjectPath(path: string): { id: number; tab: ProjectTab } | null {
  const match = /^\/projekte\/(\d{1,9})(?:\/(budget|jour-fixe|aufgaben|einstellungen))?$/.exec(
    path,
  );
  if (!match) {
    return null;
  }
  return { id: Number(match[1]), tab: (match[2] as ProjectTab | undefined) ?? "uebersicht" };
}

export interface Person {
  name: string;
  role: string;
  kind: PersonKind;
  organisation: string;
  contact: string;
}

export interface ProjectLink {
  label: string;
  url: string;
}

export interface BudgetSums {
  /** Veranschlagt im Projekt; null: nicht hinterlegt. */
  budget_cents: number | null;
  /** Erwartete Kosten der Posten ohne gebuchte Rechnung. */
  planned_cents: number;
  /** Gebuchte Rechnungen der Posten. */
  actual_cents: number;
  /** Veranschlagt minus geplant minus Ist; null ohne veranschlagtes Budget. */
  remaining_cents: number | null;
  items: number;
}

export interface Task {
  id: number;
  text: string;
  owner: string;
  due_on: string | null;
  done: boolean;
  done_at: string | null;
}

export interface TaskUpdate {
  text: string;
  owner: string;
  due_on: string | null;
  done: boolean;
}

export interface MeetingFile {
  id: number;
  name: string;
  size: number;
}

export interface MeetingSummary {
  id: number;
  held_on: string;
  title: string;
  files: number;
  updated_at: string;
}

export interface Meeting {
  id: number;
  held_on: string;
  title: string;
  /** Protokoll in Markdown; wird nur als Text dargestellt. */
  body: string;
  files: MeetingFile[];
  created_at: string;
  updated_at: string;
}

export interface MeetingUpdate {
  held_on: string;
  title: string;
  body: string;
}

export interface ProjectSummary {
  id: number;
  name: string;
  description: string;
  status: ProjectStatus;
  starts_on: string | null;
  ends_on: string | null;
  budget: BudgetSums;
  open_tasks: number;
  last_meeting_on: string | null;
}

export interface Project {
  id: number;
  name: string;
  description: string;
  status: ProjectStatus;
  starts_on: string | null;
  ends_on: string | null;
  budget_approved_on: string | null;
  budget_note: string;
  budget: BudgetSums;
  people: Person[];
  links: ProjectLink[];
  open_tasks: number;
  /** Die ersten offenen Aufgaben. */
  tasks: Task[];
  last_meeting: Meeting | null;
  /** So heißt das Geschäftsjahr im IT-Budget. */
  year_label: string;
}

export interface ProjectUpdate {
  name: string;
  description: string;
  status: ProjectStatus;
  starts_on: string | null;
  ends_on: string | null;
  budget_cents: number | null;
  budget_approved_on: string | null;
  budget_note: string;
  people: Person[];
  links: ProjectLink[];
}

export interface ProjectChoice {
  id: number;
  name: string;
  status: ProjectStatus;
}

export interface ProjectBudget {
  sums: BudgetSums;
  budget_approved_on: string | null;
  budget_note: string;
  year_label: string;
  items: {
    id: number;
    name: string;
    account_number: string;
    account_name: string;
    active: boolean;
    start_year_name: string;
    end_year_name: string | null;
    planned_cents: number;
    actual_cents: number;
  }[];
  years: { year: number; name: string; planned_cents: number; actual_cents: number }[];
}

const BASE = "/api/projects";

export function fetchProjects(): Promise<ProjectSummary[]> {
  return getJson(BASE);
}

export function fetchProject(id: number): Promise<Project> {
  return getJson(`${BASE}/${id}`);
}

/** Projekte zur Auswahl am Budgetposten (auch für Personen aus dem IT-Budget). */
export function fetchProjectChoices(): Promise<ProjectChoice[]> {
  return getJson(`${BASE}/choices`);
}

// Änderungen an Projekten betreffen keine Aufgaben der Startseite: Zähler nicht neu laden.
const QUIET = { quiet: true };

export function createProject(update: ProjectUpdate): Promise<Project> {
  return postJson(BASE, update, QUIET);
}

export function updateProject(id: number, update: ProjectUpdate): Promise<Project> {
  return putJson(`${BASE}/${id}`, update, QUIET);
}

export function deleteProject(id: number): Promise<{ deleted: boolean }> {
  return deleteJson(`${BASE}/${id}`, QUIET);
}

export function fetchProjectBudget(id: number): Promise<ProjectBudget> {
  return getJson(`${BASE}/${id}/budget`);
}

export function fetchTasks(projectId: number): Promise<Task[]> {
  return getJson(`${BASE}/${projectId}/tasks`);
}

export function createTask(projectId: number, update: TaskUpdate): Promise<Task> {
  return postJson(`${BASE}/${projectId}/tasks`, update, QUIET);
}

export function updateTask(projectId: number, id: number, update: TaskUpdate): Promise<Task> {
  return putJson(`${BASE}/${projectId}/tasks/${id}`, update, QUIET);
}

export function deleteTask(projectId: number, id: number): Promise<{ deleted: boolean }> {
  return deleteJson(`${BASE}/${projectId}/tasks/${id}`, QUIET);
}

export function fetchMeetings(projectId: number): Promise<MeetingSummary[]> {
  return getJson(`${BASE}/${projectId}/meetings`);
}

export function fetchMeeting(projectId: number, id: number): Promise<Meeting> {
  return getJson(`${BASE}/${projectId}/meetings/${id}`);
}

export function createMeeting(projectId: number, update: MeetingUpdate): Promise<Meeting> {
  return postJson(`${BASE}/${projectId}/meetings`, update, QUIET);
}

export function updateMeeting(
  projectId: number,
  id: number,
  update: MeetingUpdate,
): Promise<Meeting> {
  return putJson(`${BASE}/${projectId}/meetings/${id}`, update, QUIET);
}

export function deleteMeeting(projectId: number, id: number): Promise<{ deleted: boolean }> {
  return deleteJson(`${BASE}/${projectId}/meetings/${id}`, QUIET);
}

/** Höchstgröße eines Anhangs in Megabyte (wie auf dem Server). */
export const FILE_MAX_MB = 20;
/** Höchstzahl der Anhänge je Eintrag (wie auf dem Server). */
export const FILES_MAX = 10;

export function fileUrl(projectId: number, meetingId: number, fileId: number): string {
  return `${BASE}/${projectId}/meetings/${meetingId}/files/${fileId}`;
}

/** Hängt ein PDF an den Eintrag. Der Inhalt der Anfrage ist die Datei selbst. */
export async function uploadFile(
  projectId: number,
  meetingId: number,
  file: File,
): Promise<Meeting> {
  const response = await fetch(`${BASE}/${projectId}/meetings/${meetingId}/files`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/pdf",
      // Der Dateiname kann Umlaute enthalten; Kopfzeilen vertragen nur ASCII.
      "X-Dateiname": encodeURIComponent(file.name),
    },
    body: file,
  });
  if (!response.ok) {
    const detail = await response
      .json()
      .then((body: unknown) => {
        const value = (body as { detail?: unknown } | null)?.detail;
        return typeof value === "string" ? value : null;
      })
      .catch(() => null);
    throw new ApiError(response.status, false, detail);
  }
  return (await response.json()) as Meeting;
}

export function deleteFile(projectId: number, meetingId: number, fileId: number): Promise<Meeting> {
  return deleteJson(fileUrl(projectId, meetingId, fileId), QUIET);
}

/** Nur vollständige https-Adressen (wie auf dem Server). */
export function isHttpsUrl(value: string): boolean {
  if (/\s/.test(value)) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname !== "" && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Tag im Format JJJJ-MM-TT als „05.03.2026“. */
export function formatDay(day: string | null): string {
  if (!day) {
    return "–";
  }
  const [year = "", month = "", date = ""] = day.split("-");
  return `${date}.${month}.${year}`;
}

/** Laufzeit als Text, z. B. „01.01.2026 – 31.12.2026“ oder „ab 01.01.2026“. */
export function periodText(start: string | null, end: string | null): string {
  if (start && end) {
    return `${formatDay(start)} – ${formatDay(end)}`;
  }
  if (start) {
    return `ab ${formatDay(start)}`;
  }
  if (end) {
    return `bis ${formatDay(end)}`;
  }
  return "";
}

/** Anteil von Ist und geplant am veranschlagten Budget in Prozent (für den Balken). */
export function budgetShares(sums: BudgetSums): { actual: number; planned: number } | null {
  if (sums.budget_cents === null || sums.budget_cents <= 0) {
    return null;
  }
  const whole = Math.max(sums.budget_cents, sums.actual_cents + sums.planned_cents);
  return {
    actual: Math.round((sums.actual_cents / whole) * 1000) / 10,
    planned: Math.round((sums.planned_cents / whole) * 1000) / 10,
  };
}

/** Initialen für den Platzhalter einer Person, z. B. „EB“. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

/** Filtert Projekte nach Status („offen“ heißt: nicht abgeschlossen) und Suchtext. */
export function filterProjects(
  projects: ProjectSummary[],
  view: "offen" | ProjectStatus | "alle",
  query: string,
): ProjectSummary[] {
  const needle = query.trim().toLowerCase();
  return projects.filter(
    (project) =>
      (view === "alle" ||
        (view === "offen" ? project.status !== "abgeschlossen" : project.status === view)) &&
      (needle === "" ||
        project.name.toLowerCase().includes(needle) ||
        project.description.toLowerCase().includes(needle)),
  );
}
