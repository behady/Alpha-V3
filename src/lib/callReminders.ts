/**
 * Call reminders: "call this patient on Thursday about the crown price".
 *
 * Every decision lives here so it can be tested without Firebase — when a reminder fires on the
 * clinic's clock, what a person may save, who a role reaches at a branch, how the card orders them,
 * and the exact WhatsApp wording. The route (/api/call-reminders), the 10-minute sweep and the
 * screens only read and write; they decide nothing of their own.
 *
 * Times are on the clinic clock (Africa/Cairo). Egypt keeps summer time, so the UTC offset is read
 * from the zone for the day in question, never assumed.
 *
 * Spec: docs/superpowers/specs/2026-10-22-call-reminders-design.md
 */

export const CALL_REMINDERS_COLLECTION = "call_reminders";
export const REASON_MAX = 300;
const CLINIC_TZ = "Africa/Cairo";

export type ReminderStatus = "open" | "done" | "rescheduled" | "booked";
export type ReminderSource = "patient" | "booking" | "treatment";
export type ReminderRole = "Admin" | "Dentist" | "Receptionist" | "Assistant";
export const REMINDER_ROLES: readonly ReminderRole[] = ["Receptionist", "Assistant", "Dentist", "Admin"];

export type ReminderRecipient =
  | { kind: "person"; uid: string; name: string }
  | { kind: "role"; role: ReminderRole };

/** The stored reminder, with its timestamps as epoch milliseconds. */
export interface CallReminder {
  id: string;
  patientId: string;
  patientName: string;
  patientPhone: string;
  branchId: string | null;
  reason: string;
  source: ReminderSource;
  sourceNoteId?: string;
  date: string;
  time: string | null;
  fireAtMs: number;
  recipient: ReminderRecipient;
  status: ReminderStatus;
  note?: string;
  /** What was said on the call before this one, when this one is a "call again". */
  previousNote?: string;
  handledBy?: { uid: string; name: string };
  handledAtMs?: number;
  appointmentId?: string;
  previousId?: string;
  nextId?: string;
  notifiedAtMs?: number;
  deliveryError?: string;
  createdBy: { uid: string; name: string };
  createdAtMs: number;
}

export interface ReminderInput {
  patientId: string;
  date: string;
  time: string | null;
  reason: string;
  recipient: ReminderRecipient;
  source: ReminderSource;
  sourceNoteId?: string;
}

/* --- the clinic clock -------------------------------------------------------------------------- */

/** How far the zone's wall clock is ahead of UTC at this instant, in ms. */
function zoneOffsetMs(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instantMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const wallAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return wallAsUtc - Math.floor(instantMs / 1000) * 1000;
}

/** The instant at which the zone's clock reads `ymd hh:mm`. */
export function cairoInstant(ymd: string, hhmm: string, timeZone: string = CLINIC_TZ): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const first = guess - zoneOffsetMs(guess, timeZone);
  // Re-read the offset at the corrected instant: on a DST change day the guess can sit on the
  // other side of the switch.
  const second = guess - zoneOffsetMs(first, timeZone);
  return new Date(second);
}

const pad2 = (n: number) => String(n).padStart(2, "0");

export function computeFireAt(date: string, time: string | null, morningHour: number, timeZone: string = CLINIC_TZ): Date {
  return cairoInstant(date, time ?? `${pad2(morningHour)}:00`, timeZone);
}

/* --- what may be saved ------------------------------------------------------------------------- */

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function isRealDay(ymd: string): boolean {
  const m = YMD.exec(ymd);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

export function cleanReason(raw: string): string {
  return String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, REASON_MAX);
}

export function validateReminderInput(
  input: ReminderInput,
  todayYmd: string,
): { ok: true; value: ReminderInput } | { ok: false; error: "date" | "time" | "reason" | "recipient" } {
  if (!isRealDay(input.date) || input.date < todayYmd) return { ok: false, error: "date" };
  if (input.time !== null && !HHMM.test(input.time)) return { ok: false, error: "time" };
  const reason = cleanReason(input.reason);
  if (!reason) return { ok: false, error: "reason" };
  const r = input.recipient;
  if (!r || (r.kind === "person" && !String(r.uid || "").trim()) || (r.kind === "role" && !REMINDER_ROLES.includes(r.role)) || (r.kind !== "person" && r.kind !== "role")) {
    return { ok: false, error: "recipient" };
  }
  return { ok: true, value: { ...input, reason } };
}

/* --- who it reaches ---------------------------------------------------------------------------- */

export interface StaffForRecipients {
  uid: string;
  role: string;
  branchIds?: string[] | null;
}

/**
 * The people a reminder reaches. A named person is reached wherever they work; a role reaches its
 * people at the reminder's branch (no branch list on a staff row means they work everywhere, as
 * elsewhere in the app). The owner is addressed as an admin, as the notification gate does.
 */
export function resolveRecipients(r: ReminderRecipient, branchId: string | null, members: StaffForRecipients[]): string[] {
  if (r.kind === "person") return members.some((m) => m.uid === r.uid) ? [r.uid] : [];
  const roleOf = (m: StaffForRecipients) => (m.role === "Owner" ? "Admin" : m.role);
  const atBranch = (m: StaffForRecipients) => !branchId || !m.branchIds || m.branchIds.length === 0 || m.branchIds.includes(branchId);
  return [...new Set(members.filter((m) => roleOf(m) === r.role && atBranch(m)).map((m) => m.uid))];
}

/* --- days -------------------------------------------------------------------------------------- */

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

export function quickDate(todayYmd: string, chip: "tomorrow" | "3days" | "week" | "month"): string {
  if (chip === "tomorrow") return addDays(todayYmd, 1);
  if (chip === "3days") return addDays(todayYmd, 3);
  if (chip === "week") return addDays(todayYmd, 7);
  const [y, m, d] = todayYmd.split("-").map(Number);
  const lastOfNext = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const t = new Date(Date.UTC(y, m, Math.min(d, lastOfNext)));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

export function daysLate(r: Pick<CallReminder, "date">, todayYmd: string): number {
  if (r.date >= todayYmd) return 0;
  const a = Date.parse(`${r.date}T00:00:00Z`);
  const b = Date.parse(`${todayYmd}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

/** Overdue first (oldest first), then today's in time order. */
export function sortForCard(rows: CallReminder[], nowMs: number): CallReminder[] {
  void nowMs;
  return [...rows].sort((a, b) => a.fireAtMs - b.fireAtMs || a.createdAtMs - b.createdAtMs);
}

/** What the dashboard card shows: open calls dated today or earlier, overdue first. */
export function dueOnCard(rows: CallReminder[], nowMs: number, todayYmd: string): CallReminder[] {
  return sortForCard(rows.filter((r) => r.status === "open" && r.date <= todayYmd), nowMs);
}

/** Which tab of the Calls page a reminder sits on. */
export function callsTab(r: Pick<CallReminder, "status" | "date">, nowMs: number, todayYmd: string): "today" | "late" | "upcoming" | "done" {
  void nowMs;
  if (r.status !== "open") return "done";
  if (r.date < todayYmd) return "late";
  return r.date === todayYmd ? "today" : "upcoming";
}

/* --- words ------------------------------------------------------------------------------------- */

const AR_MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const ROLE_LABELS: Record<ReminderRole, { ar: string; en: string }> = {
  Admin: { ar: "الإدارة", en: "Admins" },
  Dentist: { ar: "الدكاترة", en: "Dentists" },
  Receptionist: { ar: "الاستقبال", en: "Reception" },
  Assistant: { ar: "المساعدين", en: "Assistants" },
};

export function recipientLabel(r: ReminderRecipient, isAr: boolean): string {
  if (r.kind === "person") return r.name;
  const l = ROLE_LABELS[r.role];
  return l ? (isAr ? l.ar : l.en) : r.role;
}

const toArabicDigits = (n: number) => String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);

/** "20 أكتوبر" for an instant, on the clinic clock. */
export function arabicDayMonth(ms: number, timeZone: string = CLINIC_TZ): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "numeric" }).formatToParts(new Date(ms));
  const day = Number(parts.find((p) => p.type === "day")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  return `${day} ${AR_MONTHS[month - 1]}`;
}

const AR_WEEKDAYS = ["الأحد", "الاتنين", "التلات", "الأربع", "الخميس", "الجمعة", "السبت"];
const EN_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * When a call is due, as a row shows it: "النهارده · 21:14", "بكرة · 04:52", or
 * "الخميس 30 أكتوبر · 21:14". The day alone when no time was chosen.
 */
export function callDayLabel(date: string, time: string | null, todayYmd: string, isAr: boolean): string {
  let day: string;
  if (date === todayYmd) day = isAr ? "النهارده" : "Today";
  else if (date === addDays(todayYmd, 1)) day = isAr ? "بكرة" : "Tomorrow";
  else {
    const [y, m, d] = date.split("-").map(Number);
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    day = isAr ? `${AR_WEEKDAYS[weekday]} ${d} ${AR_MONTHS[m - 1]}` : `${EN_WEEKDAYS[weekday]} ${d} ${EN_MONTHS[m - 1]}`;
  }
  return time ? `${day} · ${time}` : day;
}

export function reminderWhatsappText(
  r: Pick<CallReminder, "patientName" | "patientPhone" | "reason" | "createdBy" | "createdAtMs">,
  link: string,
): string {
  return [
    "📞 تذكير بمكالمة",
    `المريض: ${r.patientName}${r.patientPhone ? ` — ${r.patientPhone}` : ""}`,
    `السبب: ${r.reason}`,
    `من: ${r.createdBy.name} · يوم ${arabicDayMonth(r.createdAtMs)}`,
    `افتح: ${link}`,
  ].join("\n");
}

/** The evening list of today's calls nobody made, or null when there are none. */
export function missedSummaryText(today: CallReminder[], olderCount: number, roleLabel: (role: string) => string): string | null {
  if (today.length === 0) return null;
  const who = (r: CallReminder) => (r.recipient.kind === "person" ? r.recipient.name : roleLabel(r.recipient.role));
  const lines = [
    `⚠️ ${toArabicDigits(today.length)} مكالمات ما اتعملتش النهارده:`,
    today.map((r) => `${r.patientName} (${who(r)})`).join(" · "),
  ];
  if (olderCount > 0) lines.push(`و${toArabicDigits(olderCount)} متأخرة من أيام قبل كده`);
  return lines.join("\n");
}

/* --- a stored document ------------------------------------------------------------------------- */

function toMs(v: unknown): number | undefined {
  if (v == null) return undefined;
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "object" && "toMillis" in (v as object)) return (v as { toMillis: () => number }).toMillis();
  return undefined;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const optStr = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const who = (v: unknown) => {
  const o = (v || {}) as { uid?: unknown; name?: unknown };
  return { uid: str(o.uid), name: str(o.name) };
};

/** A Firestore document (Timestamps or dates) as a CallReminder. Absent optional fields stay absent. */
export function reminderFromDoc(id: string, d: Record<string, unknown>): CallReminder {
  const r: CallReminder = {
    id,
    patientId: str(d.patientId),
    patientName: str(d.patientName),
    patientPhone: str(d.patientPhone),
    branchId: optStr(d.branchId) ?? null,
    reason: str(d.reason),
    source: (str(d.source) || "patient") as ReminderSource,
    date: str(d.date),
    time: optStr(d.time) ?? null,
    fireAtMs: toMs(d.fireAt) ?? 0,
    recipient: (d.recipient as ReminderRecipient) || { kind: "role", role: "Receptionist" },
    status: (str(d.status) || "open") as ReminderStatus,
    createdBy: who(d.createdBy),
    createdAtMs: toMs(d.createdAt) ?? 0,
  };
  const extra: Partial<CallReminder> = {
    sourceNoteId: optStr(d.sourceNoteId),
    note: optStr(d.note),
    previousNote: optStr(d.previousNote),
    handledBy: d.handledBy ? who(d.handledBy) : undefined,
    handledAtMs: toMs(d.handledAt),
    appointmentId: optStr(d.appointmentId),
    previousId: optStr(d.previousId),
    nextId: optStr(d.nextId),
    notifiedAtMs: toMs(d.notifiedAt),
    deliveryError: optStr(d.deliveryError),
  };
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) (r as unknown as Record<string, unknown>)[k] = v;
  return r;
}
