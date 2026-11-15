import { getJson } from "../../api";

const BASE = "/api/tenant";

export interface License {
  id: number;
  sku_id: string;
  part_number: string;
  name: string;
  applies_to: string | null;
  capability_status: string | null;
  total: number;
  consumed: number;
  /** Kann negativ sein, wenn mehr zugewiesen als gekauft ist. */
  free: number;
  warning: number;
  suspended: number;
  locked_out: number;
  next_lifecycle: string | null;
  trial: boolean;
  active: boolean;
}

export interface LicenseList {
  /** `false`: Der Abruf ist in dieser Installation nicht eingeschaltet. */
  enabled: boolean;
  fetched_at: string | null;
  total: number;
  consumed: number;
  entries: License[];
}

export interface LicenseSample {
  day: string;
  total: number;
  consumed: number;
}

export interface LicenseDetail {
  license: License;
  fetched_at: string;
  samples: LicenseSample[];
}

export interface UserSample {
  day: string;
  total: number;
  members: number;
  guests: number;
  enabled: number;
  disabled: number;
  guests_disabled: number;
  licensed: number | null;
}

export interface Users {
  enabled: boolean;
  fetched_at: string | null;
  current: UserSample | null;
  samples: UserSample[];
}

/** Zeiträume für den Verlauf, in Tagen. */
export const PERIODS: { days: number; label: string }[] = [
  { days: 30, label: "30 Tage" },
  { days: 90, label: "90 Tage" },
  { days: 365, label: "1 Jahr" },
  { days: 1095, label: "3 Jahre" },
];

export function fetchLicenses(): Promise<LicenseList> {
  return getJson(`${BASE}/licenses`);
}

export function fetchLicense(id: number, days: number): Promise<LicenseDetail> {
  return getJson(`${BASE}/licenses/${id}?days=${days}`);
}

export function fetchUsers(days: number): Promise<Users> {
  return getJson(`${BASE}/users?days=${days}`);
}

const numberFormat = new Intl.NumberFormat("de-DE");

export function formatCount(value: number): string {
  return numberFormat.format(value);
}

const DAY_MS = 86_400_000;
/** Ab so vielen Tagen vor dem Stichtag eines Abos gibt es einen Hinweis. */
export const LIFECYCLE_WARN_DAYS = 30;

/** Ganze Tage bis zu einem Zeitpunkt; negativ, wenn er vorbei ist. */
export function daysUntil(iso: string, now: number): number {
  return Math.ceil((Date.parse(iso) - now) / DAY_MS);
}

export interface LicenseNote {
  text: string;
  tone: "ok" | "todo" | "bad" | "neutral";
}

/** Hinweise zu einer Lizenz: aufgebraucht, überbucht, Stichtag nah, Testabo, gesperrte Einheiten. */
export function licenseNotes(license: License, now: number): LicenseNote[] {
  const notes: LicenseNote[] = [];
  if (license.free < 0) {
    notes.push({ text: `${formatCount(-license.free)} mehr zugewiesen als gekauft`, tone: "bad" });
  } else if (license.free === 0 && license.total > 0) {
    notes.push({ text: "aufgebraucht", tone: "todo" });
  }
  if (license.warning > 0) {
    notes.push({ text: `${formatCount(license.warning)} in Kulanzfrist`, tone: "todo" });
  }
  if (license.suspended + license.locked_out > 0) {
    notes.push({
      text: `${formatCount(license.suspended + license.locked_out)} gesperrt`,
      tone: "bad",
    });
  }
  if (license.next_lifecycle) {
    const days = daysUntil(license.next_lifecycle, now);
    if (days < 0) {
      notes.push({ text: "Stichtag überschritten", tone: "bad" });
    } else if (days <= LIFECYCLE_WARN_DAYS) {
      notes.push({ text: days === 0 ? "Stichtag heute" : `Stichtag in ${days} Tagen`, tone: "todo" });
    }
  }
  if (license.trial) {
    notes.push({ text: "Testabo", tone: "neutral" });
  }
  return notes;
}
