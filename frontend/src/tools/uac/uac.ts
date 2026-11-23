/** userAccountControl (Active Directory) – Flags nach [MS-ADTS] 2.2.16 */

export interface UacFlag {
  bit: number;
  name: string;
  label: string;
  /** nur über msDS-User-Account-Control-Computed sichtbar, nicht in userAccountControl gespeichert */
  computed?: boolean;
}

export const uacFlags: UacFlag[] = [
  { bit: 0x0001, name: "SCRIPT", label: "Anmeldeskript wird ausgeführt" },
  { bit: 0x0002, name: "ACCOUNTDISABLE", label: "Konto deaktiviert" },
  { bit: 0x0008, name: "HOMEDIR_REQUIRED", label: "Basisordner erforderlich" },
  { bit: 0x0010, name: "LOCKOUT", label: "Konto gesperrt", computed: true },
  { bit: 0x0020, name: "PASSWD_NOTREQD", label: "Kein Kennwort erforderlich" },
  {
    bit: 0x0040,
    name: "PASSWD_CANT_CHANGE",
    label: "Benutzer kann Kennwort nicht ändern",
    computed: true,
  },
  {
    bit: 0x0080,
    name: "ENCRYPTED_TEXT_PWD_ALLOWED",
    label: "Kennwort mit umkehrbarer Verschlüsselung speichern",
  },
  { bit: 0x0100, name: "TEMP_DUPLICATE_ACCOUNT", label: "Lokales Konto (temporäres Duplikat)" },
  { bit: 0x0200, name: "NORMAL_ACCOUNT", label: "Normales Benutzerkonto" },
  { bit: 0x0800, name: "INTERDOMAIN_TRUST_ACCOUNT", label: "Vertrauenskonto zwischen Domänen" },
  {
    bit: 0x1000,
    name: "WORKSTATION_TRUST_ACCOUNT",
    label: "Computerkonto (Arbeitsstation/Mitgliedsserver)",
  },
  { bit: 0x2000, name: "SERVER_TRUST_ACCOUNT", label: "Computerkonto eines Domänencontrollers" },
  { bit: 0x10000, name: "DONT_EXPIRE_PASSWORD", label: "Kennwort läuft nie ab" },
  { bit: 0x20000, name: "MNS_LOGON_ACCOUNT", label: "MNS-Anmeldekonto" },
  { bit: 0x40000, name: "SMARTCARD_REQUIRED", label: "Smartcard für Anmeldung erforderlich" },
  {
    bit: 0x80000,
    name: "TRUSTED_FOR_DELEGATION",
    label: "Für Delegierung vertraut (uneingeschränkt)",
  },
  { bit: 0x100000, name: "NOT_DELEGATED", label: "Konto ist vertraulich, keine Delegierung" },
  { bit: 0x200000, name: "USE_DES_KEY_ONLY", label: "Nur DES-Schlüssel für Kerberos" },
  { bit: 0x400000, name: "DONT_REQ_PREAUTH", label: "Keine Kerberos-Vorauthentifizierung" },
  { bit: 0x800000, name: "PASSWORD_EXPIRED", label: "Kennwort abgelaufen", computed: true },
  {
    bit: 0x1000000,
    name: "TRUSTED_TO_AUTH_FOR_DELEGATION",
    label: "Für Delegierung an bestimmte Dienste vertraut (Protokollübergang)",
  },
  {
    bit: 0x4000000,
    name: "PARTIAL_SECRETS_ACCOUNT",
    label: "Schreibgeschützter Domänencontroller (RODC)",
  },
];

export const commonUacValues: { value: number; label: string }[] = [
  { value: 512, label: "Normales Konto" },
  { value: 514, label: "Normales Konto, deaktiviert" },
  { value: 66048, label: "Normales Konto, Kennwort läuft nie ab" },
  { value: 66050, label: "… und deaktiviert" },
  { value: 544, label: "Normales Konto, kein Kennwort erforderlich" },
  { value: 4096, label: "Computer (Arbeitsstation/Server)" },
  { value: 4098, label: "Computer, deaktiviert" },
  { value: 532480, label: "Domänencontroller" },
  { value: 83955712, label: "Schreibgeschützter Domänencontroller" },
];

/** „514“, „0x202“, „0202h“ */
export function parseUac(input: string): number {
  const v = input
    .trim()
    .toLowerCase()
    .replace(/[\s_.']/g, "");
  let n: number;
  if (/^0x[0-9a-f]+$/.test(v)) n = parseInt(v.slice(2), 16);
  else if (/^[0-9a-f]+h$/.test(v)) n = parseInt(v.slice(0, -1), 16);
  else if (/^\d+$/.test(v)) n = Number(v);
  else if (/^-\d+$/.test(v)) n = Number(v) >>> 0;
  else throw new Error("Bitte gib eine Zahl ein (dezimal oder hexadezimal mit 0x)");
  if (!Number.isSafeInteger(n) || n < 0 || n > 0xffffffff)
    throw new Error("Wert liegt außerhalb von 32 Bit");
  return n;
}

export function decodeUac(value: number): {
  flags: UacFlag[];
  unknown: number;
  warnings: string[];
} {
  const flags = uacFlags.filter((f) => (value & f.bit) !== 0);
  const known = uacFlags.reduce((m, f) => m | f.bit, 0);
  const unknown = (value & ~known) >>> 0;
  const warnings: string[] = [];
  const has = (n: string) => flags.some((f) => f.name === n);
  if (has("PASSWD_NOTREQD"))
    warnings.push("PASSWD_NOTREQD: Das Konto darf ein leeres Kennwort haben.");
  if (has("ENCRYPTED_TEXT_PWD_ALLOWED"))
    warnings.push(
      "Umkehrbare Verschlüsselung: Das Kennwort ist praktisch im Klartext gespeichert.",
    );
  if (has("DONT_REQ_PREAUTH"))
    warnings.push(
      "Ohne Kerberos-Vorauthentifizierung ist das Konto für AS-REP-Roasting angreifbar.",
    );
  if (has("TRUSTED_FOR_DELEGATION") && !has("SERVER_TRUST_ACCOUNT"))
    warnings.push(
      "Uneingeschränkte Delegierung außerhalb von Domänencontrollern ist ein hohes Risiko.",
    );
  if (has("USE_DES_KEY_ONLY"))
    warnings.push("DES ist unsicher und in aktuellen Windows-Versionen deaktiviert.");
  const types = [
    "NORMAL_ACCOUNT",
    "WORKSTATION_TRUST_ACCOUNT",
    "SERVER_TRUST_ACCOUNT",
    "INTERDOMAIN_TRUST_ACCOUNT",
    "TEMP_DUPLICATE_ACCOUNT",
  ].filter(has);
  if (types.length > 1)
    warnings.push(`Mehrere Kontotypen gleichzeitig gesetzt (${types.join(", ")}) – ungewöhnlich.`);
  if (flags.some((f) => f.computed))
    warnings.push(
      "LOCKOUT, PASSWD_CANT_CHANGE und PASSWORD_EXPIRED stehen nicht in userAccountControl, sondern in msDS-User-Account-Control-Computed bzw. den Berechtigungen.",
    );
  return { flags, unknown, warnings };
}

/** LDAP-Filter: Bit gesetzt (LDAP_MATCHING_RULE_BIT_AND) */
export const ldapBitFilter = (bit: number, negate = false) =>
  negate
    ? `(!(userAccountControl:1.2.840.113556.1.4.803:=${bit}))`
    : `(userAccountControl:1.2.840.113556.1.4.803:=${bit})`;
