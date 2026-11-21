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
}

/** The fields a person may send. Everything else is the server's. */
export type TaskInput = Partial<Pick<PlatformTask, "title" | "notes" | "clinic" | "status" | "priority" | "startDate" | "deadline">>;

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
