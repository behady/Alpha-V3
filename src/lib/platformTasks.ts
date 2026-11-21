/**
 * The platform owner's own task list, shown on the superadmin console's Tasks tab.
 *
 * Nothing here belongs to a clinic: the rows live in the top-level `platform_tasks` collection,
 * which firestore.rules never opens to anyone. Only /api/admin/tasks reads and writes it, and that
 * route lets superadmins in and nobody else.
 *
 * Kept pure (no Firebase) so the rules for a valid row, the order on screen and "is it late?"
 * are pinned by tests/platformTasks.test.mts.
 */

export const TASK_STATUSES = ["todo", "doing", "built", "live"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["high", "normal", "low"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export interface PlatformTask {
  id: string;
  title: string;
  notes: string;
  /** Free text: which clinic asked for it ("DENT INN"), or empty for everyone. */
  clinic: string;
  status: TaskStatus;
  priority: TaskPriority;
  /** Calendar days as YYYY-MM-DD, or "" when not set. */
  startDate: string;
  deadline: string;
  /** ISO timestamps, set by the server. */
  createdAt: string;
  updatedAt: string;
  /** When the task was first marked Live; cleared if it is moved back. */
  liveAt: string;
  /** "clinic" when a clinic owner sent it from the Help page; "admin" when typed on the console. */
  source: "admin" | "clinic";
  /** Set only on clinic requests: which clinic and who sent it. */
  clinicId: string;
  requestedBy: string;
  /** False on a clinic request nobody on the console has opened yet. */
  seen: boolean;
}

/** The fields a person may send. Everything else is the server's. */
export type TaskInput = Partial<Pick<PlatformTask, "title" | "notes" | "clinic" | "status" | "priority" | "startDate" | "deadline" | "seen">>;

export const TITLE_MAX = 200;
export const NOTES_MAX = 2000;
export const CLINIC_MAX = 80;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day as YYYY-MM-DD (rejects 2026-02-31), or "" to clear. */
export function isDayOrEmpty(v: unknown): v is string {
  if (v === "") return true;
  if (typeof v !== "string" || !DAY_RE.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Checks and trims what the browser sent. `partial` is for an edit, where a missing field means
 * "leave it alone"; a new task must at least have a title.
 */
export function cleanTaskInput(raw: unknown, partial: boolean): { ok: true; value: TaskInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Nothing to save" };
  const r = raw as Record<string, unknown>;
  const out: TaskInput = {};

  if (r.title !== undefined || !partial) {
    if (typeof r.title !== "string" || !r.title.trim()) return { ok: false, error: "The task needs a title" };
    out.title = r.title.trim().slice(0, TITLE_MAX);
  }
  for (const [key, max] of [["notes", NOTES_MAX], ["clinic", CLINIC_MAX]] as const) {
    if (r[key] === undefined) continue;
    if (typeof r[key] !== "string") return { ok: false, error: `Bad ${key}` };
    out[key] = (r[key] as string).trim().slice(0, max);
  }
  if (r.status !== undefined) {
    if (!TASK_STATUSES.includes(r.status as TaskStatus)) return { ok: false, error: "Bad status" };
    out.status = r.status as TaskStatus;
  }
  if (r.priority !== undefined) {
    if (!TASK_PRIORITIES.includes(r.priority as TaskPriority)) return { ok: false, error: "Bad priority" };
    out.priority = r.priority as TaskPriority;
  }
  for (const key of ["startDate", "deadline"] as const) {
    if (r[key] === undefined) continue;
    if (!isDayOrEmpty(r[key])) return { ok: false, error: `Bad ${key === "startDate" ? "start date" : "deadline"}` };
    out[key] = r[key] as string;
  }
  if (r.seen !== undefined) {
    if (typeof r.seen !== "boolean") return { ok: false, error: "Bad seen" };
    out.seen = r.seen;
  }
  return { ok: true, value: out };
}

/** The deadline must not come before the start. Both are checked on the row as it will be saved. */
export function datesInOrder(startDate: string, deadline: string): boolean {
  return !startDate || !deadline || startDate <= deadline;
}

/** Late: has a deadline, the deadline day is over, and it is not Live yet. */
export function isOverdue(task: Pick<PlatformTask, "deadline" | "status">, todayKey: string): boolean {
  return !!task.deadline && task.status !== "live" && task.deadline < todayKey;
}

/** Due today or within the next `days` days, and not Live. */
export function isDueSoon(task: Pick<PlatformTask, "deadline" | "status">, todayKey: string, days = 3): boolean {
  if (!task.deadline || task.status === "live" || task.deadline < todayKey) return false;
  const [y, m, d] = todayKey.split("-").map(Number);
  const limit = new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  return task.deadline <= limit;
}

const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, normal: 1, low: 2 };

/**
 * Order inside one status group: late first, then high priority, then the nearest deadline
 * (no deadline last), then oldest first so the list does not jump around.
 */
export function compareTasks(a: PlatformTask, b: PlatformTask, todayKey: string): number {
  const lateA = isOverdue(a, todayKey) ? 0 : 1;
  const lateB = isOverdue(b, todayKey) ? 0 : 1;
  if (lateA !== lateB) return lateA - lateB;
  const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (p) return p;
  if (a.deadline !== b.deadline) {
    if (!a.deadline) return 1;
    if (!b.deadline) return -1;
    return a.deadline < b.deadline ? -1 : 1;
  }
  return a.createdAt.localeCompare(b.createdAt);
}

/** A stored document, read defensively: old or hand-edited rows never break the screen. */
export function taskFromDoc(id: string, data: Record<string, unknown>): PlatformTask {
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const iso = (v: unknown) => {
    const toDate = (v as { toDate?: () => Date } | null)?.toDate;
    if (typeof toDate === "function") return toDate.call(v).toISOString();
    return str(v);
  };
  return {
    id,
    title: str(data.title) || "(untitled)",
    notes: str(data.notes),
    clinic: str(data.clinic),
    status: TASK_STATUSES.includes(data.status as TaskStatus) ? (data.status as TaskStatus) : "todo",
    priority: TASK_PRIORITIES.includes(data.priority as TaskPriority) ? (data.priority as TaskPriority) : "normal",
    startDate: isDayOrEmpty(data.startDate) ? (data.startDate as string) : "",
    deadline: isDayOrEmpty(data.deadline) ? (data.deadline as string) : "",
    createdAt: iso(data.createdAt),
    updatedAt: iso(data.updatedAt),
    liveAt: iso(data.liveAt),
    source: data.source === "clinic" ? "clinic" : "admin",
    clinicId: str(data.clinicId),
    requestedBy: str(data.requestedBy),
    seen: data.seen !== false,
  };
}

/**
 * The list the owner brought on 2026-11-21, as it stood that day. "Fill the starter list" adds
 * these once, only when the list is empty, so a second click never duplicates them.
 */
export const STARTER_TASKS: TaskInput[] = [
  { title: "Scroll on iPhone", status: "live", notes: "iPhones can scroll to every appointment on the calendar again (16 Nov)." },
  { title: "Search bar for stock", status: "live", notes: "Live since 18 Nov." },
  { title: "Alphabetical order for stock", status: "live", notes: "A-to-Z rows, live since 18 Nov." },
  { title: "GASCO sheet optimization", status: "built", clinic: "DENT INN", notes: "One drawer per patient, each procedure on its own month, phone layout. Waiting for the OK to go live." },
  { title: "Change treatment status from the report page", status: "built", notes: "Treatments report: the state is a dropdown that saves to the treatment card. Waiting for the OK to go live." },
  { title: "Appointment notes sync with the dentist view", status: "live", notes: "Dentist screen shows the visit note open and can add or edit it (16 Nov)." },
  { title: "Patient status and work status in the booking pop-up", status: "live", notes: "\"Who pays?\" picker and No-approval flag are live (16 Nov). Confirm whether more was wanted." },
  { title: "Discount on the insurance patient's share", status: "live", notes: "Dentists earn on the share after the discount (16 Nov)." },
  { title: "List of all patients who owe the clinic money", status: "todo", notes: "Reports → Receivables already lists them. Decide: easier place to find it, or a different list?" },
  { title: "Monthly report on WhatsApp", status: "todo", clinic: "DENT INN", notes: "\"The month, closed\" alert already exists. Check it is switched on for DENT INN and arrives." },
  { title: "Notification improvement", status: "todo", notes: "To define: what should change?" },
  { title: "AXA AI scan makes mistakes", status: "todo", priority: "high", clinic: "DENT INN", notes: "Owner reports wrong readings. Collect sample papers and what was read wrong." },
];

/* ------------------------------------------------------------------------------------------ */
/* Clinic requests                                                                             */
/* ------------------------------------------------------------------------------------------ */

export const REQUEST_MAX = 1000;
/** A clinic can have this many requests waiting (not Live) at once. */
export const OPEN_REQUESTS_PER_CLINIC = 20;

/** A request's text, trimmed; the first line (cut short) becomes the task's title. */
export function requestToTask(text: unknown): { ok: true; title: string; notes: string } | { ok: false; error: string } {
  if (typeof text !== "string") return { ok: false, error: "Write what you need" };
  const notes = text.trim().slice(0, REQUEST_MAX);
  if (notes.length < 3) return { ok: false, error: "Write what you need" };
  const first = notes.split(/\r?\n/).find((l) => l.trim())!.trim();
  const title = first.length > 90 ? `${first.slice(0, 87).trimEnd()}…` : first;
  return { ok: true, title, notes };
}

/** What a clinic sees of its own request: never the console's notes or priority. */
export interface ClinicRequestView {
  id: string;
  title: string;
  status: TaskStatus;
  createdAt: string;
  liveAt: string;
}

export function clinicView(t: PlatformTask): ClinicRequestView {
  return { id: t.id, title: t.title, status: t.status, createdAt: t.createdAt, liveAt: t.liveAt };
}

/* ------------------------------------------------------------------------------------------ */
/* The morning WhatsApp                                                                        */
/* ------------------------------------------------------------------------------------------ */

export interface DigestSettings {
  enabled: boolean;
  /** As typed, e.g. 01117775526. */
  phone: string;
  /** Cairo hour, 0-23, when the message goes. */
  hour: number;
  /** The Cairo day it last went, so the hourly job sends once a day. */
  lastSentDay: string;
}

export const DEFAULT_DIGEST: DigestSettings = { enabled: false, phone: "", hour: 9, lastSentDay: "" };

export function digestFromDoc(data: Record<string, unknown> | undefined): DigestSettings {
  const d = data || {};
  const hour = Number(d.hour);
  return {
    enabled: d.enabled === true,
    phone: typeof d.phone === "string" ? d.phone : "",
    hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : DEFAULT_DIGEST.hour,
    lastSentDay: isDayOrEmpty(d.lastSentDay) ? (d.lastSentDay as string) : "",
  };
}

/** The day and hour in Cairo for an instant. Egypt moves its clocks, so never a fixed offset. */
export function cairoNow(at: Date): { day: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24 };
}

/** Is this the hour, and has today's message not gone yet? */
export function digestDue(settings: DigestSettings, at: Date): boolean {
  if (!settings.enabled || !settings.phone) return false;
  const { day, hour } = cairoNow(at);
  return hour >= settings.hour && settings.lastSentDay !== day;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (day: string) => {
  const [, m, d] = day.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
};

/**
 * The message, or null when there is nothing worth a message: no late task, nothing due in the
 * next three days and no unread clinic request. A quiet day sends nothing.
 */
export function buildDigest(tasks: PlatformTask[], todayKey: string): string | null {
  const open = tasks.filter((t) => t.status !== "live");
  const late = open.filter((t) => isOverdue(t, todayKey)).sort((a, b) => a.deadline.localeCompare(b.deadline));
  const today = open.filter((t) => t.deadline === todayKey);
  const soon = open.filter((t) => t.deadline > todayKey && isDueSoon(t, todayKey)).sort((a, b) => a.deadline.localeCompare(b.deadline));
  const fresh = tasks.filter((t) => t.source === "clinic" && !t.seen);
  if (!late.length && !today.length && !soon.length && !fresh.length) return null;

  const line = (t: PlatformTask, tail: string) => `• ${t.title}${t.clinic ? ` — ${t.clinic}` : ""}${tail}`;
  const blocks: string[] = [`📋 *Alpha tasks — ${short(todayKey)}*`];
  if (late.length) blocks.push([`🔴 *Late (${late.length})*`, ...late.map((t) => line(t, ` (was due ${short(t.deadline)})`))].join("\n"));
  if (today.length) blocks.push([`🟠 *Due today (${today.length})*`, ...today.map((t) => line(t, ""))].join("\n"));
  if (soon.length) blocks.push([`🟡 *Next 3 days (${soon.length})*`, ...soon.map((t) => line(t, ` (${short(t.deadline)})`))].join("\n"));
  if (fresh.length) blocks.push([`📨 *New clinic requests (${fresh.length})*`, ...fresh.map((t) => `• ${t.clinic || "A clinic"}: ${t.title}`)].join("\n"));
  const inProgress = open.filter((t) => t.status === "doing").length;
  const built = open.filter((t) => t.status === "built").length;
  blocks.push(`Open: ${open.length} · in progress ${inProgress} · built, not live ${built}`);
  return blocks.join("\n\n");
}

/* ------------------------------------------------------------------------------------------ */
/* Calendar                                                                                    */
/* ------------------------------------------------------------------------------------------ */

/** The days of a month view, Saturday first (the Egyptian week), padded to whole weeks. */
export function monthCells(year: number, month0: number): { day: string; inMonth: boolean }[] {
  const first = new Date(Date.UTC(year, month0, 1));
  const lead = (first.getUTCDay() + 1) % 7; // Sat=0 … Fri=6
  const daysInMonth = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  const total = Math.ceil((lead + daysInMonth) / 7) * 7;
  const out: { day: string; inMonth: boolean }[] = [];
  for (let i = 0; i < total; i++) {
    const d = new Date(Date.UTC(year, month0, 1 - lead + i));
    out.push({ day: d.toISOString().slice(0, 10), inMonth: d.getUTCMonth() === month0 });
  }
  return out;
}
