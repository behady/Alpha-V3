/** Workflow stages shown in the stage picker (stored Firestore `status` values). */
export const APPOINTMENT_STAGES = [
  { value: "Scheduled" },
  { value: "Confirmed" },
  { value: "Delayed" },
  { value: "Cancelled" },
  { value: "Checked In" },
  { value: "In Chair" },
  { value: "Checking Out" },
  { value: "Completed" },
  { value: "No Show" },
] as const;

export type AppointmentStageValue = (typeof APPOINTMENT_STAGES)[number]["value"];

/**
 * Status values that were written by some paths but are not part of the workflow above.
 *
 * The dashboard's one-click Arrive/Seat buttons wrote "Arrived"/"Seated", and the public booking
 * endpoint wrote "Pending". None of the three appear in APPOINTMENT_STAGES, so they fell through
 * the stage styling, were excluded from the "active" filters, and — because the check-in side
 * effects key off the exact string "Checked In" — an arriving patient got no checkInTime and no
 * attendance row. Those writers now use the canonical values; this mapping keeps records created
 * before that fix readable instead of requiring a migration to display correctly.
 *
 * "In Progress" was only ever offered as a filter option; nothing wrote it, so selecting it
 * matched nothing. It maps to the stage that actually represents that state.
 */
const LEGACY_STATUS_ALIASES: Record<string, AppointmentStageValue> = {
  Arrived: "Checked In",
  Seated: "In Chair",
  Pending: "Scheduled",
  "In Progress": "In Chair",
};

/** Canonical form of a stored status. Unknown values are returned untouched. */
export function normalizeAppointmentStatus(status: string | undefined | null): string {
  if (!status) return "Scheduled";
  return LEGACY_STATUS_ALIASES[status] || status;
}

const STAGE_LABELS: Record<string, { en: string; ar: string }> = {
  Scheduled: { en: "Unconfirmed", ar: "غير مؤكد" },
  Confirmed: { en: "Confirmed", ar: "مؤكد" },
  Delayed: { en: "Delayed", ar: "مؤجل" },
  Cancelled: { en: "Canceled", ar: "ملغي" },
  "Checked In": { en: "Check in", ar: "تسجيل وصول" },
  "In Chair": { en: "In chair", ar: "بالكرسي" },
  "Checking Out": { en: "Check out", ar: "خروج" },
  Completed: { en: "Completed", ar: "مكتمل" },
  Late: { en: "Late", ar: "متأخر" },
  "No Show": { en: "No show", ar: "لم يحضر" },
  Emergency: { en: "Emergency", ar: "طوارئ" },
  Rescheduled: { en: "Rescheduled", ar: "معاد جدولته" },
  Unavailable: { en: "Unavailable", ar: "غير متاح" },
};

export function getAppointmentStageLabel(
  status: string | undefined,
  language: "en" | "ar"
): string {
  if (!status) return language === "ar" ? "غير مؤكد" : "Unconfirmed";
  const row = STAGE_LABELS[normalizeAppointmentStatus(status)];
  if (row) return language === "ar" ? row.ar : row.en;
  return status;
}

export type AppointmentStatusStyle = {
  card: string;
  accent: string;
  pill: string;
  dot: string;
};

export function getAppointmentStatusStyles(status?: string): AppointmentStatusStyle {
  // Normalized so a legacy "Arrived"/"Seated" row is styled as the stage it means rather than
  // falling through to the default grey.
  const baseCard = "bg-surface border border-slate-200 shadow-sm text-slate-700";
  const basePill = "bg-surface border border-slate-200 text-slate-700 font-bold shadow-sm";

  switch (normalizeAppointmentStatus(status)) {
    case "Scheduled":
      return {
        card: baseCard,
        accent: "bg-yellow-400",
        pill: basePill,
        dot: "bg-yellow-400",
      };
    case "Confirmed":
      return {
        card: baseCard,
        accent: "bg-teal-400",
        pill: basePill,
        dot: "bg-teal-400",
      };
    case "Checked In":
      return {
        card: baseCard,
        accent: "bg-emerald-500",
        pill: basePill,
        dot: "bg-emerald-500",
      };
    case "In Chair":
      return {
        card: baseCard,
        accent: "bg-sky-500",
        pill: basePill,
        dot: "bg-sky-500",
      };
    case "Checking Out":
      return {
        card: baseCard,
        accent: "bg-cyan-500",
        pill: basePill,
        dot: "bg-cyan-500",
      };
    case "Completed":
      return {
        card: `${baseCard} opacity-80 bg-slate-50`,
        accent: "bg-slate-400",
        pill: basePill,
        dot: "bg-slate-400",
      };
    case "Late":
      return {
        card: baseCard,
        accent: "bg-orange-500",
        pill: basePill,
        dot: "bg-orange-500",
      };
    case "Delayed":
      return {
        card: baseCard,
        accent: "bg-amber-500",
        pill: basePill,
        dot: "bg-amber-500",
      };
    case "Cancelled":
      return {
        card: `${baseCard} opacity-70`,
        accent: "bg-rose-300",
        pill: basePill,
        dot: "bg-rose-300",
      };
    case "No Show":
      return {
        card: baseCard,
        accent: "bg-rose-500",
        pill: basePill,
        dot: "bg-rose-500",
      };
    case "Rescheduled":
      return {
        card: `${baseCard} opacity-80`,
        accent: "bg-violet-300",
        pill: basePill,
        dot: "bg-violet-300",
      };
    default:
      return {
        card: baseCard,
        accent: "bg-slate-400",
        pill: basePill,
        dot: "bg-slate-400",
      };
  }
}
